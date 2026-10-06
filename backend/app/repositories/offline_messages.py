"""Offline messages enter the existing owner Inbox without an AI call or guest session."""
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import func, select

from app import contacts
from app.database import async_session
from app.models.db_models import BusinessRequestRecord, ContactRecord
from app.repositories.business import now, transaction_lock


async def save_offline_message(owner, agent, address, body) -> str:
    handle = address.handle if address else owner.public_handle
    code = address.code if address else handle
    request_id = str(uuid5(NAMESPACE_URL, f"offline:{handle}:{body.request_id}"))
    async with async_session() as session:
        await transaction_lock(session, f"offline-inbox:{owner.tenant_id}")
        existing = await session.get(BusinessRequestRecord, request_id)
        if existing:
            return request_id
        # A public endpoint cannot rely on a per-contact cap: each visitor can
        # create a fresh contact. Bound the workspace's offline intake instead.
        count = await session.scalar(select(func.count()).select_from(BusinessRequestRecord).where(
            BusinessRequestRecord.tenant_id == owner.tenant_id,
            BusinessRequestRecord.kind == "offline_message",
            BusinessRequestRecord.created_at >= now() - timedelta(days=1),
        ))
        if count >= 100:
            raise ValueError("This business has received many messages today. Please try again later.")
        contact_id = str(uuid4())
        session.add(ContactRecord(
            contact_id=contact_id, owner_tenant_id=owner.tenant_id, name=body.name,
            note=f"Offline agent: {agent.name} · code {code} · {handle}"[:500],
            source="directory", token_hash=contacts.hash_token(contacts.generate_token()),
            expires_at=contacts.default_expiry(1), mode="chat", max_sessions_per_day=0,
        ))
        session.add(BusinessRequestRecord(
            request_id=request_id, tenant_id=owner.tenant_id, contact_id=contact_id,
            kind="offline_message", reply_to=body.reply_to,
            message=f"Tried to reach offline agent {agent.name} (code {code}).\n\n{body.message}",
        ))
        await session.commit()
    return request_id
