"""Invite links: owner-side management, and the public activation endpoint.

Two audiences in one router, with deliberately different protection:

  /contacts/*        owner only — requires the owner session cookie
  /contacts/open     public — this IS the link, so it cannot require a login

`/open` is the only unauthenticated write in the app, so its guards are the
important part of this file: the token is compared by hash in constant time,
the device is checked before anything is minted, and the per-day cap is
enforced before a session is recorded.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import contacts, repositories
from app.identity import Identity, get_identity
from app.config import settings
from app.rate_limit import client_ip, limiter
from app.api.session_routes import cookie_params
from app.session import COOKIE_NAME, issue

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    note: Optional[str] = Field(default=None, max_length=500)
    # A PIN travels out of band (spoken, or a separate message), so a forwarded
    # link alone is not enough to impersonate the contact.
    pin: Optional[str] = Field(default=None, min_length=4, max_length=12)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=365)
    max_sessions_per_day: int = Field(default=20, ge=1, le=500)
    mode: str = Field(default="both", pattern="^(voice|chat|both)$")


class OpenLinkRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    pin: Optional[str] = Field(default=None, max_length=12)


def _require_owner(identity: Identity) -> None:
    """Anyone with their own workspace may manage their own links.

    Previously this demanded `is_owner`, which meant the single passcode
    holder. With many owners the question is no longer "are you THE owner" but
    "are you a contact" — a contact is someone else's caller and must never be
    able to mint or revoke links. Every query below is additionally scoped by
    `identity.tenant_id`, so one owner cannot reach another's contacts even if
    they guess an id.
    """
    if identity.is_contact:
        raise HTTPException(
            status_code=403,
            detail="This link can talk to the assistant, but cannot manage links.",
        )


def _contact_public(record) -> dict:
    """What the owner sees. The token is absent by construction — it exists in
    plaintext only in the response to the request that created it."""
    return {
        "contact_id": record.contact_id,
        "name": record.name,
        "note": record.note,
        "has_pin": bool(record.pin),
        "device_bound": record.bound_device is not None,
        "revoked": record.revoked_at is not None,
        "blocked": record.blocked_at is not None,
        "expires_at": record.expires_at.isoformat() if record.expires_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "last_seen_at": record.last_seen_at.isoformat() if record.last_seen_at else None,
        "max_sessions_per_day": record.max_sessions_per_day,
        "mode": record.mode,
    }


@router.post("")
async def create_contact(
    body: CreateContactRequest, identity: Identity = Depends(get_identity)
):
    """Create a contact and return its link — the only time the token is ever
    visible. Only its hash is stored, so it cannot be shown again."""
    _require_owner(identity)

    # A chat link with no documents behind it would hand someone an assistant
    # that answers "I don't have that" to everything, so it is refused at
    # creation rather than discovered by whoever was sent it.
    from app.services import owner_service

    channels = await owner_service.available_channels(identity.tenant_id)
    if body.mode in ("chat", "both") and not channels["chat"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Chat answers from your documents, and none are uploaded yet. "
                "Add a document, or share a voice-only link."
            ),
        )

    token = contacts.generate_token()
    contact_id = str(uuid4())

    record = await repositories.create_contact(
        contact_id=contact_id,
        owner_tenant_id=identity.tenant_id,
        name=body.name.strip(),
        note=(body.note or "").strip() or None,
        token_hash=contacts.hash_token(token),
        pin=body.pin,
        expires_at=contacts.default_expiry(body.expires_in_days),
        max_sessions_per_day=body.max_sessions_per_day,
        mode=body.mode,
    )

    return {**_contact_public(record), "token": token}


@router.get("")
async def list_contacts(identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    records = await repositories.list_contacts(identity.tenant_id)
    if not records:
        return []

    from app.database import async_session
    from app.models.db_models import ContactSessionRecord
    from sqlalchemy import select, or_, and_

    contact_ids = [r.contact_id for r in records]
    session_counts: dict[str, int] = {cid: 0 for cid in contact_ids}

    async with async_session() as session:
        q = select(ContactSessionRecord).where(
            ContactSessionRecord.contact_id.in_(contact_ids),
            or_(
                and_(ContactSessionRecord.channel == "voice", ContactSessionRecord.conversation_id.isnot(None)),
                ContactSessionRecord.message_count > 0,
                ContactSessionRecord.conversation_id.isnot(None),
            )
        )
        res = await session.execute(q)
        for s in res.scalars().all():
            session_counts[s.contact_id] = session_counts.get(s.contact_id, 0) + 1

    out = []
    for r in records:
        info = _contact_public(r)
        info["session_count"] = session_counts.get(r.contact_id, 0)
        out.append(info)
    return out


@router.get("/overview")
async def overview(identity: Identity = Depends(get_identity)):
    """Everything the console's front page needs, in one request.

    Assembled server-side rather than letting the dashboard fetch four
    endpoints and stitch them: a dashboard that renders in four stages looks
    broken, and each extra round trip is another chance for one to fail while
    the others succeed.
    """
    _require_owner(identity)

    contacts_list = await repositories.list_contacts(identity.tenant_id)
    conversations = await repositories.list_conversations(identity.tenant_id)

    since_week = datetime.now(timezone.utc) - timedelta(days=7)

    sessions_all = []
    for contact in contacts_list:
        for session in await repositories.list_contact_sessions(contact.contact_id):
            sessions_all.append((contact, session))

    def _started(session):
        value = session.started_at
        if value is None:
            return None
        # Rows can come back naive depending on when they were written.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    recent = [pair for pair in sessions_all if (_started(pair[1]) or since_week) >= since_week]

    # The most-asked questions are the highest-value thing here: they tell an
    # owner what to put in their documents next.
    questions: list[dict] = []
    for conversation in conversations:
        for message in conversation.messages:
            if message.role == "user" and message.content.strip():
                questions.append({
                    "text": message.content.strip()[:200],
                    "at": message.created_at.isoformat() if message.created_at else None,
                })
    questions.sort(key=lambda q: q["at"] or "", reverse=True)

    # Fetch agent and business metadata for owner
    agent = await repositories.get_agent(identity.tenant_id)
    owner = await repositories.get_owner(identity.tenant_id)
    agent_name = (agent.name if agent else "Assistant") or "Assistant"
    business_name = (owner.business_name if owner else "Business") or "Business"

    # Filter out empty 0-message unstarted page loads
    active_sessions_all = [
        (c, s) for c, s in sessions_all
        if (s.channel == "voice" and s.conversation_id)
        or (s.message_count and s.message_count > 0)
        or s.conversation_id
    ]

    # If all were unstarted, fall back to sessions_all so empty state displays gracefully
    display_sessions = active_sessions_all if active_sessions_all else []

    voice_count = sum(1 for _, s in display_sessions if s.channel == "voice")
    chat_count = sum(1 for _, s in display_sessions if s.channel != "voice")

    recent_sessions = []
    for contact, session in sorted(
        display_sessions,
        key=lambda pair: pair[1].started_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    ):
        recent_sessions.append({
            "session_id": session.session_id,
            "contact_id": contact.contact_id,
            "name": contact.name,
            "channel": session.channel or "voice",
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "message_count": session.message_count or 0,
            "has_transcript": bool(session.conversation_id),
            "agent_name": agent_name,
            "business_name": business_name,
        })

    # Unique callers count based on distinct caller names
    unique_names = set(c.name.strip().lower() for c in contacts_list if c.name)

    return {
        "totals": {
            "total_sessions": len(display_sessions),
            "conversations": len(display_sessions),
            "conversations_this_week": len([p for p in display_sessions if (_started(p[1]) or since_week) >= since_week]),
            "voice_calls": voice_count,
            "chat_sessions": chat_count,
            "people": len(contacts_list),
            "unique_users": max(len(unique_names), 1 if contacts_list else 0),
            "active_people": sum(
                1 for c in contacts_list if not c.revoked_at and not c.blocked_at
            ),
            "agent_name": agent_name,
            "business_name": business_name,
        },
        "recent": recent_sessions,
    }


@router.get("/{contact_id}/sessions")
async def contact_sessions(contact_id: str, identity: Identity = Depends(get_identity)):
    """Every visit by this contact — the owner's view of who talked, when, and
    from what device. An unfamiliar device here is the signal a link spread."""
    _require_owner(identity)

    record = await repositories.get_contact(contact_id, identity.tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Contact not found")

    sessions = await repositories.list_contact_sessions(contact_id)
    return {
        "contact": _contact_public(record),
        "sessions": [
            {
                "session_id": s.session_id,
                "channel": s.channel,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ip_address": s.ip_address,
                "user_agent": s.user_agent,
                "message_count": s.message_count,
            }
            for s in sessions
        ],
    }


@router.get("/{contact_id}/transcript")
async def contact_transcript(
    contact_id: str, session_id: str, identity: Identity = Depends(get_identity)
):
    """What was actually said in one of a contact's sessions.

    Knowing that someone called three times is far less useful to an owner than
    knowing what they asked, which is the whole reason to keep a history at
    all. Scoped by contact so a session id alone cannot be used to read another
    contact's conversation.
    """
    _require_owner(identity)

    record = await repositories.get_contact(contact_id, identity.tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Contact not found")

    sessions = await repositories.list_contact_sessions(contact_id)
    match = next((s for s in sessions if s.session_id == session_id), None)
    if match is None or not match.conversation_id:
        # A session with no conversation is a call that connected but produced
        # no turns — an empty transcript, not an error.
        return {"messages": []}

    conversations = await repositories.list_conversations(identity.tenant_id)
    conversation = next(
        (c for c in conversations if c.conversation_id == match.conversation_id), None
    )
    if conversation is None:
        return {"messages": []}

    return {
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in conversation.messages
        ]
    }


@router.post("/{contact_id}/revoke")
async def revoke_contact(contact_id: str, identity: Identity = Depends(get_identity)):
    """Kill a link immediately. Past conversations are kept — revoking access
    is not the same as erasing history."""
    _require_owner(identity)
    if not await repositories.revoke_contact(contact_id, identity.tenant_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"status": "revoked"}


@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, identity: Identity = Depends(get_identity)):
    """Remove the entry entirely. Revoke is the safer default — it keeps the
    history — so this is for rows created by mistake."""
    _require_owner(identity)
    if not await repositories.delete_contact(contact_id, identity.tenant_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"status": "deleted"}


@router.post("/{contact_id}/block")
async def block_contact(contact_id: str, identity: Identity = Depends(get_identity)):
    """Refuse this person while keeping their link and history.

    Distinct from revoke: revoking retires a link, blocking shuts out a person.
    An owner dealing with misuse wants the second and would lose the record
    with the first.
    """
    _require_owner(identity)
    if not await repositories.set_contact_blocked(contact_id, identity.tenant_id, True):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"status": "blocked"}


@router.post("/{contact_id}/unblock")
async def unblock_contact(contact_id: str, identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    if not await repositories.set_contact_blocked(contact_id, identity.tenant_id, False):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"status": "active"}


@router.post("/{contact_id}/rotate")
async def rotate_contact(contact_id: str, identity: Identity = Depends(get_identity)):
    """Issue a replacement link. Clears the device binding — otherwise the new
    link would stay locked to the device holding the compromised one."""
    _require_owner(identity)

    token = contacts.generate_token()
    if not await repositories.rotate_contact_token(
        contact_id, identity.tenant_id, contacts.hash_token(token)
    ):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"token": token}


@router.post("/open")
@limiter.limit("10/minute")
async def open_link(request: Request, response: Response, body: OpenLinkRequest):
    """Exchange an invite token for a session cookie.

    Public by necessity — this is the link itself. Rate limited by IP so the
    token space cannot be probed, though at 256 bits that is a formality
    rather than a real defence.
    """
    record = await repositories.get_contact_by_token_hash(
        contacts.hash_token(body.token)
    )

    # One message for "no such token" and "wrong token", so a caller cannot
    # tell a real contact id from a fabricated one.
    if record is None:
        raise HTTPException(status_code=404, detail="This link is not valid.")

    try:
        contacts.check_usable(
            revoked_at=record.revoked_at,
            expires_at=record.expires_at,
            blocked_at=record.blocked_at,
        )
    except contacts.ContactError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    if record.pin and body.pin != record.pin:
        raise HTTPException(status_code=401, detail="Enter the PIN you were given.")

    device_id = contacts.derive_device_id(
        user_agent=request.headers.get("user-agent", ""),
        client_ip=client_ip(request),
        salt=record.token_hash,
    )

    if not contacts.check_device(
        bound_device=record.bound_device, presented_device=device_id
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "This link is already in use on another device. "
                "Ask the owner to send you a new one."
            ),
        )

    # A draft agent is not answerable. Checked before a session is recorded so
    # a link tapped early does not show up in the owner's history as a call
    # that never happened.
    agent = await repositories.get_agent(record.owner_tenant_id)
    if agent is None or agent.status != "deployed":
        raise HTTPException(
            status_code=503,
            detail="This assistant isn't live yet. Please try again later.",
        )

    # Cap checked before anything is minted, so a leaked link cannot spend the
    # LLM quota faster than the owner can notice.
    since = datetime.now(timezone.utc) - timedelta(days=1)
    if await repositories.count_sessions_since(record.contact_id, since) >= record.max_sessions_per_day:
        raise HTTPException(
            status_code=429,
            detail="This link has reached its daily limit. Try again tomorrow.",
        )

    if record.bound_device is None:
        await repositories.bind_contact_device(record.contact_id, device_id)
    else:
        await repositories.touch_contact(record.contact_id)

    await repositories.start_contact_session(
        session_id=str(uuid4()),
        contact_id=record.contact_id,
        conversation_id=None,
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
        device_id=device_id,
    )

    # Same signed-cookie mechanism as the owner session, with a different kind
    # so identity resolution can tell them apart and scope data accordingly.
    # cookie_params() supplies `key` along with the flags, so the name must not
    # also be passed positionally — that raised "multiple values for argument
    # 'key'" and surfaced as a 500 on every link open.
    response.set_cookie(
        value=issue(kind=f"contact:{record.contact_id}:{record.owner_tenant_id}"),
        max_age=settings.SESSION_TTL_DAYS * 86400,
        **cookie_params(),
    )

    logger.info("Contact link opened: %s", record.contact_id)
    # The page needs the mode to know whether to open a call or the app.
    return {
        "name": record.name,
        "contact_id": record.contact_id,
        "mode": record.mode,
    }
