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
from app.services import prompt_rules

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
    # False until the owner has answered Personal-or-Business at least once.
    answered: bool
    email: Optional[str] = None

    @property
    def is_business(self) -> bool:
        return self.mode == BUSINESS

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "business_name": self.business_name,
            "business_category": self.business_category,
            "needs_setup": self.needs_setup,
            "answered": self.answered,
            "is_business": self.is_business,
            "email": self.email,
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
        answered=getattr(record, "mode_chosen_at", None) is not None,
        email=getattr(record, "email", None),
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


def _mask_enc(encrypted):
    """Show that a key exists without handing it back."""
    if not encrypted:
        return None
    from app.services import secrets_box

    try:
        return secrets_box.mask(secrets_box.decrypt(encrypted))
    except secrets_box.SecretError:
        return "unreadable - please re-enter"


async def get_agent_config(tenant_id: str) -> dict:
    """The owner's agent, with defaults filled in when they have not saved one.

    Returning a usable default rather than null means the editor and the test
    panel both have something to work with before the first save.
    """
    record = await repositories.get_agent(tenant_id)
    if record is None:
        return {
            "voice_script": None,
            "chat_script": None,
            "voice_model": None,
            "chat_model": None,
            "voice_base_url": None,
            "chat_base_url": None,
            "voice_api_key": None,
            "chat_api_key": None,
            "voice_temperature": None,
            "voice_max_tokens": None,
            "chat_temperature": None,
            "chat_max_tokens": None,
            "name": "Assistant",
            "script": DEFAULT_SCRIPT,
            "voice_id": "anushka",
            "language": "unknown",
            "rag_enabled": True,
            "greeting": None,
            "style_rules_enabled": True,
            "status": DRAFT,
            "configured": False,
        }
    return {
        "voice_script": record.voice_script,
        "chat_script": record.chat_script,
        "voice_model": record.voice_model,
        "chat_model": record.chat_model,
        "voice_base_url": record.voice_base_url,
        "chat_base_url": record.chat_base_url,
        "voice_api_key": _mask_enc(record.voice_api_key_enc),
        "chat_api_key": _mask_enc(record.chat_api_key_enc),
        "voice_temperature": record.voice_temperature,
        "voice_max_tokens": record.voice_max_tokens,
        "chat_temperature": record.chat_temperature,
        "chat_max_tokens": record.chat_max_tokens,
        "name": record.name,
        "status": record.status,
        "script": record.script or DEFAULT_SCRIPT,
        "voice_id": record.voice_id,
        "language": record.language,
        "rag_enabled": record.rag_enabled,
        "greeting": record.greeting,
        "style_rules_enabled": bool(getattr(record, "style_rules_enabled", True)),
        "configured": True,
    }


async def save_agent_config(
    tenant_id: str, *, name: Optional[str] = None,
    script: Optional[str] = None, voice_id: Optional[str] = None,
    language: Optional[str] = None,
    rag_enabled: Optional[bool] = None, greeting: Optional[str] = None,
    style_rules_enabled: Optional[bool] = None,
    allowed_voices: Optional[frozenset[str]] = None,
    **channel_fields,
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

    # Channel API keys are secrets like any other, so they are encrypted here
    # rather than left as columns anyone with a database dump can read.
    from app.services import secrets_box

    for field in ("voice_api_key", "chat_api_key"):
        value = channel_fields.pop(field, None)
        if value is not None:
            channel_fields[f"{field}_enc"] = (
                secrets_box.encrypt(value.strip()) if value.strip() else ""
            )

    record = await repositories.upsert_agent(
        tenant_id=tenant_id,
        name=name.strip() if name is not None else None,
        script=script.strip() if script is not None else None,
        voice_id=voice_id,
        language=language,
        rag_enabled=rag_enabled,
        greeting=greeting.strip() if greeting is not None else None,
        style_rules_enabled=style_rules_enabled,
        **channel_fields,
    )
    return {
        "voice_script": record.voice_script,
        "chat_script": record.chat_script,
        "voice_model": record.voice_model,
        "chat_model": record.chat_model,
        "voice_base_url": record.voice_base_url,
        "chat_base_url": record.chat_base_url,
        "voice_api_key": _mask_enc(record.voice_api_key_enc),
        "chat_api_key": _mask_enc(record.chat_api_key_enc),
        "voice_temperature": record.voice_temperature,
        "voice_max_tokens": record.voice_max_tokens,
        "chat_temperature": record.chat_temperature,
        "chat_max_tokens": record.chat_max_tokens,
        "name": record.name,
        "script": record.script,
        "voice_id": record.voice_id,
        "language": record.language,
        "rag_enabled": record.rag_enabled,
        "greeting": record.greeting,
        "style_rules_enabled": bool(getattr(record, "style_rules_enabled", True)),
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


# ---- Delivery rules --------------------------------------------------------
# The owner's script says who the assistant is and what it knows. The rules in
# `prompt_rules` say how it *delivers*. They are shared with the personal-mode
# prompt builder in `voice/config.py` rather than duplicated here: two copies of
# "how long should a spoken reply be" would drift, and the one that drifted
# would be whichever nobody was testing that week.


def build_agent_prompt(
    *, script: str, agent_name: str, business_name: Optional[str] = None,
    timezone_name: str = "Asia/Kolkata",
    channel: str = "voice", style_rules: bool = True,
) -> str:
    """Assemble what the agent actually receives.

    The owner's script leads, because it is theirs and everything else is
    scaffolding. Identity and the clock follow so a script that forgets to
    mention either still produces a coherent assistant.

    Delivery rules come last, and only when `style_rules` is on. They are last
    rather than first for the same reason the script is first: the owner sets
    the character, we set the format, and format should not be what the model
    reads as its primary instruction. An owner who wants a deliberately verbose
    or differently-formatted agent turns the toggle off and owns the result.
    """
    parts = [script.strip() or DEFAULT_SCRIPT]

    identity = f"\n\nWHO YOU ARE\nYou are {agent_name}"
    if business_name:
        identity += f", the assistant for {business_name}"
    identity += ". Answer as that assistant, never as a general-purpose AI."
    parts.append(identity)

    parts.append(current_context_line(timezone_name))

    if style_rules:
        parts.append(prompt_rules.DELIVERY_RULES.get(channel, prompt_rules.VOICE_DELIVERY))
    return "".join(parts)


# ---- Deployment ------------------------------------------------------------

async def deploy_agent(tenant_id: str) -> dict:
    """Make the agent live."""
    record = await repositories.get_agent(tenant_id)
    has_prompt = bool(
        record
        and (
            (record.script or "").strip()
            or (record.voice_script or "").strip()
            or (record.chat_script or "").strip()
        )
    )
    if record is None or not has_prompt:
        raise OwnerError("Write what your assistant should say before deploying.")

    # If script column is blank, sync it from voice_script or chat_script
    if not (record.script or "").strip():
        sync_script = (record.voice_script or record.chat_script or "").strip()
        if sync_script:
            await repositories.upsert_agent(tenant_id=tenant_id, script=sync_script)

    updated = await repositories.set_agent_status(tenant_id, DEPLOYED)
    logger.info("Agent deployed for tenant %s", tenant_id)
    return {"status": updated.status, "deployed_at": updated.deployed_at}


async def undeploy_agent(tenant_id: str) -> dict:
    """Take the agent offline without deleting it. Existing links stop
    connecting; nothing else is lost."""
    updated = await repositories.set_agent_status(tenant_id, DRAFT)
    return {"status": updated.status, "deployed_at": None}


async def delete_agent(tenant_id: str) -> dict:
    """Delete/reset the agent for this tenant back to fresh draft defaults."""
    await repositories.delete_agent(tenant_id)
    logger.info("Agent reset/deleted for tenant %s", tenant_id)
    return {"status": DRAFT, "configured": False}



# ---- Provider credentials --------------------------------------------------

async def get_provider_settings(tenant_id: str) -> dict:
    """What the console shows on the settings screen.

    Keys come back **masked**, never in full. An owner needs to recognise which
    key is stored so they know whether to replace it; they never need to read it
    back, and returning it would put a live credential in a browser and in
    every proxy log between here and there.
    """
    from app.services import secrets_box

    record = await repositories.get_owner(tenant_id)
    if record is None:
        return {}

    def hint(encrypted: Optional[str]) -> Optional[str]:
        if not encrypted:
            return None
        try:
            return secrets_box.mask(secrets_box.decrypt(encrypted))
        except secrets_box.SecretError:
            # A key that cannot be decrypted is a key that cannot be used —
            # say so rather than showing a hint that implies it works.
            return "unreadable — please re-enter"

    return {
        "groq_key": hint(record.groq_key_enc),
        "sarvam_key": hint(record.sarvam_key_enc),
        "custom_llm_key": hint(record.custom_llm_key_enc),
        "custom_llm_base_url": record.custom_llm_base_url,
        "llm_model": record.llm_model,
        "has_groq": bool(record.groq_key_enc),
        "has_sarvam": bool(record.sarvam_key_enc),
    }


async def save_provider_settings(
    tenant_id: str, *, groq_key: Optional[str] = None,
    sarvam_key: Optional[str] = None, custom_llm_key: Optional[str] = None,
    custom_llm_base_url: Optional[str] = None, llm_model: Optional[str] = None,
) -> dict:
    """Store provider credentials, encrypting anything secret.

    An empty string means "clear this", while None means "leave it alone" —
    the distinction matters because the console sends only the fields the owner
    actually edited, and a blank field should not wipe a working key.
    """
    from app.services import secrets_box

    await get_or_create_workspace(tenant_id)

    fields: dict = {}
    for name, value in (
        ("groq_key_enc", groq_key),
        ("sarvam_key_enc", sarvam_key),
        ("custom_llm_key_enc", custom_llm_key),
    ):
        if value is None:
            continue
        fields[name] = secrets_box.encrypt(value.strip()) if value.strip() else ""

    if custom_llm_base_url is not None:
        url = custom_llm_base_url.strip()
        if url and not url.startswith(("http://", "https://")):
            raise OwnerError("The model URL should start with https://")
        fields["custom_llm_base_url"] = url
    if llm_model is not None:
        fields["llm_model"] = llm_model.strip()

    if fields:
        await repositories.set_owner_secrets(tenant_id=tenant_id, **fields)
    logger.info("Provider settings updated for %s", tenant_id)
    return await get_provider_settings(tenant_id)


async def cached_agent(tenant_id: str):
    """The agent record, cached for the config TTL.

    Read on every chat turn and every voice-token request. Uncached, that was a
    database round trip in front of the LLM call — and against Supabase's
    connection pooler a single trivial query has been measured at 3.5s.
    """
    from app.services import cache

    return await cache.config_cache.get_or_load(
        ("agent", tenant_id), lambda: repositories.get_agent(tenant_id)
    )


async def cached_owner(tenant_id: str):
    """The workspace record, cached for the config TTL. Same reasoning."""
    from app.services import cache

    return await cache.config_cache.get_or_load(
        ("owner", tenant_id), lambda: repositories.get_owner(tenant_id)
    )


async def resolve_credentials(tenant_id: str, record=None) -> dict:
    """The actual keys, for server-side use only.

    Never goes to a browser. Callers reaching an owner's agent spend that
    owner's quota, which is the point — but it means this must be resolved from
    the workspace rather than from anything the caller sent.

    `record` lets a caller that has already loaded the owner pass it in. Without
    it this issued its own `get_owner` even when the caller had just fetched the
    same row a line earlier — which is exactly what the chat path did on every
    turn, paying for two round trips to read one row.
    """
    from app.services import secrets_box

    if record is None:
        record = await cached_owner(tenant_id)
    if record is None:
        return {}

    def read(encrypted: Optional[str]) -> Optional[str]:
        if not encrypted:
            return None
        try:
            return secrets_box.decrypt(encrypted)
        except secrets_box.SecretError:
            logger.warning("Unreadable stored key for tenant %s", tenant_id)
            return None

    return {
        "groq_api_key": read(record.groq_key_enc),
        "sarvam_api_key": read(record.sarvam_key_enc),
        "custom_llm_api_key": read(record.custom_llm_key_enc),
        "custom_llm_base_url": record.custom_llm_base_url or None,
        "llm_model": record.llm_model or None,
    }


def _decrypt_quietly(encrypted):
    """A key that cannot be read is a key that cannot be used."""
    if not encrypted:
        return None
    from app.services import secrets_box

    try:
        return secrets_box.decrypt(encrypted)
    except secrets_box.SecretError:
        logger.warning("Unreadable channel key")
        return None


def channel_settings(agent, channel: str) -> dict:
    """What a single channel should actually use.

    Voice and chat are different jobs — a spoken answer must be short and
    cannot use markdown, a typed one can be structured and long — so each may
    override the shared script, model, temperature, and token ceiling. Anything
    the owner left unset falls back: first to the shared script, then to the
    server default, rather than to a number this function invented.
    """
    if agent is None:
        return {}

    prefix = "voice" if channel == "voice" else "chat"

    # Stripped before the fallback, not after: a field the owner cleared to
    # whitespace is an unset override, and treating it as set would leave that
    # channel with no prompt at all.
    # The per-channel prompt is the prompt. `script` remains as a fallback for
    # agents saved before the channels were split, so nobody loses an assistant
    # they had already written.
    override = (getattr(agent, f"{prefix}_script", None) or "").strip()
    script = override or (agent.script or "")
    return {
        "script": (script or "").strip() or None,
        "model": getattr(agent, f"{prefix}_model", None),
        "temperature": getattr(agent, f"{prefix}_temperature", None),
        "max_tokens": getattr(agent, f"{prefix}_max_tokens", None),
        # A custom endpoint replaces the provider entirely for this channel.
        # A model name without one is just a name.
        "base_url": getattr(agent, f"{prefix}_base_url", None),
        "api_key": _decrypt_quietly(getattr(agent, f"{prefix}_api_key_enc", None)),
        # Shared across channels rather than per-channel: an owner who wants
        # our delivery rules off wants their own prompt honoured everywhere,
        # and a per-channel version of this would be a setting nobody asked
        # for. `getattr` default keeps agents saved before the column existed
        # on the rules rather than silently off.
        "style_rules": bool(getattr(agent, "style_rules_enabled", True)),
    }


async def available_channels(tenant_id: str) -> dict:
    """Which channels this agent can actually serve.

    A channel needs a prompt. An unwritten one is not a quiet default — it is
    an assistant with nothing to say, and offering it means someone is sent a
    link to a blank agent.

    Chat additionally needs documents, because chat always answers from them.
    That is the product rather than a preference, which is why the RAG toggle
    exists on voice alone: an owner may legitimately want a spoken agent that
    works from its prompt and nothing else.

    Used by the test panel, the link-type picker, and link creation, so the
    console can never offer a channel that would not work.
    """
    from app import repositories

    agent = await repositories.get_agent(tenant_id)
    documents = await repositories.list_documents(tenant_id)
    has_documents = len(documents) > 0

    def has_prompt(channel: str) -> bool:
        return bool((channel_settings(agent, channel) or {}).get("script"))

    voice_ready = has_prompt("voice")
    chat_ready = has_prompt("chat") and has_documents

    def chat_reason() -> Optional[str]:
        if not has_prompt("chat"):
            return "Write a chat prompt to enable it."
        if not has_documents:
            return "Chat answers from your documents. Add one to enable it."
        return None

    return {
        "voice": voice_ready,
        "chat": chat_ready,
        "document_count": len(documents),
        "voice_blocked_reason": (
            None if voice_ready else "Write a voice prompt to enable it."
        ),
        "chat_blocked_reason": chat_reason(),
    }
