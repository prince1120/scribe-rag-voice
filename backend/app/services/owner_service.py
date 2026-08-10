"""Business rules for a workspace and its agent.

Sits between the routes and the repositories: routes translate HTTP,
repositories translate SQL, and the decisions live here. That separation is
what lets these rules be tested without a request or a database, and it is why
none of the validation below appears in `owner_routes.py`.

The rules themselves:

  - A workspace is created on first sight rather than at signup. Bringing your
    own API keys *is* the account creation step; asking someone to register
    afterwards would be asking twice.
  - Personal is the default. A workspace only becomes a business by explicit
    choice, so an existing user who never answers the question keeps exactly
    the app they had.
  - A business must name itself and pick a category. Not bureaucracy: the
    category is the cheapest available signal about what people actually build.
  - One agent per owner. A list would need a picker, a default, and a per-link
    choice, none of which earns its complexity for a single phone line.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from app import repositories

logger = logging.getLogger(__name__)

PERSONAL = "personal"
BUSINESS = "business"
VALID_MODES = frozenset({PERSONAL, BUSINESS})

# Offered as a closed list rather than free text so the answers are countable.
# "Other" exists because a wrong list is worse than an incomplete one.
BUSINESS_CATEGORIES: list[dict[str, str]] = [
    {"id": "clinic", "label": "Clinic or healthcare"},
    {"id": "education", "label": "Coaching or education"},
    {"id": "retail", "label": "Shop or e-commerce"},
    {"id": "services", "label": "Local services"},
    {"id": "realestate", "label": "Real estate"},
    {"id": "hospitality", "label": "Hotel or restaurant"},
    {"id": "professional", "label": "Professional services"},
    {"id": "other", "label": "Something else"},
]
VALID_CATEGORIES = frozenset(c["id"] for c in BUSINESS_CATEGORIES)

# Deliberately low. These documents are an agent's working knowledge — an FAQ,
# a price list, a policy sheet — not a library. A high cap would invite dumping
# a whole drive in and getting vague answers.
MAX_BUSINESS_DOCUMENTS = 3

# An agent is not answerable until its owner deploys it.
DRAFT = "draft"
DEPLOYED = "deployed"


class OwnerError(Exception):
    """Raised when a workspace change would be invalid."""


@dataclass(frozen=True)
class Workspace:
    """What a caller needs to know about a workspace to render it."""
    tenant_id: str
    mode: str
    business_name: Optional[str]
    business_category: Optional[str]
    needs_setup: bool

    @property
    def is_business(self) -> bool:
        return self.mode == BUSINESS

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "business_name": self.business_name,
            "business_category": self.business_category,
            "needs_setup": self.needs_setup,
            "is_business": self.is_business,
            "max_documents": MAX_BUSINESS_DOCUMENTS if self.is_business else None,
        }


def _to_workspace(record) -> Workspace:
    # A business without a name has answered the mode question but not finished
    # setup — the frontend uses this to decide whether to show the setup screen.
    incomplete = record.mode == BUSINESS and not record.business_name
    return Workspace(
        tenant_id=record.tenant_id,
        mode=record.mode,
        business_name=record.business_name,
        business_category=record.business_category,
        needs_setup=incomplete,
    )


async def get_or_create_workspace(tenant_id: str) -> Workspace:
    """The workspace for this tenant, creating it on first sight.

    Idempotent: a race between two first requests ends with one row either way,
    because `tenant_id` is unique and the loser re-reads.
    """
    record = await repositories.get_owner(tenant_id)
    if record is None:
        try:
            record = await repositories.create_owner(tenant_id=tenant_id)
            logger.info("Workspace created for tenant %s", tenant_id)
        except Exception:
            # Lost a create race; the row now exists.
            record = await repositories.get_owner(tenant_id)
            if record is None:
                raise
    return _to_workspace(record)


async def choose_mode(
    tenant_id: str, *, mode: str,
    business_name: Optional[str] = None,
    business_category: Optional[str] = None,
) -> Workspace:
    """Answer the Personal-or-Business question."""
    if mode not in VALID_MODES:
        raise OwnerError("Choose either a personal or a business workspace.")

    if mode == BUSINESS:
        if not (business_name or "").strip():
            raise OwnerError("A business needs a name.")
        if business_category not in VALID_CATEGORIES:
            raise OwnerError("Pick a category that fits your business.")

    await get_or_create_workspace(tenant_id)
    record = await repositories.update_owner(
        tenant_id=tenant_id,
        mode=mode,
        business_name=(business_name or "").strip() or None,
        business_category=business_category,
    )
    if record is None:
        raise OwnerError("That workspace no longer exists.")

    logger.info("Workspace %s set to %s", tenant_id, mode)
    return _to_workspace(record)


# ---- Agent -----------------------------------------------------------------

DEFAULT_SCRIPT = (
    "You answer questions for this business. Be warm, brief, and accurate. "
    "If you do not know something, say so and offer to take a message rather "
    "than guessing."
)


async def get_agent_config(tenant_id: str) -> dict:
    """The owner's agent, with defaults filled in when they have not saved one.

    Returning a usable default rather than null means the editor and the test
    panel both have something to work with before the first save.
    """
    record = await repositories.get_agent(tenant_id)
    if record is None:
        return {
            "name": "Assistant",
            "script": DEFAULT_SCRIPT,
            "voice_id": "anushka",
            "rag_enabled": True,
            "greeting": None,
            "status": DRAFT,
            "configured": False,
        }
    return {
        "name": record.name,
        "status": record.status,
        "script": record.script or DEFAULT_SCRIPT,
        "voice_id": record.voice_id,
        "rag_enabled": record.rag_enabled,
        "greeting": record.greeting,
        "configured": True,
    }


async def save_agent_config(
    tenant_id: str, *, name: Optional[str] = None,
    script: Optional[str] = None, voice_id: Optional[str] = None,
    rag_enabled: Optional[bool] = None, greeting: Optional[str] = None,
    allowed_voices: Optional[frozenset[str]] = None,
) -> dict:
    """Save the agent, refusing anything the voice worker would reject.

    Validating the voice here rather than at the point of a call means a bad
    value fails while the owner is looking at the editor, instead of silently
    breaking a stranger's call days later.
    """
    if voice_id is not None and allowed_voices is not None:
        if voice_id not in allowed_voices:
            raise OwnerError("That voice is not available.")

    if script is not None and not script.strip():
        raise OwnerError("The script cannot be empty — it is what the agent says.")

    record = await repositories.upsert_agent(
        tenant_id=tenant_id,
        name=name.strip() if name is not None else None,
        script=script.strip() if script is not None else None,
        voice_id=voice_id,
        rag_enabled=rag_enabled,
        greeting=greeting.strip() if greeting is not None else None,
    )
    return {
        "name": record.name,
        "script": record.script,
        "voice_id": record.voice_id,
        "rag_enabled": record.rag_enabled,
        "greeting": record.greeting,
        "configured": True,
    }


# ---- Live context ----------------------------------------------------------

def current_context_line(timezone_name: str = "Asia/Kolkata") -> str:
    """A dated footer appended to every agent's system prompt.

    Without it the model answers "what's today?" from training data, months or
    years stale, and confidently. Anything time-relative — "are you open now",
    "is that offer still on", "how long until Friday" — is wrong for the same
    reason. Recomputed per turn rather than stored, because a prompt written
    yesterday would be exactly as stale as no prompt at all.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    try:
        now = datetime.now(ZoneInfo(timezone_name))
    except Exception:
        # An unknown zone must degrade to UTC rather than break the agent.
        now = datetime.now(ZoneInfo("UTC"))

    return (
        f"\n\nCURRENT DATE AND TIME\n"
        f"It is {now.strftime('%A, %d %B %Y, %I:%M %p')} ({timezone_name}). "
        f"Use this for anything time-dependent — today's date, opening hours, "
        f"how long until a date, whether something has passed. Never answer "
        f"from memory about the current date."
    )


def build_agent_prompt(
    *, script: str, agent_name: str, business_name: Optional[str] = None,
    timezone_name: str = "Asia/Kolkata",
) -> str:
    """Assemble what the agent actually receives.

    The owner's script leads, because it is theirs and everything else is
    scaffolding. Identity and the clock follow so a script that forgets to
    mention either still produces a coherent assistant.
    """
    parts = [script.strip() or DEFAULT_SCRIPT]

    identity = f"\n\nWHO YOU ARE\nYou are {agent_name}"
    if business_name:
        identity += f", the assistant for {business_name}"
    identity += ". Answer as that assistant, never as a general-purpose AI."
    parts.append(identity)

    parts.append(current_context_line(timezone_name))
    return "".join(parts)


# ---- Deployment ------------------------------------------------------------

async def deploy_agent(tenant_id: str) -> dict:
    """Make the agent live.

    Gated on having a script, because the failure it prevents is a stranger
    calling a link and reaching an empty prompt — which sounds broken and
    reflects on the owner, not on us.
    """
    record = await repositories.get_agent(tenant_id)
    if record is None or not (record.script or "").strip():
        raise OwnerError("Write what your assistant should say before deploying.")

    updated = await repositories.set_agent_status(tenant_id, DEPLOYED)
    logger.info("Agent deployed for tenant %s", tenant_id)
    return {"status": updated.status, "deployed_at": updated.deployed_at}


async def undeploy_agent(tenant_id: str) -> dict:
    """Take the agent offline without deleting it. Existing links stop
    connecting; nothing else is lost."""
    updated = await repositories.set_agent_status(tenant_id, DRAFT)
    return {"status": updated.status, "deployed_at": None}
