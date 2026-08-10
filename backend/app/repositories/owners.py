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


async def get_owner(tenant_id: str) -> Optional[OwnerRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(OwnerRecord).where(OwnerRecord.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()


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

        await session.commit()
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
        await session.refresh(record)
        return record
