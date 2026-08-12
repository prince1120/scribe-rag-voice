"""Data access for owners and their agent.

Persistence only — no validation, no defaults beyond the column defaults, no
decisions. Rules about what a valid mode is, or whether an agent may be saved,
belong in `services/owner_service.py`; keeping them out of here means the query
layer can be read and changed without re-deriving the business rules.
"""
from typing import List, Optional

from sqlalchemy import select

from app.database import async_session
from app.models.db_models import AgentRecord, OwnerRecord


def _invalidate(tenant_id: str) -> None:
    """Drop this tenant's cached config after a write.

    Done here, in the repository, rather than in each service or route that
    performs a write. There are a dozen such call sites and they are the kind
    that get added without remembering a cache exists — the symptom being an
    owner editing their prompt, saving, and watching the assistant keep using
    the old one for the next forty-five seconds. Every mutation of these two
    tables goes through this module, so this is the one place that cannot be
    bypassed.

    Imported lazily to keep the repository layer free of a load-time dependency
    on services.
    """
    from app.services import cache

    cache.invalidate_tenant(tenant_id)



async def get_owner(tenant_id: str) -> Optional[OwnerRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()


async def get_all_owners() -> List[OwnerRecord]:
    """Return all registered owners — used by the dev-mode identity fallback
    to find the real tenant_id when only one owner exists."""
    async with async_session() as session:
        result = await session.execute(select(OwnerRecord))
        return list(result.scalars().all())


async def create_owner(
    *, tenant_id: str, mode: str = "personal",
    business_name: Optional[str] = None, business_category: Optional[str] = None,
) -> OwnerRecord:
    async with async_session() as session:
        record = OwnerRecord(
            tenant_id=tenant_id, mode=mode,
            business_name=business_name, business_category=business_category,
        )
        session.add(record)
        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


async def update_owner(
    *, tenant_id: str, mode: Optional[str] = None,
    business_name: Optional[str] = None, business_category: Optional[str] = None,
) -> Optional[OwnerRecord]:
    """Partial update: only fields explicitly passed are written.

    None means "leave alone" rather than "clear", so a caller changing just the
    mode cannot silently wipe a business name it never sent.
    """
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None

        if mode is not None:
            record.mode = mode
        if business_name is not None:
            record.business_name = business_name
        if business_category is not None:
            record.business_category = business_category
        if mode is not None:
            # Stamped whenever a mode is explicitly set, which is what makes
            # "have they answered?" a real question rather than a guess.
            from datetime import datetime, timezone as _tz
            record.mode_chosen_at = datetime.now(_tz.utc)

        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


# ---- Agent -----------------------------------------------------------------

async def get_owner_by_email(email: str) -> Optional[OwnerRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.email == email)
        )
        return result.scalar_one_or_none()


async def set_owner_credentials(
    *, tenant_id: str, email: str, password_hash: str
) -> Optional[OwnerRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        record.email = email
        record.password_hash = password_hash
        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


async def set_owner_secrets(*, tenant_id: str, **fields) -> Optional[OwnerRecord]:
    """Write provider credentials. Only fields explicitly passed are touched,
    so saving a model choice cannot silently clear a key."""
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        for key, value in fields.items():
            if value is not None:
                setattr(record, key, value)
        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


async def get_agent(tenant_id: str) -> Optional[AgentRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(AgentRecord).where(AgentRecord.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()


async def upsert_agent(
    *, tenant_id: str, name: Optional[str] = None,
    script: Optional[str] = None, voice_id: Optional[str] = None,
    language: Optional[str] = None,
    rag_enabled: Optional[bool] = None, greeting: Optional[str] = None,
    **channel_fields,
) -> AgentRecord:
    """Create the owner's agent, or update the one they already have.

    Upsert rather than separate create/update because there is exactly one
    agent per owner: `tenant_id` is unique, so "does it exist yet" is an
    implementation detail the caller should not have to handle.
    """
    async with async_session() as session:
        result = await session.execute(
            select(AgentRecord).where(AgentRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()

        if record is None:
            record = AgentRecord(tenant_id=tenant_id)
            session.add(record)

        if name is not None:
            record.name = name
        if script is not None:
            record.script = script
        if voice_id is not None:
            record.voice_id = voice_id
        if language is not None:
            record.language = language
        if rag_enabled is not None:
            record.rag_enabled = rag_enabled
        if greeting is not None:
            record.greeting = greeting

        # Per-channel settings arrive as keyword arguments so adding one is a
        # column and a form field, not another parameter threaded through
        # three layers. None still means "leave alone".
        for field, value in channel_fields.items():
            if value is not None:
                setattr(record, field, value)

        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


async def set_agent_status(tenant_id: str, status: str) -> AgentRecord:
    """Flip an agent between draft and deployed.

    `deployed_at` is cleared when going back to draft so the timestamp always
    answers "when did this last go live", never "when did it once".
    """
    from datetime import datetime, timezone as _tz

    async with async_session() as session:
        result = await session.execute(
            select(AgentRecord).where(AgentRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            record = AgentRecord(tenant_id=tenant_id)
            session.add(record)

        record.status = status
        record.deployed_at = datetime.now(_tz.utc) if status == "deployed" else None

        await session.commit()
        _invalidate(tenant_id)
        await session.refresh(record)
        return record


async def delete_agent(tenant_id: str) -> None:
    """Delete the agent record for a tenant."""
    async with async_session() as session:
        result = await session.execute(
            select(AgentRecord).where(AgentRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is not None:
            await session.delete(record)
            await session.commit()
        # Unconditional: a delete of an already-absent row still means any
        # cached copy from a moment ago must go.
        _invalidate(tenant_id)



from app.models.db_models import AgentRecord, DocumentRecord, OwnerRecord


async def get_owner_by_handle(handle: str) -> Optional[OwnerRecord]:
    """The workspace behind a public directory handle."""
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.public_handle == handle)
        )
        return result.scalar_one_or_none()


def _new_handle() -> str:
    """A short, unguessable, URL-safe public name.

    Random rather than derived from the business name: a derived handle would be
    guessable for every business in the directory, which is the property being
    removed. 16 hex characters is far more than enough to make enumeration
    pointless while staying short enough to appear in a URL.
    """
    import secrets

    return secrets.token_hex(8)


async def ensure_public_handle(tenant_id: str) -> Optional[str]:
    """This workspace's handle, minting one the first time it is needed."""
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        if not record.public_handle:
            record.public_handle = _new_handle()
            await session.commit()
        return record.public_handle


async def rotate_public_handle(tenant_id: str) -> Optional[str]:
    """Issue a new handle, invalidating every copy of the old one.

    The remedy for a business being targeted through the directory: every
    harvested handle stops resolving, and nothing else about the workspace —
    its documents, contacts, or existing invite links — is affected.
    """
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        record.public_handle = _new_handle()
        await session.commit()
        _invalidate(tenant_id)
        return record.public_handle


async def list_deployed_agents() -> List[dict]:
    """Return all businesses that have deployed their assistant.

    Returns a list of dicts with business name, category, agent name,
    greeting, language, voice availability, and chat availability.
    """
    async with async_session() as session:
        result = await session.execute(
            select(AgentRecord, OwnerRecord)
            .join(OwnerRecord, AgentRecord.tenant_id == OwnerRecord.tenant_id)
            .where(AgentRecord.status == "deployed")
        )
        rows = result.all()

        # One grouped query instead of one per listed agent. This endpoint is
        # public and unauthenticated, so an N+1 here is a database amplifier
        # anyone can pull: ten listed businesses meant eleven queries per
        # request, and it grew with the directory.
        from sqlalchemy import distinct

        doc_rows = await session.execute(
            select(distinct(DocumentRecord.tenant_id))
        )
        tenants_with_documents = set(doc_rows.scalars().all())

        agents = []
        minted = False
        for agent, owner in rows:
            # Exclude test runner or dummy tenants
            if owner.tenant_id.startswith("test_"):
                continue

            # Must be a real business workspace with a real business name
            if owner.mode != "business" or not (owner.business_name or "").strip():
                continue

            has_documents = owner.tenant_id in tenants_with_documents

            has_voice = bool((agent.voice_script or agent.script or "").strip())
            has_chat = bool((agent.chat_script or agent.script or "").strip()) and has_documents

            # Must have at least one active, working channel (voice or chat)
            if not (has_voice or has_chat):
                continue

            # Minted here rather than at signup: a handle is only meaningful
            # for a workspace that actually appears in the directory, and this
            # is the one place that decides which those are.
            if not owner.public_handle:
                owner.public_handle = _new_handle()
                minted = True

            agents.append({
                # `owner_tenant_id` is deliberately NOT published. It is the key
                # every other table joins on, so publishing it handed out a
                # permanent targeting parameter that an owner could never
                # change. The handle is opaque and rotatable.
                "handle": owner.public_handle,
                "business_name": owner.business_name.strip(),
                "business_category": owner.business_category or "Services",
                "agent_name": (agent.name or "Assistant").strip(),
                "greeting": (agent.greeting or "Hello! How can I help you today?").strip(),
                "language": agent.language or "en",
                "voice_id": agent.voice_id or "anushka",
                "has_voice": has_voice,
                "has_chat": has_chat,
                "deployed_at": agent.deployed_at.isoformat() if agent.deployed_at else None,
            })
        if minted:
            await session.commit()
        return agents
