"""Tenant-scoped persistence for business requests and canonical voice calls."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import delete, func, select, text

from app.database import async_session
from app.models.db_models import (
    BusinessRequestRecord, ContactRecord, ContactSessionRecord,
    ConversationRecord, MessageRecord, VoiceCallRecord,
)


def now():
    return datetime.now(timezone.utc)


async def transaction_lock(session, key: str):
    """Serialize check-and-write operations across API and worker processes."""
    dialect = session.bind.dialect.name
    if dialect == "sqlite":
        await session.execute(text("BEGIN IMMEDIATE"))
    elif dialect == "postgresql":
        lock_id = int.from_bytes(sha256(key.encode()).digest()[:8], "big", signed=True)
        await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})


async def create_call(tenant_id, contact_id, ip_address=None, user_agent=None,
                      context_label=None, voice_consent_at=None):
    call_id, conversation_id = str(uuid4()), str(uuid4())
    async with async_session() as session:
        session.add(VoiceCallRecord(call_id=call_id, tenant_id=tenant_id,
                                   contact_id=contact_id, conversation_id=conversation_id,
                                   context_label=(context_label or "").strip()[:240] or None,
                                   voice_consent_at=voice_consent_at))
        session.add(ConversationRecord(conversation_id=conversation_id, tenant_id=tenant_id))
        if contact_id:
            session.add(ContactSessionRecord(
                session_id=call_id, contact_id=contact_id, conversation_id=conversation_id,
                channel="voice", ip_address=ip_address, user_agent=(user_agent or "")[:300],
            ))
        await session.commit()
    return call_id


async def get_call(call_id, tenant_id, contact_id=None):
    async with async_session() as session:
        q = select(VoiceCallRecord).where(VoiceCallRecord.call_id == call_id,
                                         VoiceCallRecord.tenant_id == tenant_id)
        if contact_id:
            q = q.where(VoiceCallRecord.contact_id == contact_id)
        return await session.scalar(q)


async def save_call(call_id, tenant_id, contact_id, messages, duration_seconds,
                    *, source="browser", completed=True):
    async with async_session() as session:
        await transaction_lock(session, f"call:{call_id}")
        q = select(VoiceCallRecord).where(VoiceCallRecord.call_id == call_id,
                                         VoiceCallRecord.tenant_id == tenant_id)
        if contact_id:
            q = q.where(VoiceCallRecord.contact_id == contact_id)
        call = await session.scalar(q)
        if not call:
            raise LookupError("Call not found")
        # Worker transcripts are authoritative; delayed beacons cannot replace them.
        accept = source == "worker" or call.transcript_source != "worker"
        changed = False
        if accept and messages and (source == "worker" or len(messages) >= len(call.transcript)):
            changed = call.transcript != messages
            if changed:
                call.transcript = messages
                await session.execute(delete(MessageRecord).where(
                    MessageRecord.conversation_id == call.conversation_id))
                for i, msg in enumerate(messages):
                    session.add(MessageRecord(conversation_id=call.conversation_id,
                        role=msg["role"], content=msg["content"],
                        created_at=call.created_at + timedelta(microseconds=i)))
            call.transcript_source = source
        call.duration_seconds = max(call.duration_seconds, min(14400, max(0, duration_seconds)))
        call.completed = call.completed or completed
        call.updated_at = now()
        if call.completed and call.transcript:
            should_queue = False
            if call.summary_status == "waiting":
                should_queue = True
            elif changed and source == "worker" and call.summary_status not in ("ready",):
                should_queue = True
            elif changed and source == "browser" and call.summary_status in ("waiting", "pending"):
                should_queue = True

            if should_queue:
                call.summary_status = "pending"
                call.summary = None
                call.summary_attempts = 0
                call.summary_lease = None
                # Give the worker's shutdown snapshot time to supersede the browser.
                call.next_attempt_at = now() + timedelta(seconds=5)
        contact_session = await session.scalar(select(ContactSessionRecord).where(
            ContactSessionRecord.session_id == call_id))
        if contact_session:
            contact_session.message_count = len(call.transcript)
            contact_session.duration_seconds = call.duration_seconds
            contact_session.last_activity_at = now()
        await session.commit()
        return call


async def create_request(tenant_id, contact_id, request_id, message, reply_to, call_id=None):
    async with async_session() as session:
        await transaction_lock(session, f"requests:{contact_id}")
        existing = await session.get(BusinessRequestRecord, request_id)
        if existing:
            if existing.tenant_id != tenant_id or existing.contact_id != contact_id:
                raise LookupError("Request not found")
            return existing
        contact = await session.scalar(select(ContactRecord).where(
            ContactRecord.contact_id == contact_id, ContactRecord.owner_tenant_id == tenant_id))
        if not contact:
            raise LookupError("Contact not found")
        from app.contacts import check_usable
        check_usable(revoked_at=contact.revoked_at, expires_at=contact.expires_at,
                     blocked_at=contact.blocked_at)
        count = await session.scalar(select(func.count()).select_from(BusinessRequestRecord).where(
            BusinessRequestRecord.contact_id == contact_id,
            BusinessRequestRecord.created_at >= now() - timedelta(days=1)))
        if count >= 10:
            raise ValueError("You have sent several requests today. Please wait for the business to respond.")
        if call_id and not await session.scalar(select(VoiceCallRecord.call_id).where(
            VoiceCallRecord.call_id == call_id, VoiceCallRecord.tenant_id == tenant_id,
            VoiceCallRecord.contact_id == contact_id)):
            raise LookupError("Call not found")
        record = BusinessRequestRecord(request_id=request_id, tenant_id=tenant_id,
            contact_id=contact_id, message=message, reply_to=reply_to, call_id=call_id)
        session.add(record)
        await session.commit()
        return record


async def list_requests(tenant_id, status=None, limit=50, offset=0):
    async with async_session() as session:
        base = select(BusinessRequestRecord, ContactRecord.name).join(ContactRecord,
            ContactRecord.contact_id == BusinessRequestRecord.contact_id).where(
            BusinessRequestRecord.tenant_id == tenant_id,
            ContactRecord.owner_tenant_id == tenant_id)
        if status:
            base = base.where(BusinessRequestRecord.status == status)
        total = await session.scalar(select(func.count()).select_from(base.subquery()))
        rows = (await session.execute(base.order_by(BusinessRequestRecord.created_at.desc())
                                      .limit(limit).offset(offset))).all()
        return rows, total


async def update_request(tenant_id, request_id, status, owner_note):
    async with async_session() as session:
        record = await session.scalar(select(BusinessRequestRecord).where(
            BusinessRequestRecord.request_id == request_id,
            BusinessRequestRecord.tenant_id == tenant_id))
        if not record:
            raise LookupError("Request not found")
        record.status, record.owner_note, record.updated_at = status, owner_note, now()
        await session.commit()
        return record


async def list_calls(tenant_id, limit=50, offset=0):
    async with async_session() as session:
        base = select(VoiceCallRecord, ContactRecord.name).outerjoin(ContactRecord,
            ContactRecord.contact_id == VoiceCallRecord.contact_id).where(
            VoiceCallRecord.tenant_id == tenant_id, VoiceCallRecord.completed.is_(True))
        total = await session.scalar(select(func.count()).select_from(base.subquery()))
        rows = (await session.execute(base.order_by(VoiceCallRecord.created_at.desc())
                                      .limit(limit).offset(offset))).all()
        return rows, total


async def claim_summary():
    async with async_session() as session:
        await transaction_lock(session, "summary-queue")
        call = await session.scalar(select(VoiceCallRecord).where(
            VoiceCallRecord.summary_status.in_(["pending", "processing"]),
            VoiceCallRecord.next_attempt_at <= now(),
        ).order_by(VoiceCallRecord.next_attempt_at).limit(1))
        if not call:
            return None
        if call.summary_attempts >= 3:
            call.summary_status = "failed"
            await session.commit()
            return None
        call.summary_status = "processing"
        call.summary_attempts += 1
        call.summary_lease = str(uuid4())
        call.next_attempt_at = now() + timedelta(seconds=60)
        await session.commit()
        return call


async def finish_summary(call_id, lease, summary=None, tokens=0, unavailable=False):
    async with async_session() as session:
        await transaction_lock(session, f"call:{call_id}")
        call = await session.get(VoiceCallRecord, call_id)
        if not call or call.summary_lease != lease:
            return  # A newer transcript invalidated this job.
        call.summary_tokens += tokens
        call.summary = summary
        call.summary_status = ("ready" if summary else "unavailable" if unavailable
                               else "failed" if call.summary_attempts >= 3 else "pending")
        call.next_attempt_at = now() + timedelta(seconds=30 * call.summary_attempts)
        call.summary_lease = None
        await session.commit()
