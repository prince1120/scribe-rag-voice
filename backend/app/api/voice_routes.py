"""Voice session token issuance.

A separate router (new bounded context) rather than adding to routes.py —
this is the one piece of the VoiceBot feature that lives in the API server:
a client needs a signed LiveKit room token before it can connect at all,
and the VoiceBot worker (app/services/voice/worker.py) picks up the
resulting room as a dispatched job. Everything else voice-related lives in
app/services/voice/, decoupled from this request/response server.
"""
import asyncio
import hmac
import json
import logging
from typing import Dict, List, Optional
from uuid import uuid4, UUID

import httpx
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from livekit.api import AccessToken, RoomAgentDispatch, RoomConfiguration, VideoGrants

from app import contacts, repositories
from app.auth import verify_api_key, verify_internal_api_key
from app.config import settings
from app.identity import Identity, get_identity
from app.services import owner_service, usage
from app.rate_limit import client_ip, limiter
from app.models.schemas import (
    VoicePreviewRequest,
    VoiceRetrieveRequest,
    VoiceTokenRequest,
    VoiceTokenResponse,
)
from app.services.voice.config import (
    PERSONAS,
    SARVAM_TTS_BASE_URL,
    SUPPORTED_STT_LANGUAGES,
    SUPPORTED_STT_LANGUAGE_IDS,
    SUPPORTED_TTS_VOICES,
    SUPPORTED_TTS_VOICE_IDS,
    SUPPORTED_TTS_VOICE_LABELS,
    build_instructions,
    voice_settings,
)
from app.services.voice.worker_supervisor import (
    ensure_worker_running,
    is_worker_available,
)
from app.repositories import business
from app.services.business_calls import SaveCallBody, call_public

logger = logging.getLogger(__name__)

# Ceilings applied to a call from a public-directory visitor. Five minutes is a
# real conversation with a business and well past a nuisance call; thirty
# seconds of total silence is a line someone opened and walked away from.
DIRECTORY_SOURCE = "directory"

router = APIRouter()


async def _none():
    """A resolved awaitable for a lookup that doesn't apply this request.

    Lets the batched gather below keep one slot per value regardless of whether
    the caller is a known contact, instead of branching the whole batch.
    """
    return None


def _require_voice_caller(identity: Identity, contact, agent) -> None:
    """Admission for non-owner callers before any worker check or token.

    A caller without a live link to a deployed assistant must be rejected
    here: anything else mints a room whose assistant never arrives (silent
    room) or the wrong channel. Mirrors the caller_chat gate in
    business_routes.py. Owner test calls (no contact) never reach this —
    they keep their existing behavior, including the agent-less personal path.
    """
    if contact is None:
        raise HTTPException(
            status_code=403,
            detail="This link is no longer valid.",
        )
    try:
        contacts.check_usable(
            revoked_at=contact.revoked_at,
            expires_at=contact.expires_at,
            blocked_at=contact.blocked_at,
        )
    except contacts.ContactError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if (getattr(contact, "mode", "both") or "both") == "chat":
        raise HTTPException(
            status_code=403,
            detail="Voice calls are not available for this link.",
        )
    if agent is None or getattr(agent, "status", "draft") != "deployed":
        raise HTTPException(
            status_code=403,
            detail="Voice calls are not available until the assistant is deployed.",
        )


@router.get("/voices", dependencies=[Depends(verify_api_key)])
@router.get("/speakers", dependencies=[Depends(verify_api_key)])
async def list_voices() -> dict:
    """The TTS voices the UI may offer, grouped male/female. Single source of
    truth is the backend so the picker can never present a voice the worker
    would reject."""
    return {"voices": SUPPORTED_TTS_VOICES, "speakers": SUPPORTED_TTS_VOICES, "default": voice_settings.VOICE_TTS_SPEAKER}


@router.get("/languages", dependencies=[Depends(verify_api_key)])
async def list_languages() -> dict:
    """Languages the STT model accepts, with auto-detect first.

    Served from the backend so a picker can never offer a language the worker
    would reject — the same reason the voice list is served rather than
    hardcoded in the UI.
    """
    return {"languages": SUPPORTED_STT_LANGUAGES}


@router.get("/personas", dependencies=[Depends(verify_api_key)])
async def list_personas() -> dict:
    """Predefined voice personas (offered by the UI only when RAG is off).
    Excludes the raw prompt text — the UI just needs id/label/tagline."""
    return {
        "personas": [
            {"id": p["id"], "label": p["label"], "tagline": p["tagline"]}
            for p in PERSONAS
        ]
    }


@router.get("/health", dependencies=[Depends(verify_api_key)])
async def voice_health() -> dict:
    """Whether the voice worker process is actually up — proxies its
    built-in livekit-agents health endpoint (see VOICE_WORKER_HEALTH_PORT in
    worker.py). The frontend polls this to show "voice is offline" instead of
    the generic 10s "assistant isn't responding" failure, which previously
    looked identical whether the browser mic was the problem or the whole
    worker process had crashed/never started."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(settings.VOICE_WORKER_HEALTH_URL.rstrip("/") + "/")
        return {"available": resp.status_code == 200}
    except Exception:
        return {"available": False}


@router.post("/preview", dependencies=[Depends(verify_api_key)])
async def voice_preview(
    body: VoicePreviewRequest,
    identity: Identity = Depends(get_identity),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
) -> dict:
    """Synthesize a short sample of the requested voice so the picker can be
    "hear it, then pick it" instead of choosing blind off a one-line tagline.
    Uses Sarvam's one-shot REST endpoint directly (not the worker/LiveKit
    room) — there's no call in progress yet, just a voice sample."""
    # Resolve the Sarvam key: explicit header > owner's stored key > server default.
    sarvam_key = (x_user_sarvam_key or "").strip()
    if not sarvam_key:
        creds = await owner_service.resolve_credentials(identity.tenant_id)
        sarvam_key = (creds.get("sarvam_api_key") or "").strip()
    if not sarvam_key:
        sarvam_key = voice_settings.SARVAM_API_KEY
    if not sarvam_key:
        raise HTTPException(
            status_code=400,
            detail="No Sarvam API Key available. Add one in Settings or .env to preview voices.",
        )
    if body.speaker not in SUPPORTED_TTS_VOICE_IDS:
        raise HTTPException(status_code=400, detail="Unknown voice.")

    label = SUPPORTED_TTS_VOICE_LABELS[body.speaker]
    sample_text = f"Hi, I'm {label}. This is how I sound."

    payload = {
        "target_language_code": voice_settings.VOICE_TTS_LANGUAGE,
        "text": sample_text,
        "speaker": body.speaker,
        "model": "bulbul:v3",
        "output_audio_codec": "mp3",
    }
    headers = {
        "api-subscription-key": sarvam_key,
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(SARVAM_TTS_BASE_URL, json=payload, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Sarvam: {e}") from None

    if resp.status_code != 200:
        logger.warning("Sarvam TTS preview failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=502,
            detail="Sarvam couldn't generate that voice preview. Check your Sarvam API key.",
        )

    data = resp.json()
    audios = data.get("audios") or []
    if not audios:
        raise HTTPException(status_code=502, detail="Sarvam returned no audio.")

    # audios[0] is already base64-encoded audio from Sarvam — pass it through
    # as-is rather than decode/re-encode, the browser plays it via a data: URI.
    return {"audio_base64": audios[0], "mime_type": "audio/mpeg"}


async def verify_strict_internal_key(
    x_internal_key: Optional[str] = Header(default=None, alias="X-Internal-Key")
):
    """Internal-only authentication for voice credential resolution.

    Deliberately stricter than `verify_internal_api_key`: no fallback to
    API_KEY. The frontend proxy attaches API_KEY to every anonymous request,
    so a fallback here would let any proxied browser reach another tenant's
    stored provider keys. Without a configured INTERNAL_API_KEY this fails
    closed (503) rather than serving unauthenticated.
    """
    expected = settings.INTERNAL_API_KEY or ""
    if not expected:
        raise HTTPException(
            status_code=503,
            detail=(
                "INTERNAL_API_KEY is not configured — voice credential "
                "resolution is disabled rather than served unauthenticated."
            ),
        )
    if not hmac.compare_digest(x_internal_key or "", expected):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing internal key",
        )


class VoiceCredentialsRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=64)


@router.post("/credentials", dependencies=[Depends(verify_strict_internal_key)])
async def voice_credentials(body: VoiceCredentialsRequest) -> dict:
    """Stored provider credentials for a voice session, resolved server-side.

    Called by the voice worker at call setup with the tenant id from its
    dispatch metadata — never with browser-supplied identity. Reuses the same
    owner-service resolution as the token endpoint, plus the voice channel's
    own provider when the owner configured one. Returns only what a voice
    session needs; key values are never logged.
    """
    try:
        agent = await owner_service.cached_agent(body.tenant_id)
        workspace = await owner_service.cached_owner(body.tenant_id)
        stored = await owner_service.resolve_credentials(
            body.tenant_id, record=workspace
        )
    except Exception as exc:
        # Class name only: exception strings here can carry connection
        # details, and must never reach logs, let alone responses.
        logger.warning(
            "Voice credential resolution failed (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=503,
            detail="Voice credentials are temporarily unavailable.",
        )
    channel = owner_service.channel_settings(agent, "voice") if agent else {}
    # Keys only — model/base-URL selection already travels in dispatch
    # metadata (routing, not secrets).
    return {
        "groq_api_key": stored.get("groq_api_key") or "",
        "sarvam_api_key": stored.get("sarvam_api_key") or "",
        "custom_llm_api_key": (
            channel.get("api_key") or stored.get("custom_llm_api_key") or ""
        ),
    }


@router.post("/retrieve", dependencies=[Depends(verify_internal_api_key)])
async def voice_retrieve(body: VoiceRetrieveRequest) -> dict:
    """Retrieval-only endpoint the voice worker calls each turn when RAG is
    enabled. Reuses the exact same embeddings / hybrid search pipeline as
    text chat (imported here, not re-instantiated) and returns just the top
    chunk texts for the worker to feed its LLM."""
    query = body.query.strip()
    if not query:
        return {"chunks": []}

    # Imported lazily to reuse the singletons the API server already built at
    # startup (avoids a second copy of the embedding/sparse models).
    from app.api.routes import (
        NoDocumentsSelected,
        embedding_service,
        selected_document_ids,
        sparse_encoder,
        vector_store,
    )

    # Voice previously applied no document filter at all, so a call answered
    # from every document in the workspace regardless of what the owner had
    # selected — the same assistant behaved differently by channel, which is the
    # thing the per-channel work was meant to stop.
    try:
        owner_enabled = await selected_document_ids(body.tenant_id)
    except NoDocumentsSelected:
        # No chunks rather than an error: the agent falls back to answering from
        # its prompt, which is a supported configuration for voice (rag_enabled
        # is a per-agent toggle). Failing the call would be worse than a
        # slightly less informed answer.
        return {"chunks": []}

    # Product QR voice calls carry the product's assigned documents. Intersect
    # with the owner's enabled set so a stale or forged list can neither widen
    # retrieval beyond what the owner allows nor read another product's docs.
    if body.document_ids is not None:
        requested = {d for d in body.document_ids if isinstance(d, str) and d}
        allowed_documents = [d for d in owner_enabled if d in requested]
        if not allowed_documents:
            return {"chunks": []}
    else:
        allowed_documents = owner_enabled

    top_k = body.top_k or voice_settings.VOICE_RAG_TOP_K
    query_embedding, sparse_query = await asyncio.gather(
        run_in_threadpool(embedding_service.encode_query, query),
        run_in_threadpool(sparse_encoder.encode_query, query),
    )
    # Fast: direct hybrid results, no reranker cross-encoder — RRF fused score is ranking
    results = await run_in_threadpool(
        vector_store.search,
        query_vector=query_embedding,
        sparse_vector=sparse_query,
        limit=top_k,
        tenant_id=body.tenant_id,
        document_ids=allowed_documents,
    )
    chunks = [
        (r.get("payload") or {}).get("content", "") for r in results
    ]
    return {"chunks": [c for c in chunks if c]}


@router.get("/history", dependencies=[Depends(verify_internal_api_key)])
async def voice_history(conversation_id: str) -> dict:
    """Recent text-chat history for a conversation, so a voice call can be
    seeded with what was already discussed. Reuses the same conversation
    store as text chat."""
    from app.api.routes import conversation_service

    # Synchronous Redis client — must not run on the event loop. This endpoint
    # is called by the voice worker at the start of a call, so a stall here
    # delays every other request the API is serving.
    msgs = await run_in_threadpool(
        conversation_service.get_conversation_history, conversation_id
    )
    return {
        "messages": [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in msgs
            if m.get("content")
        ]
    }


@router.post("/token", response_model=VoiceTokenResponse, dependencies=[Depends(verify_api_key)])
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def create_voice_token(
    request: Request,
    body: VoiceTokenRequest,
    identity: Identity = Depends(get_identity),
    x_user_groq_key: Optional[str] = Header(default=None, alias="X-User-Groq-Key"),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
    x_user_custom_llm_key: Optional[str] = Header(default=None, alias="X-User-Custom-LLM-Key"),
) -> VoiceTokenResponse:
    """Issue a LiveKit access token so a client can join a voice room.

    Keys come from the caller's headers or, failing that, from the workspace.
    Never from server config: voice must always be billed to whoever owns the
    workspace, not to us.

    The check has to happen after the workspace lookup, not before. It used to
    reject on the headers alone, which meant an owner who had saved their keys
    in the console — and every caller arriving by invite link, who has no keys
    at all — was refused ninety lines before the stored credentials were ever
    read.
    """
    # Phase 1: identity-bound reads (agent, workspace, contact). The worker
    # check joins only after the caller proves valid — probing or spawning a
    # worker for a caller we are about to reject wastes a cold start and can
    # mask the real 403 behind a slow 503.
    #
    # Reads go through the config cache (see services/cache.py), so a repeat
    # call within the TTL skips the database entirely — which matters most
    # exactly here, where every one of these round trips is a caller watching a
    # "Connecting…" spinner.
    agent, workspace, contact = await asyncio.gather(
        owner_service.cached_agent(identity.tenant_id),
        owner_service.cached_owner(identity.tenant_id),
        (
            repositories.get_contact(identity.contact_id, identity.tenant_id)
            if identity.contact_id
            else _none()
        ),
    )
    if identity.contact_id:
        _require_voice_caller(identity, contact, agent)
    # Phase 2: worker admission — only for callers allowed to call. Makes
    # sure a worker is actually up before we hand out a token — otherwise
    # the room gets created with nobody to dispatch the job to, and the call
    # just times out with no obvious cause.
    worker_ready = await ensure_worker_running()
    if not worker_ready:
        raise HTTPException(
            status_code=503,
            detail="Voice service is temporarily unavailable. Please try again in a moment. If the problem persists, ensure the voice worker is running.",
        )
    # Not in the gather above: it needs the owner record, and passing the one
    # just fetched saves it re-reading the same row.
    resolved = await owner_service.resolve_credentials(
        identity.tenant_id, record=workspace
    )

    effective_groq = (
        x_user_groq_key
        or resolved.get("groq_api_key")
        or settings.GROQ_API_KEY
        or ""
    ).strip()
    effective_sarvam = (
        x_user_sarvam_key
        or resolved.get("sarvam_api_key")
        or settings.SARVAM_API_KEY
        or ""
    ).strip()
    # A custom OpenAI-compatible model replaces Groq entirely, so its presence
    # makes a Groq key unnecessary rather than merely optional.
    voice_channel = owner_service.channel_settings(agent, "voice") if agent else {}
    has_custom_llm = bool(
        (body.custom_llm_base_url or voice_channel.get("base_url") or resolved.get("custom_llm_base_url") or "").strip()
    )

    if not effective_groq and not has_custom_llm:
        raise HTTPException(
            status_code=400,
            detail=(
                "Add your Groq API key in Account before starting a voice "
                "session."
            ),
        )
    if not effective_sarvam:
        raise HTTPException(
            status_code=400,
            detail=(
                "Add your Sarvam API key in Account — voice needs it for "
                "speech."
            ),
        )
    # Dispatch metadata carries no key material (the worker resolves stored
    # keys server-side via POST /voice/credentials), so a key whose only
    # source is this request's headers could never reach the worker. Reject
    # loudly here rather than minting a token for a call that cannot speak.
    if (
        effective_groq
        and not has_custom_llm
        and x_user_groq_key
        and not resolved.get("groq_api_key")
        and not settings.GROQ_API_KEY
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Voice calls need a server-side Groq key — save one in "
                "Account or set GROQ_API_KEY in .env."
            ),
        )
    if (
        effective_sarvam
        and x_user_sarvam_key
        and not resolved.get("sarvam_api_key")
        and not settings.SARVAM_API_KEY
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Voice calls need a server-side Sarvam key — save one in "
                "Account or set SARVAM_API_KEY in .env."
            ),
        )
    effective_custom_key = (
        x_user_custom_llm_key
        or voice_channel.get("api_key")
        or resolved.get("custom_llm_api_key")
        or ""
    ).strip()
    if (
        (body.custom_llm_base_url or voice_channel.get("base_url"))
        and not effective_custom_key
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "This custom voice endpoint needs its API key saved in "
                "Account before starting a voice session."
            ),
        )
    if (
        body.custom_llm_base_url
        and x_user_custom_llm_key
        and not voice_channel.get("api_key")
        and not resolved.get("custom_llm_api_key")
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Voice calls need a server-side custom LLM key — save one "
                "in Account."
            ),
        )
    # The worker resolves stored keys via POST /voice/credentials, which
    # requires INTERNAL_API_KEY. If this session depends on stored keys and
    # that path is unavailable, the token would mint a call that can never
    # speak — refuse loudly here instead. Environment defaults need no
    # fetch, so sessions they cover proceed.
    custom_base_effective = (
        body.custom_llm_base_url
        or voice_channel.get("base_url")
        or resolved.get("custom_llm_base_url")
        or ""
    ).strip()
    needs_stored_fetch = (
        (
            not has_custom_llm
            and bool(resolved.get("groq_api_key"))
            and not settings.GROQ_API_KEY
        )
        or (
            bool(resolved.get("sarvam_api_key"))
            and not settings.SARVAM_API_KEY
        )
        or (
            bool(custom_base_effective)
            and bool(
                voice_channel.get("api_key")
                or resolved.get("custom_llm_api_key")
            )
        )
    )
    if needs_stored_fetch and not settings.INTERNAL_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "Voice credential service is not configured (INTERNAL_API_KEY). "
                "Voice calls that depend on saved workspace keys cannot start "
                "until it is set."
            ),
        )

    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        raise HTTPException(
            status_code=503,
            detail=(
                "Voice is not configured — set LIVEKIT_URL, LIVEKIT_API_KEY, "
                "and LIVEKIT_API_SECRET in .env."
            ),
        )

    # The daily ceiling, checked before a room is created rather than after.
    #
    # This is the only limit that bounds total spend: every other cap is
    # per-link, and links are free to mint. Checked for contacts rather than for
    # the owner testing their own agent — an owner locked out of their own
    # console by their own callers would be a worse failure than the overspend.
    if identity.contact_id:
        spend = await usage.usage_today(identity.tenant_id)
        if spend.over_budget:
            logger.warning(
                "Refusing call for %s: daily budget reached (%d calls, %d min)",
                identity.tenant_id, spend.calls, spend.minutes,
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    "This assistant has reached its limit for today. "
                    "Please try again tomorrow."
                ),
            )

    room_name = body.room_name or f"voice-{uuid4().hex[:12]}"
    participant_identity = f"user-{uuid4().hex[:8]}"

    tenant_id = identity.tenant_id

    # Detect gender of selected voice
    gender = "female"
    if body.tts_speaker:
        for g, list_of_voices in SUPPORTED_TTS_VOICES.items():
            if any(v["id"] == body.tts_speaker for v in list_of_voices):
                gender = g
                break

    # A business workspace has an agent its owner wrote, and their prompt leads
    # — persona, knowledge and tone are theirs. What we append is the clock
    # (which cannot be written in advance: a date typed into a prompt is stale
    # the next day) and our delivery rules, which govern reply length and
    # spoken form rather than character.
    #
    # The delivery rules are appended by default because the failure they
    # prevent is one the owner cannot see from the editor: they tune wording in
    # a text box and never hear that a four-paragraph answer takes forty
    # seconds to speak. An owner who wants their prompt honoured verbatim turns
    # style_rules_enabled off and owns the result.
    rag_enabled = body.rag_enabled

    cal_summary = ""
    try:
        from app.services import calendar_service as cal
        svcs = await cal.list_services(identity.tenant_id)
        if svcs:
            lines = []
            for s in svcs:
                s_name = getattr(s, "name", None) or (s.get("name") if isinstance(s, dict) else "")
                s_dur = getattr(s, "duration_mins", None) or (s.get("duration_mins") if isinstance(s, dict) else 30)
                if s_name:
                    lines.append(f"- {s_name} ({s_dur} mins)")
            if lines:
                cal_summary = "Bookable services:\n" + "\n".join(lines) + "\nUse check_availability to check free slots, and book_appointment when caller confirms."
    except Exception:
        pass

    channel = voice_channel
    if agent is not None and channel.get("script"):
        instructions = owner_service.build_agent_prompt(
            script=channel["script"],
            agent_name=agent.name,
            business_name=workspace.business_name if workspace else None,
            channel="voice",
            style_rules=channel.get("style_rules", True),
            calendar_summary=cal_summary,
        )
        # Per-channel RAG: Both OFF by default (prompt-first, fallback only when enabled). None -> False.
        _vrag = getattr(agent, "voice_rag_enabled", None)
        rag_enabled = bool(_vrag) if _vrag is not None else False

        # Voice, greeting and language are configuration the owner set and the
        # caller hears, so they come from the agent rather than the request.
        # Taking them from the body would let a caller pick a different voice
        agent_voice = agent.voice_id if (agent.voice_id and agent.voice_id in SUPPORTED_TTS_VOICE_IDS) else "priya"
        agent_overrides = {
            "tts_speaker": agent_voice,
            "stt_language": agent.language or "unknown",
            "greet_on_connect": bool((agent.greeting or "").strip()),
        }
        if (agent.greeting or "").strip():
            agent_overrides["greeting_text"] = agent.greeting.strip()

        # If caller identity is known (from contact link/directory connect), personalize instructions and greeting!
        if identity.contact_id:
            if contact and (contact.name or "").strip():
                caller_name = contact.name.strip()
                instructions += (
                    f"\n\n[CALLER IDENTITY]: You are on a live voice call with {caller_name}. "
                    f"Greet {caller_name} warmly by name right at the beginning of the call (e.g. 'Hello {caller_name}!'), "
                    f"and address them naturally as {caller_name}."
                )
                if (agent.greeting or "").strip():
                    agent_overrides["greeting_text"] = f"Hello {caller_name}! {agent.greeting.strip()}"
                else:
                    agent_overrides["greeting_text"] = f"Hello {caller_name}! How can I help you today?"
    else:
        agent_overrides = {}
        # Personal workspaces keep the persona system they already use.
        instructions = build_instructions(
            rag_enabled=body.rag_enabled,
            persona=body.persona,
            custom_prompt=body.custom_prompt,
            gender=gender,
        )

    meta: dict = {
        "rag_enabled": rag_enabled,
        "tenant_id": tenant_id,
        "contact_id": identity.contact_id,
        "instructions": instructions,
        # The worker needs this separately from the prompt: it decides which
        # token ceiling applies, and it cannot infer that from instructions it
        # only ever forwards. Personal workspaces have no agent and always get
        # the styled behaviour, which is what build_instructions gives them.
        "style_rules": channel.get("style_rules", True) if channel else True,
    }
    # Provider SELECTION only — never key material. Dispatch metadata is
    # visible to the LiveKit server, so Groq/Sarvam/custom/channel keys must
    # not enter it. The worker resolves stored keys server-side via
    # POST /voice/credentials (internal key) and falls back to its own
    # environment defaults; per-request header keys are rejected above when
    # they would be the sole source.
    stored = resolved

    if stored.get("llm_model") and not body.llm_model:
        meta["llm_model"] = stored["llm_model"]
    # The workspace endpoint is a fallback for a channel that named no provider
    # of its own. When the owner picked a model for *this* channel, it is not:
    # the worker flips the whole provider to custom_openai the moment it sees a
    # base URL, so leaving this in would send the channel's model name — a Groq
    # model, say — to an unrelated endpoint and fail the call. The console
    # clears the channel's own base_url when a hosted model is picked, but it
    # has no way to clear this one. URLs are routing, not secrets; the key
    # itself is resolved server-side by the worker.
    channel_names_a_model = bool(channel.get("model") or channel.get("base_url"))
    if (
        stored.get("custom_llm_base_url")
        and not body.custom_llm_base_url
        and not channel_names_a_model
    ):
        meta["custom_llm_base_url"] = stored["custom_llm_base_url"]
    # Only pass through a voice the worker will actually accept — silently
    # ignore anything else so a stale/bad client value can't crash the session.
    if body.tts_speaker and body.tts_speaker in SUPPORTED_TTS_VOICE_IDS:
        meta["tts_speaker"] = body.tts_speaker
    # A contact's call needs a conversation to write into, so the owner can
    # read back what was said. One is minted here when the caller didn't supply
    # one — without it the turns are stored against nothing and the History
    # view can only ever show that a call happened, not what it was about.
    conversation_id = body.conversation_id
    if identity.contact_id and not conversation_id:
        conversation_id = str(uuid4())

    if conversation_id:
        meta["conversation_id"] = conversation_id

    # Cost ceilings for this call.
    meta["idle_timeout_seconds"] = (
        settings.DIRECTORY_IDLE_TIMEOUT_SECONDS
        if (contact is not None and getattr(contact, "source", "owner") == DIRECTORY_SOURCE)
        else getattr(settings, "VOICE_IDLE_TIMEOUT_SECONDS", 10)
    )
    if contact is not None and getattr(contact, "source", "owner") == DIRECTORY_SOURCE:
        meta["max_call_seconds"] = settings.DIRECTORY_MAX_CALL_SECONDS

    call_id = await business.create_call(tenant_id, identity.contact_id,
        client_ip(request), request.headers.get("user-agent"))
    meta["call_id"] = call_id
    if body.llm_model:
        meta["llm_model"] = body.llm_model
    if body.custom_llm_base_url:
        meta["custom_llm_base_url"] = body.custom_llm_base_url
    meta.update(agent_overrides)
    if "greet_on_connect" not in agent_overrides:
        meta["greet_on_connect"] = body.greet_on_connect
    if body.greeting_text:
        meta["greeting_text"] = body.greeting_text
    # The agent's own sampling wins over the request's: a caller should not be
    # able to make a business's assistant more verbose or more erratic than its
    # owner configured.
    temperature = channel.get("temperature")
    max_tokens = channel.get("max_tokens")
    if temperature is None:
        temperature = body.temperature
    if max_tokens is None:
        max_tokens = body.max_tokens
    if temperature is not None:
        meta["temperature"] = temperature
    if max_tokens is not None:
        meta["max_tokens"] = max_tokens
    if channel.get("model"):
        meta["llm_model"] = channel["model"]
    # A channel's own provider replaces whatever the workspace has stored —
    # an owner may reasonably want a fast hosted model for calls and their own
    # server for chat, and a per-channel endpoint says so unambiguously.
    if channel.get("base_url"):
        meta["custom_llm_base_url"] = channel["base_url"]
    active_model = meta.get("llm_model") or getattr(voice_settings, "VOICE_LLM_MODEL", "") or "openai/gpt-oss-20b"
    if meta.get("custom_llm_base_url"):
        meta["llm_provider"] = "custom_openai"
    elif isinstance(active_model, str) and active_model.lower().startswith("mistral"):
        meta["llm_provider"] = "mistral"
    else:
        meta["llm_provider"] = "groq"

    dispatch_metadata = json.dumps(meta)
    # Report what was actually dispatched, not what the request asked for. The
    # two differ on every business call — the owner's channel model and voice
    # override the caller's — and reading the request's values here made the
    # log say a session ran on a model it did not, which is exactly the kind of
    # thing you go on to debug for an hour.
    logger.info(
        "[VOICE TOKEN] Room: '%s' | Provider: '%s' | LLM: '%s' | endpoint: %s | TTS voice: '%s' "
        "| STT lang: '%s' | style rules: %s | RAG: %s",
        room_name,
        meta.get("llm_provider"),
        meta.get("llm_model") or voice_settings.VOICE_LLM_MODEL,
        meta.get("custom_llm_base_url") or "groq",
        meta.get("tts_speaker") or voice_settings.VOICE_TTS_SPEAKER,
        meta.get("stt_language") or voice_settings.VOICE_STT_LANGUAGE,
        channel.get("style_rules", True) if channel else "n/a (personal)",
        meta.get("rag_enabled"),
    )

    token = (
        AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(participant_identity)
        .with_name(body.participant_name or participant_identity)
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

    public_url = (settings.LIVEKIT_PUBLIC_URL or "").strip() or settings.LIVEKIT_URL
    return VoiceTokenResponse(
        token=token.to_jwt(),
        url=public_url,
        room_name=room_name,
        participant_identity=participant_identity,
        call_id=call_id,
    )


@router.post("/record_session")
async def record_voice_session(
    body: SaveCallBody,
    identity: Identity = Depends(get_identity),
) -> dict:
    """Idempotent browser fallback. Analysis runs through the durable queue."""
    if identity.is_contact:
        from app.api.business_routes import require_caller
        await require_caller(identity)
    try:
        call = await business.save_call(str(body.call_id), identity.tenant_id, identity.contact_id,
            [m.model_dump() for m in body.messages], body.duration_seconds)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return {"status": "saved", **call_public(call)}


@router.get("/calls/{call_id}")
async def get_saved_call(call_id: UUID, identity: Identity = Depends(get_identity)):
    if identity.is_contact:
        from app.api.business_routes import require_caller
        await require_caller(identity)
    call = await business.get_call(str(call_id), identity.tenant_id, identity.contact_id)
    if not call:
        raise HTTPException(404, "Call not found")
    return call_public(call, include_transcript=True)
