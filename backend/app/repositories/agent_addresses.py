"""Stable per-agent public addresses. Codes are public addresses, not passwords."""
import secrets
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.database import async_session
from app.models.db_models import AgentAddressRecord, AgentRecord, AgentSnapshotRecord, OwnerRecord
from app.repositories.business import transaction_lock


async def ensure_address(tenant_id: str, snapshot_id: str | None = None) -> dict:
    for _ in range(5):
        try:
            async with async_session() as session:
                await transaction_lock(session, f"agent-address:{tenant_id}")
                target_snapshot = snapshot_id
                manual_address = None
                if target_snapshot is None:
                    current = await session.scalar(select(AgentRecord).where(AgentRecord.tenant_id == tenant_id))
                    if current is None:
                        raise LookupError("Agent not found.")
                    target_snapshot = current.active_snapshot_id
                    if target_snapshot is None:
                        # Give legacy manual agents a real saved identity before
                        # another agent can replace the workspace's active row.
                        from app.services.agent_configuration import serialize
                        target_snapshot = uuid4().hex[:12]
                        manual_address = await session.get(AgentAddressRecord, f"{tenant_id}:manual")
                        session.add(AgentSnapshotRecord(
                            snapshot_id=target_snapshot, tenant_id=tenant_id,
                            config_json=serialize(current), name=current.name, script=current.script,
                            voice_script=current.voice_script, chat_script=current.chat_script,
                            greeting=current.greeting, voice_id=current.voice_id, language=current.language,
                            stt_model=current.stt_model, tts_model=current.tts_model, source="manual",
                        ))
                        current.active_snapshot_id = target_snapshot
                        await session.flush()
                identity = f"{tenant_id}:{target_snapshot}"
                record = await session.get(AgentAddressRecord, identity)
                if record is None and manual_address:
                    record = manual_address
                    record.identity_key = identity
                    record.snapshot_id = target_snapshot
                if record is None:
                    if not await session.scalar(select(AgentSnapshotRecord.id).where(
                        AgentSnapshotRecord.tenant_id == tenant_id,
                        AgentSnapshotRecord.snapshot_id == target_snapshot,
                    )):
                        raise LookupError("Agent not found.")
                    record = AgentAddressRecord(
                        identity_key=identity, tenant_id=tenant_id, snapshot_id=target_snapshot,
                        handle=secrets.token_urlsafe(12), code=str(10_000_000 + secrets.randbelow(90_000_000)),
                    )
                    session.add(record)
                await session.commit()
                if snapshot_id is None:
                    from app.services.cache import invalidate_tenant
                    invalidate_tenant(tenant_id)
                return {"handle": record.handle, "code": record.code}
        except IntegrityError:
            # Unique constraints arbitrate simultaneous allocation and random
            # collisions across API processes; retry rather than reassign codes.
            continue
    raise RuntimeError("Could not allocate an agent address. Try again.")


async def find_address(value: str):
    """Find this exact agent, including offline agents, without changing routing."""
    if not 8 <= len(value) <= 32 or not all(c.isascii() and (c.isalnum() or c in "-_") for c in value):
        return None
    async with async_session() as session:
        address = await session.scalar(select(AgentAddressRecord).where(or_(
            AgentAddressRecord.handle == value, AgentAddressRecord.code == value,
        )))
        if address:
            current = await session.scalar(select(AgentRecord).where(AgentRecord.tenant_id == address.tenant_id))
            owner = await session.scalar(select(OwnerRecord).where(OwnerRecord.tenant_id == address.tenant_id))
            agent = await session.scalar(select(AgentSnapshotRecord).where(
                AgentSnapshotRecord.tenant_id == address.tenant_id,
                AgentSnapshotRecord.snapshot_id == address.snapshot_id,
            )) if address.snapshot_id else current
            online = bool(current and current.active_snapshot_id == address.snapshot_id and current.status == "deployed")
            if online:
                from app.services.agent_configuration import published_agent
                agent = published_agent(current)
        else:
            # Existing workspace directory links continue to resolve unchanged.
            owner = await session.scalar(select(OwnerRecord).where(OwnerRecord.public_handle == value))
            agent = await session.scalar(select(AgentRecord).where(AgentRecord.tenant_id == owner.tenant_id)) if owner else None
            online = bool(agent and agent.status == "deployed")
            if online:
                from app.services.agent_configuration import published_agent
                agent = published_agent(agent)
        if not owner or not agent:
            return None
        channels = public_agent(owner, agent)
        online = online and (channels["has_voice"] or channels["has_chat"])
        return owner, agent, address, online


async def resolve_address(value: str):
    """Call admission requires this particular agent to be published and selected."""
    found = await find_address(value)
    return found[:2] if found and found[3] else None


def public_agent(owner, agent) -> dict:
    voice = getattr(agent, "voice_script", None)
    chat = getattr(agent, "chat_script", None)
    separate = voice is not None or chat is not None
    return {"business_name": owner.business_name or "Business", "agent_name": agent.name or "Assistant",
            "has_voice": bool((voice if separate else agent.script) or ""),
            "has_chat": bool((chat if separate else agent.script) or "")}
