"""Public consumer endpoints for Product QR (Milestone M1A).

Handles QR link scanning (/p/{token}), visitor session initiation,
grounded product-scoped text chat, and WebRTC voice escalation.
"""
from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Header, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from livekit.api import AccessToken, RoomAgentDispatch, RoomConfiguration, VideoGrants

from app.config import settings
from app.rate_limit import client_ip, limiter
from app.repositories import business, product_qr as repo
from app.repositories import append_message
from app.services import owner_service, usage
from app.services.guardrails import is_prompt_injection
from app.services.notification_service import notify
from app.services.product_safety import (
    ABSTENTION_MESSAGE,
    check_product_safety,
)
from app.services.voice.config import SUPPORTED_TTS_VOICE_IDS, voice_settings
from app.services.voice.worker_supervisor import (
    ensure_worker_running,
    is_worker_available,
)
from app.session import (
    PRODUCT_COOKIE_NAME,
    SessionError,
    issue_product_session,
    product_cookie_params,
    verify,
)

logger = logging.getLogger(__name__)

# Rejection copy for the injection gate — same voice as /query's gate, kept
# product-flavored so a consumer is never shown an empty or error reply.
INJECTION_REJECTION_MESSAGE = (
    "I can help with this product's official support material, but I can't "
    "follow instructions to ignore my guidelines. Try rephrasing your question."
)

def _check_feature_enabled() -> None:
    if not settings.PRODUCT_QR_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product QR capability is currently disabled.",
        )


router = APIRouter(
    prefix="/api/v1/product-qr/public",
    tags=["Product QR Public"],
    dependencies=[Depends(_check_feature_enabled)],
)


def _is_expired(dt: Optional[datetime]) -> bool:
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < datetime.now(timezone.utc)


async def get_product_visitor_context(request: Request) -> tuple:
    """Dependency: Resolves the visitor session and product strictly from cookie or header."""
    _check_feature_enabled()

    cookie_val = request.cookies.get(PRODUCT_COOKIE_NAME)
    header_val = request.headers.get("X-Product-Session")
    raw_token = cookie_val or header_val

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No product session found. Please scan the product QR code again.",
        )
    return await resolve_visitor_context(raw_token)


async def resolve_visitor_context(raw_token: str) -> tuple:
    """Same validation as the dependency, for callers carrying the session
    token outside cookies/headers (e.g. in a JSON body). Workspace, product,
    and session are always derived server-side from the signed token — never
    from client-supplied IDs."""
    if not (raw_token or "").strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No product session found. Please scan the product QR code again.",
        )

    try:
        data = verify(raw_token)
    except SessionError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired product session. Please scan the QR code again.",
        )

    if data.get("kind") != "product_visitor":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session type for product support.",
        )

    session_id = data.get("session_id")
    tenant_id = data.get("tenant_id")
    product_id = data.get("product_id")

    if not session_id or not tenant_id or not product_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed session payload.",
        )

    sess = await repo.get_visitor_session(session_id, tenant_id)
    if not sess:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session not found. Please scan the QR code again.",
        )

    if sess.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked.",
        )

    if sess.product_id != product_id or sess.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Product session does not match this support context.",
        )

    if _is_expired(sess.expires_at):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired. Please scan the QR code again.",
        )

    product = await repo.get_product(product_id, tenant_id)
    if not product or product.status != "active":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product is currently unavailable or inactive.",
        )

    return sess, product


# ---- Schemas ----------------------------------------------------------------

class PublicChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class PublicVoiceTokenResponse(BaseModel):
    token: str
    url: str
    room_name: str
    call_id: str


class PublicVoiceConsentRequest(BaseModel):
    consent_accepted: bool = False


class ServiceRequestBody(BaseModel):
    request_id: UUID
    session_token: str = Field(min_length=1, max_length=8000)
    name: str = Field(min_length=1, max_length=120)
    reply_to: str = Field(min_length=3, max_length=320)
    preferred_time: Optional[str] = Field(default=None, max_length=120)
    message: str = Field(min_length=3, max_length=2000)
    trigger: Literal["manual", "abstention", "safety"] = "manual"
    consent: bool = False


# ---- Endpoints --------------------------------------------------------------

@router.post("/{token}/open")
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def open_product_qr(
    token: str,
    request: Request,
    response: Response,
):
    """Consumer scans QR link (/p/{token}).
    
    Verifies link, creates an isolated visitor session, sets signed HttpOnly cookie,
    and returns safe product presentation data without exposing tenant IDs or internal hashes.
    """
    _check_feature_enabled()

    link = await repo.get_qr_link_by_token(token)
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support link not found or invalid.",
        )

    if not link.active or link.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This product support QR link has been revoked.",
        )

    if _is_expired(link.expires_at):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This product support QR link has expired.",
        )

    product = await repo.get_product(link.product_id, link.tenant_id)
    if not product or product.status != "active":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found or inactive.",
        )

    await repo.increment_link_scans(link.link_id)

    # Issue distinct visitor session
    ip = client_ip(request)
    ua = request.headers.get("user-agent", "")[:300]
    token_seed = f"{uuid4().hex}_{token[:8]}"
    sess = await repo.create_visitor_session(
        tenant_id=link.tenant_id,
        product_id=product.product_id,
        link_id=link.link_id,
        ip_address=ip,
        user_agent=ua,
        session_token=token_seed,
    )

    token_val = issue_product_session(
        session_id=sess.session_id,
        tenant_id=link.tenant_id,
        product_id=product.product_id,
    )

    response.set_cookie(value=token_val, **product_cookie_params())

    workspace = await owner_service.cached_owner(link.tenant_id)
    business_name = workspace.business_name if workspace else None

    # Safe presentation data only. The browser authenticates subsequent calls
    # with the HttpOnly cookie set above; returning that token in JSON would
    # defeat the browser's HttpOnly protection.
    return {
        "business": {
            "business_name": business_name,
        },
        "product": {
            "name": product.name,
            "model_number": product.model_number,
            "category": product.category,
            "short_description": product.short_description,
            "support_disclaimer": product.support_disclaimer or (
                "Official support grounded strictly in authorized product documentation."
            ),
        },
    }


@router.post("/chat")
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def public_chat(
    request: Request,
    body: PublicChatRequest,
    context: tuple = Depends(get_product_visitor_context),
):
    """Answers consumer questions strictly from assigned product documents.
    
    Server strictly derives product and document scope from session.
    Safety guardrails immediately catch hazardous intents.
    Prompt-injection attempts are rejected before retrieval, same as /query.
    Ungrounded queries return authoritative abstention.
    Citations never expose internal document IDs.
    """
    from app.api.routes import embedding_service, rag_pipeline, vector_store

    sess, product = context
    query_text = body.message.strip()

    # 1. Safety Guardrail
    safety_escalation = check_product_safety(query_text)
    if safety_escalation:
        await repo.touch_visitor_session(sess.session_id)
        return {
            "reply": safety_escalation,
            "citations": [],
            "is_safety_escalation": True,
        }

    # 2. Prompt-injection guardrail — the same detector /query uses, before
    # retrieval or the LLM ever sees the text.
    inj = is_prompt_injection(query_text)
    if inj.is_injection:
        logger.warning(
            "blocked injection product_session=%s reason=%s",
            sess.session_id,
            inj.reason,
        )
        await repo.touch_visitor_session(sess.session_id)
        return {
            "reply": INJECTION_REJECTION_MESSAGE,
            "citations": [],
            "is_safety_escalation": True,
        }

    # 3. Document Scoping: strictly resolve assigned documents owned by the same tenant
    allowed_doc_ids = await repo.list_product_document_ids(
        product_id=product.product_id, tenant_id=sess.tenant_id
    )

    agent = await owner_service.cached_agent(sess.tenant_id)
    voice_channel = owner_service.channel_settings(agent, "voice") if agent else {}
    credentials = await owner_service.resolve_credentials(sess.tenant_id)

    if not allowed_doc_ids:
        await repo.touch_visitor_session(sess.session_id)
        return {
            "reply": ABSTENTION_MESSAGE,
            "citations": [],
            "is_safety_escalation": False,
        }

    # 4. Vector Retrieval strictly scoped to product documents
    try:
        query_embedding = await run_in_threadpool(
            embedding_service.encode_query, query_text
        )
        raw_results = await run_in_threadpool(
            vector_store.search,
            query_vector=query_embedding,
            limit=5,
            tenant_id=sess.tenant_id,
            document_ids=allowed_doc_ids,
        )
    except Exception as exc:
        # Class name only: retrieval errors can carry hosts and credentials.
        logger.warning("Product QR retrieval failed (%s)", type(exc).__name__)
        raw_results = []

    # Filter by score threshold (0.35 minimum cosine similarity)
    filtered_results = [r for r in raw_results if r.get("score", 0.0) >= 0.35]

    if not filtered_results:
        await repo.touch_visitor_session(sess.session_id)
        return {
            "reply": ABSTENTION_MESSAGE,
            "citations": [],
            "is_safety_escalation": False,
        }

    # 5. LLM Generation
    workspace = await owner_service.cached_owner(sess.tenant_id)
    credentials = await owner_service.resolve_credentials(
        sess.tenant_id, record=workspace
    )

    disclaimer = product.support_disclaimer or ""
    system_prompt = (
        f"You are the official product support assistant for {product.name} (Model: {product.model_number}).\n"
        "Your duty is to answer questions strictly, accurately, and concisely using ONLY the provided official product support material.\n"
        f"If the answer cannot be found in the provided documentation, output exactly:\n"
        f"'{ABSTENTION_MESSAGE}'\n"
        f"{disclaimer}\n"
        "Never guess, never hallucinate repair steps, and never instruct the user to open live electrical enclosures, bypass safety fuses, or disassemble motor components."
    )

    try:
        answer = await run_in_threadpool(
            rag_pipeline.generate_response,
            query=query_text,
            context_chunks=filtered_results,
            conversation_history=[],
            temperature=0.1,
            max_tokens=600,
            groq_api_key=credentials.get("groq_api_key"),
            custom_base_url=credentials.get("custom_llm_base_url"),
            custom_api_key=credentials.get("custom_llm_api_key"),
            agent_prompt=system_prompt,
        )
    except Exception as exc:
        logger.warning("Product QR generation failed (%s)", type(exc).__name__)
        answer = ABSTENTION_MESSAGE

    # 6. Extract safe citations (internal document_id withheld)
    citations = [
        {
            "filename": r["payload"].get("filename", "Support Manual"),
            "page_number": r["payload"].get("page_number"),
            "snippet": r["payload"].get("content", "")[:200] + "...",
        }
        for r in filtered_results[:3]
    ]

    # Update conversation history in DB
    try:
        await append_message(sess.conversation_id, sess.tenant_id, "user", query_text)
        await append_message(
            sess.conversation_id,
            sess.tenant_id,
            "assistant",
            answer,
            citations=citations,
        )
    except Exception:
        logger.warning(
            "Could not persist Product QR conversation %s",
            sess.conversation_id,
            exc_info=True,
        )

    await repo.touch_visitor_session(sess.session_id)

    return {
        "reply": answer,
        "citations": citations,
        "is_safety_escalation": False,
    }


@router.post("/voice/token", response_model=PublicVoiceTokenResponse)
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def public_voice_token(
    request: Request,
    body: Optional[PublicVoiceConsentRequest] = None,
    context: tuple = Depends(get_product_visitor_context),
):
    """Issues LiveKit WebRTC access token for voice troubleshooting.
    
    Checks worker health (returns HTTP 503 if unavailable).
    Injects product identity and scoped document IDs into worker metadata.
    """
    sess, product = context

    # Probe voice worker availability
    worker_coro = (
        ensure_worker_running()
        if settings.VOICE_WORKER_AUTO_START
        else is_worker_available()
    )
    worker_ok = await worker_coro
    if not worker_ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice service is temporarily unavailable. Please try again in a moment. If the problem persists, ensure the voice worker is running.",
        )

    if body is None or not body.consent_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Voice processing and transcript consent is required.",
        )

    # The daily ceiling, checked before a room is created rather than after
    # (the same bound as voice_routes): a product QR call spends the owner's
    # keys just as a contact call does, so it spends under the same budget.
    spend = await usage.usage_today(sess.tenant_id)
    if spend.over_budget:
        logger.warning(
            "Refusing product voice call for %s: daily budget reached (%d calls, %d min)",
            sess.tenant_id,
            spend.calls,
            spend.minutes,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "This assistant has reached its limit for today. "
                "Please try again tomorrow."
            ),
        )

    # Load the same saved voice choices that power the owner's assistant.  The
    # metadata below intentionally carries configuration only; provider keys
    # remain server-side and are resolved by the voice worker.
    agent = await owner_service.cached_agent(sess.tenant_id)
    voice_channel = owner_service.channel_settings(agent, "voice") if agent else {}
    workspace = await owner_service.cached_owner(sess.tenant_id)
    credentials = await owner_service.resolve_credentials(
        sess.tenant_id, record=workspace
    )

    if not settings.LIVEKIT_URL or not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice infrastructure is not configured.",
        )

    # Product voice has no per-request keys: the worker uses stored tenant
    # keys (via POST /voice/credentials, which requires INTERNAL_API_KEY)
    # or environment defaults. Without either, the token would mint a call
    # that can never speak — refuse loudly here instead.
    if not settings.INTERNAL_API_KEY and not (
        settings.GROQ_API_KEY and settings.SARVAM_API_KEY
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Voice credential service is not configured (INTERNAL_API_KEY). "
                "Product voice calls cannot start until it is set."
            ),
        )

    allowed_doc_ids = await repo.list_product_document_ids(
        product_id=product.product_id, tenant_id=sess.tenant_id
    )

    room_name = f"pqr-{product.product_id[:8]}-{uuid4().hex[:8]}"
    participant_identity = f"visitor-{uuid4().hex[:8]}"

    disclaimer = product.support_disclaimer or ""
    voice_prompt = (
        f"You are the official voice support technician for {product.name} (Model: {product.model_number}). "
        "Speak clearly, concisely, and supportively. Provide guidance based strictly on the official documentation. "
        f"If the information is missing or unclear, state: '{ABSTENTION_MESSAGE}'. "
        f"{disclaimer} "
        "If the user reports sparks, smoke, gas smell, or asks to open electrical panels or bypass fuses, "
        "warn them immediately to disconnect power and escalate to an authorized technician."
    )

    # No key material in dispatch metadata: the worker resolves the
    # workspace's stored provider keys server-side via POST
    # /voice/credentials (internal key) using tenant_id below.
    meta = {
        "tenant_id": sess.tenant_id,
        "product_id": product.product_id,
        "product_name": product.name,
        "model_number": product.model_number,
        "conversation_id": sess.conversation_id,
        "document_ids": allowed_doc_ids,
        "instructions": voice_prompt,
        "rag_enabled": bool(allowed_doc_ids),
        "support_disclaimer": product.support_disclaimer,
        "style_rules": voice_channel.get("style_rules", True),
    }

    if agent:
        meta["tts_speaker"] = (
            agent.voice_id if agent.voice_id in SUPPORTED_TTS_VOICE_IDS else "priya"
        )
        meta["stt_language"] = agent.language or "unknown"

    if voice_channel.get("model"):
        meta["llm_model"] = voice_channel["model"]
    elif credentials.get("llm_model"):
        meta["llm_model"] = credentials["llm_model"]
    if voice_channel.get("base_url"):
        meta["custom_llm_base_url"] = voice_channel["base_url"]
    elif credentials.get("custom_llm_base_url") and not voice_channel.get("model"):
        meta["custom_llm_base_url"] = credentials["custom_llm_base_url"]

    # Cost ceilings for this call. Product QR callers are unauthenticated
    # strangers spending the owner's keys — the same profile as a directory
    # visitor — so they take the directory ceilings (0 = no ceiling, the one
    # way every call site treats a disabled limit).
    meta["max_call_seconds"] = settings.DIRECTORY_MAX_CALL_SECONDS
    meta["idle_timeout_seconds"] = settings.DIRECTORY_IDLE_TIMEOUT_SECONDS

    call_id = await business.create_call(
        sess.tenant_id,
        None,
        client_ip(request),
        request.headers.get("user-agent"),
        context_label=f"Product QR · {product.name} · {product.model_number}",
        voice_consent_at=datetime.now(timezone.utc),
    )
    meta["call_id"] = call_id

    dispatch_metadata = json.dumps(meta)

    token = (
        AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(participant_identity)
        .with_name(f"Customer ({product.model_number})")
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            )
        )
        .with_room_config(
            RoomConfiguration(
                agents=[
                    RoomAgentDispatch(
                        agent_name=voice_settings.VOICE_AGENT_NAME,
                        metadata=dispatch_metadata,
                    )
                ],
            )
        )
    )

    public_url = settings.LIVEKIT_PUBLIC_URL or settings.LIVEKIT_URL

    return PublicVoiceTokenResponse(
        token=token.to_jwt(),
        url=public_url,
        room_name=room_name,
        call_id=call_id,
    )


@router.post("/service-requests", status_code=201)
@limiter.limit("10/minute")
async def create_service_request(request: Request, body: ServiceRequestBody):
    """File a human-support request for the visitor's product.

    Workspace, product, and session come only from the validated session
    token — never from client-supplied IDs. The row is idempotent on
    (request_id, session); a UUID from another session reads as not found.
    """
    sess, product = await resolve_visitor_context(body.session_token)
    if not body.consent:
        raise HTTPException(
            status_code=400,
            detail="Consent is required before filing a support request.",
        )
    try:
        record, created = await repo.create_support_request(
            tenant_id=sess.tenant_id,
            product_id=product.product_id,
            session_id=sess.session_id,
            request_id=str(body.request_id),
            name=body.name,
            reply_to=body.reply_to,
            preferred_time=body.preferred_time,
            message=body.message,
            trigger=body.trigger,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": "86400"},
        )
    # Notify only for the first successful insert. An idempotent retry must
    # not create duplicate alerts. A failed notification must not roll back
    # the stored request.
    if created:
        try:
            await notify(
                sess.tenant_id,
                "product_support",
                title=f"Support request — {product.name}",
                body=(
                    f"{body.name.strip()}: {body.message.strip()[:200]} "
                    f"Reference: {record.request_id}"
                ),
                link_id=record.request_id,
            )
        except Exception as exc:
            logger.warning(
                "Support-request notification failed (%s)", type(exc).__name__
            )
    return {
        "request_id": record.request_id,
        "status": record.status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
