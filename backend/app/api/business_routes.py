"""Owner inbox and authenticated caller requests. All reads are tenant-scoped."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app import contacts, repositories
from app.api.contact_routes import _require_owner
from app.identity import Identity, get_identity
from app.rate_limit import limiter
from app.repositories import business
from app.services.business_calls import call_public

router = APIRouter()


async def require_caller(identity: Identity = Depends(get_identity)):
    if not identity.contact_id:
        raise HTTPException(403, "Open your business link to send a request.")
    record = await repositories.get_contact(identity.contact_id, identity.tenant_id)
    if not record:
        raise HTTPException(404, "Contact not found")
    try:
        contacts.check_usable(revoked_at=record.revoked_at, expires_at=record.expires_at,
                              blocked_at=record.blocked_at)
    except contacts.ContactError as exc:
        raise HTTPException(403, str(exc))
    return identity


class CallerChatBody(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None


@router.post("/chat")
@limiter.limit("15/minute")
async def caller_chat(request: Request, body: CallerChatBody,
                      identity: Identity = Depends(require_caller)):
    from app.models.schemas import QueryRequest
    from app.api.routes import query_documents
    from app.services.owner_service import cached_agent, available_channels
    from app.database import async_session
    from app.models.db_models import ContactSessionRecord
    from sqlalchemy import select, update
    from uuid import uuid4
    contact = await repositories.get_contact(identity.contact_id, identity.tenant_id)
    agent = await cached_agent(identity.tenant_id)
    channels = await available_channels(identity.tenant_id)
    if contact.mode == "voice" or not agent or agent.status != "deployed" or not channels["chat"]:
        raise HTTPException(403, "Text chat is not available for this link.")
    conversation_id = str(body.conversation_id) if body.conversation_id else str(uuid4())
    if body.conversation_id:
        async with async_session() as session:
            match = await session.scalar(select(ContactSessionRecord).where(
                ContactSessionRecord.contact_id == identity.contact_id,
                ContactSessionRecord.conversation_id == conversation_id,
                ContactSessionRecord.channel == "chat"))
            if not match:
                raise HTTPException(404, "Conversation not found")
    else:
        await repositories.get_or_create_conversation(conversation_id, identity.tenant_id)
        await repositories.start_contact_session(session_id=str(uuid4()), contact_id=identity.contact_id,
            conversation_id=conversation_id, ip_address=None, user_agent=None, device_id=None, channel="chat")
    response = await query_documents(request=request, body=QueryRequest(query=body.query,
        conversation_id=conversation_id), identity=identity, x_custom_llm_base_url=None, x_custom_llm_key=None)
    async with async_session() as session:
        await session.execute(update(ContactSessionRecord).where(
            ContactSessionRecord.contact_id == identity.contact_id,
            ContactSessionRecord.conversation_id == conversation_id).values(
                message_count=ContactSessionRecord.message_count + 2, last_activity_at=business.now()))
        await session.commit()
    return response


class RequestBody(BaseModel):
    request_id: UUID
    message: str = Field(min_length=3, max_length=2000)
    reply_to: str = Field(min_length=3, max_length=200)
    call_id: UUID | None = None

    @field_validator("message", "reply_to")
    @classmethod
    def meaningful(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Please enter at least 3 characters")
        return value.strip()


class UpdateRequestBody(BaseModel):
    status: Literal["open", "in_progress", "resolved"]
    owner_note: str = Field(default="", max_length=2000)


def request_public(record):
    return {key: getattr(record, key) for key in (
        "request_id", "contact_id", "call_id", "kind", "message", "reply_to", "status", "owner_note"
    )} | {"created_at": record.created_at.isoformat(), "updated_at": record.updated_at.isoformat()}


@router.post("/requests", status_code=201)
@limiter.limit("10/minute")
async def submit_request(request: Request, body: RequestBody,
                         identity: Identity = Depends(require_caller)):
    try:
        record = await business.create_request(identity.tenant_id, identity.contact_id,
            str(body.request_id), body.message, body.reply_to,
            str(body.call_id) if body.call_id else None)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(429, str(exc))
    return {"request_id": record.request_id, "status": record.status}


@router.get("/requests")
async def requests(status: Literal["open", "in_progress", "resolved"] | None = None,
                   limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    rows, total = await business.list_requests(identity.tenant_id, status, limit, offset)
    return {"items": [request_public(r) | {"name": name} for r, name in rows], "total": total}


@router.patch("/requests/{request_id}")
async def update_request(request_id: UUID, body: UpdateRequestBody,
                          identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    try:
        record = await business.update_request(identity.tenant_id, str(request_id),
                                                 body.status, body.owner_note.strip())
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return request_public(record)


@router.get("/calls")
async def calls(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                 identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    rows, total = await business.list_calls(identity.tenant_id, limit, offset)
    return {
        "items": [
            call_public(r) | {"name": name or r.context_label or "Test call"}
            for r, name in rows
        ],
        "total": total,
    }


@router.get("/bookings/mine")
async def caller_bookings(identity: Identity = Depends(require_caller)):
    from app.services.calendar_service import list_bookings, business_timezone, as_utc
    records = await list_bookings(identity.tenant_id, contact_id=identity.contact_id, limit=20)
    zone = await business_timezone(identity.tenant_id)
    return {"timezone": str(zone), "items": [{
        "booking_id": b.booking_id, "title": b.title, "status": b.status,
        "start_ts": as_utc(b.start_ts).isoformat(), "end_ts": as_utc(b.end_ts).isoformat(),
    } for b in records]}
