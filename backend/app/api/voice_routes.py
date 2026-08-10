"""Voice session token issuance.

A separate router (new bounded context) rather than adding to routes.py —
this is the one piece of the VoiceBot feature that lives in the API server:
a client needs a signed LiveKit room token before it can connect at all,
and the VoiceBot worker (app/services/voice/worker.py) picks up the
resulting room as a dispatched job. Everything else voice-related lives in
app/services/voice/, decoupled from this request/response server.
"""
import asyncio
import json
import logging
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from livekit.api import AccessToken, RoomAgentDispatch, RoomConfiguration, VideoGrants

from app import repositories
from app.auth import verify_api_key, verify_internal_api_key
from app.config import settings
from app.identity import Identity, get_identity
from app.services import owner_service
from app.rate_limit import client_ip
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
from app.services.voice.worker_supervisor import ensure_worker_running

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/voices", dependencies=[Depends(verify_api_key)])
async def list_voices() -> dict:
    """The TTS voices the UI may offer, grouped male/female. Single source of
    truth is the backend so the picker can never present a voice the worker
    would reject."""
    return {"voices": SUPPORTED_TTS_VOICES, "default": voice_settings.VOICE_TTS_SPEAKER}


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
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
) -> dict:
    """Synthesize a short sample of the requested voice so the picker can be
    "hear it, then pick it" instead of choosing blind off a one-line tagline.
    Uses Sarvam's one-shot REST endpoint directly (not the worker/LiveKit
    room) — there's no call in progress yet, just a voice sample."""
    if not x_user_sarvam_key or not x_user_sarvam_key.strip():
        raise HTTPException(
            status_code=400,
            detail="Sarvam API Key is required to preview a voice.",
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
        "api-subscription-key": x_user_sarvam_key,
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


@router.post("/retrieve", dependencies=[Depends(verify_internal_api_key)])
async def voice_retrieve(body: VoiceRetrieveRequest) -> dict:
    """Retrieval-only endpoint the voice worker calls each turn when RAG is
    enabled. Reuses the exact same embeddings / hybrid search / reranker as
    text chat (imported here, not re-instantiated) and returns just the top
    chunk texts for the worker to feed its LLM."""
    query = body.query.strip()
    if not query:
        return {"chunks": []}

    # Imported lazily to reuse the singletons the API server already built at
    # startup (avoids a second copy of the embedding/reranker models).
    from app.api.routes import (
        embedding_service,
        reranker,
        sparse_encoder,
        vector_store,
    )

    top_k = body.top_k or voice_settings.VOICE_RAG_TOP_K
    query_embedding, sparse_query = await asyncio.gather(
        run_in_threadpool(embedding_service.encode_query, query),
        run_in_threadpool(sparse_encoder.encode_query, query),
    )
    # Narrower over-fetch than text chat's `max(top_k * 3, 20)`. Every extra
    # candidate is another cross-encoder pass, and this runs inside the pause
    # between the user finishing a sentence and the assistant speaking — where
    # text chat can absorb the cost behind a streaming cursor, voice cannot.
    hybrid = await run_in_threadpool(
        vector_store.search,
        query_vector=query_embedding,
        sparse_vector=sparse_query,
        limit=max(top_k * 3, 10),
        tenant_id=body.tenant_id,
    )
    results = await run_in_threadpool(reranker.rerank, query, hybrid, top_k=top_k)
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

    msgs = conversation_service.get_conversation_history(conversation_id)
    return {
        "messages": [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in msgs
            if m.get("content")
        ]
    }


@router.post("/token", response_model=VoiceTokenResponse, dependencies=[Depends(verify_api_key)])
async def create_voice_token(
    request: Request,
    body: VoiceTokenRequest,
    identity: Identity = Depends(get_identity),
    x_user_groq_key: Optional[str] = Header(default=None, alias="X-User-Groq-Key"),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
    x_user_custom_llm_key: Optional[str] = Header(default=None, alias="X-User-Custom-LLM-Key"),
) -> VoiceTokenResponse:
    """Issue a LiveKit access token so a client can join a voice room.

    Requires both user Groq and Sarvam keys; no fallback to server keys is allowed.
    """
    if not x_user_groq_key or not x_user_groq_key.strip():
        raise HTTPException(
            status_code=400,
            detail="Groq API Key is required to start a voice session."
        )
    if not x_user_sarvam_key or not x_user_sarvam_key.strip():
        raise HTTPException(
            status_code=400,
            detail="Sarvam API Key is required to start a voice session."
        )

    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        raise HTTPException(
            status_code=503,
            detail=(
                "Voice is not configured — set LIVEKIT_URL, LIVEKIT_API_KEY, "
                "and LIVEKIT_API_SECRET in .env."
            ),
        )

    # Local-dev convenience: make sure a worker is actually up before we hand
    # out a token — otherwise the room gets created with nobody to dispatch
    # the job to, and the call just times out with no obvious cause.
    await ensure_worker_running()

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

    # A business workspace has an agent its owner wrote, and that prompt is
    # passed through verbatim — the way every voice-agent builder works. Adding
    # our own persona and style scaffolding on top would mean the owner tunes a
    # prompt and hears something else, which makes the editor untrustworthy.
    #
    # Only the clock is appended, because it cannot be written in advance: a
    # date typed into a prompt is stale the next day, and the model otherwise
    # answers "what is today" from training data.
    #
    # Formatting safety is not lost by dropping the prompt rules — markdown is
    # stripped in code at tts_node, which holds regardless of which model or
    # prompt produced the text.
    agent = await repositories.get_agent(tenant_id)
    rag_enabled = body.rag_enabled

    if agent is not None and (agent.script or "").strip():
        workspace = await repositories.get_owner(tenant_id)
        instructions = owner_service.build_agent_prompt(
            script=agent.script,
            agent_name=agent.name,
            business_name=workspace.business_name if workspace else None,
        )
        # The owner's saved toggle wins for voice; chat always retrieves.
        rag_enabled = agent.rag_enabled

        # Voice, greeting and language are configuration the owner set and the
        # caller hears, so they come from the agent rather than the request.
        # Taking them from the body would let a caller pick a different voice
        # than the business chose.
        agent_overrides = {
            "tts_speaker": agent.voice_id,
            "stt_language": agent.language or "unknown",
            "greet_on_connect": bool((agent.greeting or "").strip()),
        }
        if (agent.greeting or "").strip():
            agent_overrides["greeting_text"] = agent.greeting.strip()
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
        "instructions": instructions,
    }
    if x_user_groq_key:
        meta["groq_api_key"] = x_user_groq_key
    if x_user_sarvam_key:
        meta["sarvam_api_key"] = x_user_sarvam_key
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

    if identity.contact_id:
        await repositories.get_or_create_conversation(conversation_id, tenant_id)
        await repositories.start_contact_session(
            session_id=str(uuid4()),
            contact_id=identity.contact_id,
            conversation_id=conversation_id,
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            device_id=None,
            channel="voice",
        )
    if body.llm_model:
        meta["llm_model"] = body.llm_model
    if body.custom_llm_base_url:
        meta["custom_llm_base_url"] = body.custom_llm_base_url
        if x_user_custom_llm_key:
            meta["custom_llm_api_key"] = x_user_custom_llm_key
    meta.update(agent_overrides)
    if "greet_on_connect" not in agent_overrides:
        meta["greet_on_connect"] = body.greet_on_connect
    if body.greeting_text:
        meta["greeting_text"] = body.greeting_text
    if body.temperature is not None:
        meta["temperature"] = body.temperature
    if body.max_tokens is not None:
        meta["max_tokens"] = body.max_tokens
    dispatch_metadata = json.dumps(meta)
    selected_llm = body.llm_model or settings.GROQ_MODEL
    selected_speaker = body.tts_speaker or voice_settings.VOICE_TTS_SPEAKER
    logger.info(
        f"[VOICE TOKEN] Room: '{room_name}' | LLM Model: '{selected_llm}' | "
        f"TTS Voice: '{selected_speaker}' (bulbul:v3) | STT: Sarvam AI (saaras:v2)"
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

    return VoiceTokenResponse(
        token=token.to_jwt(),
        url=settings.LIVEKIT_URL,
        room_name=room_name,
        participant_identity=participant_identity,
    )
