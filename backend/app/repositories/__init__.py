"""Async data-access helpers for the documents/conversations tables.

Kept as plain functions (not a class) — this app has no ORM-heavy domain
logic, just a handful of CRUD-shaped queries.
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.db_models import (
    ContactRecord, ContactSessionRecord, ConversationRecord, DocumentRecord,
    MessageRecord,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---- Documents --------------------------------------------------------------

async def save_document(
    document_id: str, tenant_id: str, filename: str, file_size: int, chunk_count: int,
    status: str = "processed",
) -> None:
    async with async_session() as session:
        session.add(DocumentRecord(
            document_id=document_id, tenant_id=tenant_id, filename=filename,
            file_size=file_size, chunk_count=chunk_count, status=status,
        ))
        await session.commit()


async def list_documents(tenant_id: str) -> List[DocumentRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord)
            .where(DocumentRecord.tenant_id == tenant_id)
            .order_by(DocumentRecord.created_at.desc())
        )
        return list(result.scalars().all())


async def get_document_record(document_id: str, tenant_id: str) -> Optional[DocumentRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        return result.scalar_one_or_none()


async def list_enabled_document_ids(tenant_id: str) -> List[str]:
    """The documents this tenant's assistant is allowed to answer from.

    Read on every chat and voice turn, and it is the enforcement point for
    document selection — so it returns ids rather than rows, and the caller
    turns them into a vector-store filter. Selecting nothing means the assistant
    answers from its prompt alone, which is a legitimate configuration and must
    not be confused with "no filter".
    """
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord.document_id).where(
                DocumentRecord.tenant_id == tenant_id,
                DocumentRecord.agent_enabled.is_(True),
            )
        )
        return list(result.scalars().all())


async def set_document_enabled(
    document_id: str, tenant_id: str, enabled: bool
) -> bool:
    """Include or exclude one document from the assistant. False if not found.

    `tenant_id` is in the WHERE clause, so an owner cannot toggle a document
    belonging to someone else by guessing an id.
    """
    async with async_session() as session:
        result = await session.execute(
            update(DocumentRecord)
            .where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
            .values(agent_enabled=enabled)
        )
        await session.commit()
        return result.rowcount > 0


async def update_document(document_id: str, tenant_id: str, chunk_count: int, file_size: int) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            record.chunk_count = chunk_count
            record.file_size = file_size
            await session.commit()


async def delete_document_record(document_id: str, tenant_id: str) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            await session.delete(record)
            await session.commit()


async def list_expired_documents(
    cutoff: datetime, include_owner: bool, owner_tenant_id: str
) -> List[DocumentRecord]:
    """Documents last touched before `cutoff`.

    Returned rather than deleted here so the caller can remove each one's
    vectors and file first — deleting the row on its own is what strands
    orphaned chunks in the vector store.
    """
    async with async_session() as session:
        query = select(DocumentRecord).where(DocumentRecord.created_at < cutoff)
        if not include_owner:
            query = query.where(DocumentRecord.tenant_id != owner_tenant_id)
        result = await session.execute(query)
        return list(result.scalars().all())


# ---- Conversations ----------------------------------------------------------

async def get_or_create_conversation(conversation_id: str, tenant_id: str) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord).where(ConversationRecord.conversation_id == conversation_id)
        )
        if result.scalar_one_or_none() is None:
            session.add(ConversationRecord(conversation_id=conversation_id, tenant_id=tenant_id))
            await session.commit()


async def append_message(
    conversation_id: str, tenant_id: str, role: str, content: str,
    citations: Optional[list] = None,
) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord).where(ConversationRecord.conversation_id == conversation_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation is None:
            conversation = ConversationRecord(conversation_id=conversation_id, tenant_id=tenant_id)
            session.add(conversation)
            await session.flush()

        session.add(MessageRecord(
            conversation_id=conversation_id, role=role, content=content, citations=citations,
        ))
        conversation.updated_at = datetime.now(timezone.utc)
        await session.commit()


async def get_conversation(
    conversation_id: str, tenant_id: str
) -> Optional[ConversationRecord]:
    """One conversation with its messages, scoped by tenant.

    Exists because reading a single transcript used to call `list_conversations`
    and filter the result in Python — pulling every conversation and every
    message the tenant has ever had into memory to return one of them. That is
    fine with three rows and fatal with three thousand.

    `tenant_id` is in the WHERE clause, not checked afterwards, so a guessed
    conversation id cannot reach another workspace's history.
    """
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord)
            .where(
                ConversationRecord.conversation_id == conversation_id,
                ConversationRecord.tenant_id == tenant_id,
            )
            .options(selectinload(ConversationRecord.messages))
        )
        return result.scalar_one_or_none()


async def get_contact_session(
    session_id: str, contact_id: str
) -> Optional[ContactSessionRecord]:
    """One session, scoped by the contact that owns it.

    Same reasoning: this was a `list_contact_sessions` call followed by a linear
    scan for a matching id.
    """
    async with async_session() as session:
        result = await session.execute(
            select(ContactSessionRecord).where(
                ContactSessionRecord.session_id == session_id,
                ContactSessionRecord.contact_id == contact_id,
            )
        )
        return result.scalar_one_or_none()


async def list_conversations(tenant_id: str) -> List[ConversationRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord)
            .where(ConversationRecord.tenant_id == tenant_id)
            .options(selectinload(ConversationRecord.messages))
            .order_by(ConversationRecord.updated_at.desc())
        )
        return list(result.scalars().all())


# ---- Contacts (invite-link & directory identities) -------------------------

async def create_contact(
    *, contact_id: str, owner_tenant_id: str, name: str, note: Optional[str],
    token_hash: str, pin: Optional[str], expires_at: Optional[datetime],
    max_sessions_per_day: int, mode: str = "both", source: str = "owner",
    client_id: Optional[str] = None,
) -> ContactRecord:
    # Hash the PIN before persisting — a database leak must not yield the PIN
    # directly. Salt with the token hash so identical PINs across contacts
    # produce different stored values.
    stored_pin: Optional[str] = None
    if pin:
        from app.contacts import hash_pin as _hash_pin

        stored_pin = _hash_pin(pin, salt=token_hash)
    async with async_session() as session:
        record = ContactRecord(
            contact_id=contact_id, owner_tenant_id=owner_tenant_id, name=name,
            note=note, token_hash=token_hash, pin=stored_pin, expires_at=expires_at,
            max_sessions_per_day=max_sessions_per_day, mode=mode, source=source,
            client_id=client_id,
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return record


async def get_contact_by_token_hash(token_hash: str) -> Optional[ContactRecord]:
    """Looked up by hash, never by plaintext — the token is not stored."""
    async with async_session() as session:
        result = await session.execute(
            select(ContactRecord).where(ContactRecord.token_hash == token_hash)
        )
        return result.scalar_one_or_none()


async def get_contact(contact_id: str, owner_tenant_id: str) -> Optional[ContactRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(ContactRecord).where(
                ContactRecord.contact_id == contact_id,
                ContactRecord.owner_tenant_id == owner_tenant_id,
            )
        )
        return result.scalar_one_or_none()


# NOTE: there is deliberately no `get_active_contact_by_name`. One existed, and
# the public `/directory/connect` route used it to find a contact by a
# caller-supplied name and hand back a freshly rotated token for it — an
# account takeover against any deployed assistant, since names are not secrets.
# A contact is identified by its token hash and nothing else. If you need to
# recognise a returning visitor, key on something they can prove.


async def list_contacts(owner_tenant_id: str) -> List[ContactRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(ContactRecord)
            .where(ContactRecord.owner_tenant_id == owner_tenant_id)
            .order_by(ContactRecord.created_at.desc())
        )
        return list(result.scalars().all())


async def bind_contact_device(contact_id: str, device_id: str) -> None:
    async with async_session() as session:
        await session.execute(
            update(ContactRecord)
            .where(ContactRecord.contact_id == contact_id)
            .values(bound_device=device_id, last_seen_at=_utcnow())
        )
        await session.commit()


async def touch_contact(contact_id: str) -> None:
    async with async_session() as session:
        await session.execute(
            update(ContactRecord)
            .where(ContactRecord.contact_id == contact_id)
            .values(last_seen_at=_utcnow())
        )
        await session.commit()


async def revoke_contact(contact_id: str, owner_tenant_id: str) -> bool:
    """Ownership is part of the WHERE clause, so a caller cannot revoke a
    contact belonging to someone else by guessing an id."""
    async with async_session() as session:
        result = await session.execute(
            update(ContactRecord)
            .where(
                ContactRecord.contact_id == contact_id,
                ContactRecord.owner_tenant_id == owner_tenant_id,
            )
            .values(revoked_at=_utcnow())
        )
        await session.commit()
        return result.rowcount > 0


async def rotate_contact_token(
    contact_id: str, owner_tenant_id: str, token_hash: str
) -> bool:
    """Issue a new link and forget the old device.

    Re-issuing must clear bound_device, otherwise the new link would be locked
    to whichever device held the compromised one.
    """
    async with async_session() as session:
        result = await session.execute(
            update(ContactRecord)
            .where(
                ContactRecord.contact_id == contact_id,
                ContactRecord.owner_tenant_id == owner_tenant_id,
            )
            .values(token_hash=token_hash, bound_device=None, revoked_at=None)
        )
        await session.commit()
        return result.rowcount > 0


async def delete_contact(contact_id: str, owner_tenant_id: str) -> bool:
    """Remove a contact and its session history for good."""
    async with async_session() as session:
        await session.execute(
            delete(ContactSessionRecord).where(
                ContactSessionRecord.contact_id == contact_id
            )
        )
        result = await session.execute(
            delete(ContactRecord).where(
                ContactRecord.contact_id == contact_id,
                ContactRecord.owner_tenant_id == owner_tenant_id,
            )
        )
        await session.commit()
        return result.rowcount > 0


async def set_contact_blocked(contact_id: str, owner_tenant_id: str, blocked: bool) -> bool:
    """Block or unblock a contact."""
    async with async_session() as session:
        result = await session.execute(
            update(ContactRecord)
            .where(
                ContactRecord.contact_id == contact_id,
                ContactRecord.owner_tenant_id == owner_tenant_id,
            )
            .values(blocked_at=_utcnow() if blocked else None)
        )
        await session.commit()
        return result.rowcount > 0


# ---- Contact Sessions -------------------------------------------------------

async def start_contact_session(
    *, session_id: str, contact_id: str, conversation_id: Optional[str],
    ip_address: Optional[str], user_agent: Optional[str], device_id: Optional[str],
    channel: str = "chat",
) -> None:
    async with async_session() as session:
        session.add(ContactSessionRecord(
            session_id=session_id, contact_id=contact_id,
            conversation_id=conversation_id, ip_address=ip_address,
            user_agent=(user_agent or "")[:300], device_id=device_id, channel=channel,
        ))
        await session.commit()


def real_talk_filter():
    """What counts as a conversation worth showing the owner.

    Opening an invite link records a session before anyone has spoken, and a
    voice call then records a second one when it actually starts — so a single
    call leaves two rows, one of which is an empty page load. Measured on real
    data: seven rows for four conversations.

    The definition lives here, once, because the count and the list had grown
    their own copies and disagreed: the badge said "3 Completed Talks" above a
    list of four. Two answers to the same question is worse than either answer
    being wrong, because neither can be trusted afterwards.

    A conversation exists when there is something to read — a transcript
    (conversation_id) or at least one turn.
    """
    return or_(
        ContactSessionRecord.conversation_id.isnot(None),
        ContactSessionRecord.message_count > 0,
    )


async def list_contact_sessions(
    contact_id: str, limit: int = 50, only_real: bool = True
) -> List[ContactSessionRecord]:
    """Sessions for a contact, newest first.

    `only_real` excludes the empty page-load rows by default, so this matches
    the count shown next to the contact's name.
    """
    async with async_session() as session:
        query = select(ContactSessionRecord).where(
            ContactSessionRecord.contact_id == contact_id
        )
        if only_real:
            query = query.where(real_talk_filter())
        result = await session.execute(
            query.order_by(ContactSessionRecord.started_at.desc()).limit(limit)
        )
        return list(result.scalars().all())


async def count_real_talks(contact_ids: List[str]) -> dict[str, int]:
    """How many real conversations each contact has had.

    Counted in SQL rather than by loading every session row and tallying them
    in Python, which is what the list endpoint did — that grows with a
    workspace's entire call history to render one number per contact.
    """
    if not contact_ids:
        return {}
    async with async_session() as session:
        result = await session.execute(
            select(
                ContactSessionRecord.contact_id,
                func.count().label("talks"),
            )
            .where(
                ContactSessionRecord.contact_id.in_(contact_ids),
                real_talk_filter(),
            )
            .group_by(ContactSessionRecord.contact_id)
        )
        counts = {cid: 0 for cid in contact_ids}
        counts.update({row[0]: int(row[1]) for row in result.all()})
        return counts


async def count_sessions_since(contact_id: str, since: datetime) -> int:
    """Backs the per-day cap, so a leaked link cannot quietly drain the quota."""
    async with async_session() as session:
        result = await session.execute(
            select(func.count())
            .select_from(ContactSessionRecord)
            .where(
                ContactSessionRecord.contact_id == contact_id,
                ContactSessionRecord.started_at >= since,
            )
        )
        return int(result.scalar() or 0)


async def record_voice_transcript(
    *,
    tenant_id: str,
    contact_id: Optional[str],
    messages: List[dict],
    duration_seconds: int = 0,
) -> Optional[str]:
    """Save voice call transcript turns, duration, and link to contact session."""
    if not messages:
        return None
    conversation_id = str(uuid4())
    now = datetime.now(timezone.utc)
    async with async_session() as session:
        conv = ConversationRecord(
            conversation_id=conversation_id,
            tenant_id=tenant_id,
            created_at=now,
            updated_at=now,
        )
        session.add(conv)
        await session.flush()

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "").strip()
            if content:
                session.add(
                    MessageRecord(
                        conversation_id=conversation_id,
                        role=role,
                        content=content,
                        created_at=now,
                    )
                )

        if contact_id:
            latest_session_res = await session.execute(
                select(ContactSessionRecord)
                .where(ContactSessionRecord.contact_id == contact_id)
                .order_by(ContactSessionRecord.started_at.desc())
                .limit(1)
            )
            latest_session = latest_session_res.scalar_one_or_none()
            if latest_session:
                latest_session.conversation_id = conversation_id
                latest_session.message_count = len(messages)
                latest_session.duration_seconds = max(0, int(duration_seconds or 0))
                latest_session.channel = "voice"
                latest_session.last_activity_at = now

        await session.commit()
    return conversation_id


# Owner/agent queries live in their own module to keep this file from becoming
# the same kind of monolith the frontend page did. Re-exported so existing
# `repositories.<fn>` call sites keep working.
from app.repositories.owners import (  # noqa: E402,F401
    create_owner,
    ensure_public_handle,
    get_owner_by_handle,
    rotate_public_handle,
    delete_agent,
    get_agent,
    get_owner,
    get_owner_by_email,
    list_deployed_agents,
    set_agent_status,
    set_owner_credentials,
    set_owner_secrets,
    update_owner,
    upsert_agent,
)
