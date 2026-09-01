"""Workspace and agent endpoints.

Thin by design: parse, delegate to `owner_service`, translate errors to status
codes. No business rules live here — if a decision is being made in this file,
it is in the wrong place.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import repositories
from app.api.session_routes import cookie_params
from app.config import settings
from app.identity import Identity, get_identity
from app.rate_limit import limiter
from app.services import owner_auth
from app.session import issue
from app.services import owner_service
from app.services.voice.config import SUPPORTED_TTS_VOICE_IDS

logger = logging.getLogger(__name__)
router = APIRouter()


class ChooseModeRequest(BaseModel):
    mode: str = Field(pattern="^(personal|business)$")
    business_name: Optional[str] = Field(default=None, max_length=200)
    business_category: Optional[str] = Field(default=None, max_length=64)


class AgentConfigRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    script: Optional[str] = Field(default=None, max_length=20000)
    voice_id: Optional[str] = Field(default=None, max_length=64)
    rag_enabled: Optional[bool] = None
    voice_rag_enabled: Optional[bool] = None
    chat_rag_enabled: Optional[bool] = None
    greeting: Optional[str] = Field(default=None, max_length=800)
    # STT language, or "unknown" to auto-detect. Was accepted by the service
    # layer and stored on the model but never declared here, so an owner's
    # choice was dropped between the console and the database.
    language: Optional[str] = Field(default=None, max_length=16)
    # Whether our delivery rules are appended to the owner's script. Null means
    # "leave as-is", like every other field on this model.
    style_rules_enabled: Optional[bool] = None

    # Per-channel overrides. Null means "use the shared setting" — the console
    # sends only what the owner edited, so absent must not mean cleared.
    voice_script: Optional[str] = Field(default=None, max_length=20000)
    chat_script: Optional[str] = Field(default=None, max_length=20000)
    voice_model: Optional[str] = Field(default=None, max_length=120)
    chat_model: Optional[str] = Field(default=None, max_length=120)
    voice_base_url: Optional[str] = Field(default=None, max_length=500)
    chat_base_url: Optional[str] = Field(default=None, max_length=500)
    voice_api_key: Optional[str] = Field(default=None, max_length=300)
    chat_api_key: Optional[str] = Field(default=None, max_length=300)
    voice_temperature: Optional[float] = Field(default=None, ge=0, le=2)
    chat_temperature: Optional[float] = Field(default=None, ge=0, le=2)
    # Voice is capped lower: 500 tokens is roughly forty seconds of speech, and
    # past that a caller is listening to a lecture rather than an answer.
    voice_max_tokens: Optional[int] = Field(default=None, ge=50, le=800)
    chat_max_tokens: Optional[int] = Field(default=None, ge=50, le=4000)


def _require_workspace_owner(identity: Identity) -> None:
    """A caller reached us through someone else's link. They may talk to that
    owner's agent; they may never configure it."""
    if identity.is_contact:
        raise HTTPException(
            status_code=403,
            detail="This link can talk to the assistant, but cannot change it.",
        )


@router.get("")
async def get_workspace(identity: Identity = Depends(get_identity)):
    """The current workspace, created on first sight.

    The frontend calls this on load to decide which product to render: the
    personal app, the business setup screen, or the agent editor.
    """
    _require_workspace_owner(identity)
    workspace = await owner_service.get_or_create_workspace(identity.tenant_id)
    return workspace.to_dict()


@router.get("/categories")
async def list_categories():
    """Closed list, so the answers stay countable."""
    return {"categories": owner_service.BUSINESS_CATEGORIES}


@router.post("/mode")
async def choose_mode(
    response: Response,
    body: ChooseModeRequest,
    identity: Identity = Depends(get_identity),
):
    """Answer Personal-or-Business, and pin the workspace to a session.

    Until now identity was derived from whichever API keys a request carried,
    so the *same person* resolved to different workspaces depending on whether
    a given request happened to send its headers — which stranded an agent
    under one tenant while the console asked about another. It also meant
    rotating an API key silently abandoned the workspace built with it.

    Choosing a mode now issues a cookie carrying the tenant, so from here on
    the workspace is whatever the session says rather than whatever the
    headers imply.
    """
    _require_workspace_owner(identity)
    try:
        workspace = await owner_service.choose_mode(
            identity.tenant_id,
            mode=body.mode,
            business_name=body.business_name,
            business_category=body.business_category,
        )
    except owner_service.OwnerError as exc:
        # The service's messages are written for the person reading them, so
        # they are passed through rather than replaced with a generic 400.
        raise HTTPException(status_code=400, detail=str(exc))

    response.set_cookie(
        value=issue(kind=f"owner:{identity.tenant_id}"),
        max_age=settings.SESSION_TTL_DAYS * 86400,
        **cookie_params(),
    )
    logger.info("Workspace pinned to session: %s", identity.tenant_id)
    return workspace.to_dict()


class ProfileUpdateRequest(BaseModel):
    business_name: Optional[str] = Field(default=None, max_length=200)
    business_category: Optional[str] = Field(default=None, max_length=64)


@router.put("/profile")
async def update_profile(
    body: ProfileUpdateRequest, identity: Identity = Depends(get_identity)
):
    """Update business name and category."""
    _require_workspace_owner(identity)
    if body.business_category and body.business_category not in owner_service.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Pick a valid category that fits your business.")

    record = await repositories.update_owner(
        tenant_id=identity.tenant_id,
        business_name=(body.business_name or "").strip() or None,
        business_category=body.business_category,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    return {
        "business_name": record.business_name,
        "business_category": record.business_category,
    }



class CredentialsRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


@router.post("/credentials")
async def set_credentials(
    body: CredentialsRequest, identity: Identity = Depends(get_identity)
):
    """Attach an email and password to the workspace the caller already holds.

    Deliberately not a signup: the workspace exists because they brought their
    own keys. This only adds a way back in that does not require re-pasting a
    long secret on every device.
    """
    _require_workspace_owner(identity)
    try:
        email = owner_auth.validate_email(body.email)
        owner_auth.validate_password(body.password)
    except owner_auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await owner_service.get_or_create_workspace(identity.tenant_id)

    existing = await repositories.get_owner_by_email(email)
    if existing is not None and existing.tenant_id != identity.tenant_id:
        raise HTTPException(
            status_code=409, detail="That email is already in use."
        )

    await repositories.set_owner_credentials(
        tenant_id=identity.tenant_id,
        email=email,
        password_hash=owner_auth.hash_password(body.password),
    )
    logger.info("Credentials set for workspace %s", identity.tenant_id)
    return {"email": email}


class SignupRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)
    business_name: Optional[str] = Field(default=None, max_length=200)
    business_category: Optional[str] = Field(default=None, max_length=64)


@router.post("/signup")
@limiter.limit("5/minute")
async def signup(request: Request, response: Response, body: SignupRequest):
    """Register a new business workspace directly with email and password."""
    import uuid

    try:
        email = owner_auth.validate_email(body.email)
        owner_auth.validate_password(body.password)
    except owner_auth.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    existing = await repositories.get_owner_by_email(email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="That email is already in use.")

    tenant_id = uuid.uuid4().hex[:16]
    owner = await repositories.create_owner(
        tenant_id=tenant_id,
        mode=owner_service.BUSINESS,
        business_name=body.business_name.strip() if body.business_name else None,
        business_category=body.business_category,
    )
    await repositories.set_owner_credentials(
        tenant_id=tenant_id,
        email=email,
        password_hash=owner_auth.hash_password(body.password),
    )

    response.set_cookie(
        value=issue(kind=f"owner:{tenant_id}"),
        max_age=settings.SESSION_TTL_DAYS * 86400,
        **cookie_params(),
    )
    logger.info("New business workspace signed up: %s", tenant_id)
    return {
        "email": email,
        "mode": owner.mode,
        "business_name": owner.business_name,
        "business_category": owner.business_category,
        "is_business": True,
    }


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, response: Response, body: CredentialsRequest):
    """Sign in to an existing workspace.

    Rate limited per IP because this is the one endpoint where guessing pays.
    The failure message is identical for an unknown email and a wrong password,
    so it cannot be used to discover which businesses have accounts.
    """
    email = owner_auth.normalise_email(body.email)
    record = await repositories.get_owner_by_email(email)

    if record is None or not record.password_hash:
        # Hash anyway, so a missing account and a wrong password take the same
        # time — otherwise response timing reveals which emails are registered.
        owner_auth.hash_password(body.password)
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")

    if not owner_auth.verify_password(body.password, record.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")

    response.set_cookie(
        value=issue(kind=f"owner:{record.tenant_id}"),
        max_age=settings.SESSION_TTL_DAYS * 86400,
        **cookie_params(),
    )
    logger.info("Owner signed in: %s", record.tenant_id)
    return {
        "email": record.email,
        "mode": record.mode,
        "business_name": record.business_name,
        "business_category": record.business_category,
        "is_business": record.mode == owner_service.BUSINESS,
    }


@router.post("/logout")
async def logout(response: Response):
    """Clear the session."""
    params = cookie_params()
    response.delete_cookie(
        key=params["key"],
        path="/",
        httponly=params.get("httponly", True),
        samesite=params.get("samesite", "lax"),
        secure=params.get("secure", False),
    )
    response.set_cookie(
        key=params["key"],
        value="",
        max_age=0,
        expires=0,
        path="/",
        httponly=params.get("httponly", True),
        samesite=params.get("samesite", "lax"),
        secure=params.get("secure", False),
    )
    return {"status": "signed out"}


class ProviderSettingsRequest(BaseModel):
    # Empty string clears; omitted leaves alone. The console sends only what
    # the owner edited, so a blank field must not wipe a working key.
    groq_key: Optional[str] = Field(default=None, max_length=300)
    sarvam_key: Optional[str] = Field(default=None, max_length=300)
    custom_llm_key: Optional[str] = Field(default=None, max_length=300)
    custom_llm_base_url: Optional[str] = Field(default=None, max_length=500)
    llm_model: Optional[str] = Field(default=None, max_length=120)


@router.get("/providers")
async def get_providers(identity: Identity = Depends(get_identity)):
    """Masked hints only — enough to recognise a stored key, never enough to
    use it."""
    _require_workspace_owner(identity)
    return await owner_service.get_provider_settings(identity.tenant_id)


@router.put("/providers")
async def save_providers(
    body: ProviderSettingsRequest, identity: Identity = Depends(get_identity)
):
    _require_workspace_owner(identity)
    try:
        return await owner_service.save_provider_settings(
            identity.tenant_id,
            groq_key=body.groq_key,
            sarvam_key=body.sarvam_key,
            custom_llm_key=body.custom_llm_key,
            custom_llm_base_url=body.custom_llm_base_url,
            llm_model=body.llm_model,
        )
    except owner_service.OwnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/agent/deploy")
async def deploy_agent(identity: Identity = Depends(get_identity)):
    """Take the agent live. Links do nothing until this happens."""
    _require_workspace_owner(identity)
    try:
        return await owner_service.deploy_agent(identity.tenant_id)
    except owner_service.OwnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/agent/undeploy")
async def undeploy_agent(identity: Identity = Depends(get_identity)):
    """Take it offline without losing it. Existing links stop connecting."""
    _require_workspace_owner(identity)
    return await owner_service.undeploy_agent(identity.tenant_id)


@router.get("/models")
async def list_models():
    """The shortlist a picker offers.

    Served from the backend so the personal app and the owner console cannot
    drift apart and offer a model the other does not. Anything outside it is
    reachable through a custom OpenAI-compatible provider.
    """
    from app.services.model_catalogue import GROQ_MODELS

    return {"models": GROQ_MODELS}


@router.get("/channels")
async def get_channels(identity: Identity = Depends(get_identity)):
    """What the console may offer: testing, and link types."""
    _require_workspace_owner(identity)
    return await owner_service.available_channels(identity.tenant_id)


@router.get("/agent")
async def get_agent(identity: Identity = Depends(get_identity)):
    _require_workspace_owner(identity)
    return await owner_service.get_agent_config(identity.tenant_id)


@router.put("/agent")
async def save_agent(
    body: AgentConfigRequest, identity: Identity = Depends(get_identity)
):
    _require_workspace_owner(identity)
    try:
        return await owner_service.save_agent_config(
            identity.tenant_id,
            name=body.name,
            script=body.script,
            voice_id=body.voice_id,
            language=body.language,
            rag_enabled=body.rag_enabled,
            voice_rag_enabled=body.voice_rag_enabled,
            chat_rag_enabled=body.chat_rag_enabled,
            greeting=body.greeting,
            style_rules_enabled=body.style_rules_enabled,
            # The allowed set is owned by the voice config, not duplicated here,
            # so adding a voice in one place is enough.
            allowed_voices=SUPPORTED_TTS_VOICE_IDS,
            **{f: getattr(body, f) for f in (
                "voice_script", "chat_script", "voice_model", "chat_model",
                "voice_base_url", "chat_base_url",
                "voice_api_key", "chat_api_key",
                "voice_temperature", "chat_temperature",
                "voice_max_tokens", "chat_max_tokens",
            )},
        )
    except owner_service.OwnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/agent")
async def delete_agent(identity: Identity = Depends(get_identity)):
    """Delete and reset the agent back to empty draft defaults."""
    _require_workspace_owner(identity)
    return await owner_service.delete_agent(identity.tenant_id)


# ---- Multi-agent: site or upload + questionnaire, one live at a time ----

class SiteAgentRequest(BaseModel):
    url: Optional[str] = Field(default=None, max_length=500)
    name: Optional[str] = Field(default=None, max_length=120)
    business: Optional[str] = Field(default=None, max_length=200)
    goal: Optional[str] = Field(default=None, max_length=500)
    tone: Optional[str] = Field(default=None, max_length=100)
    language: Optional[str] = Field(default=None, max_length=16)
    channel: Optional[str] = Field(default=None, max_length=10)  # both|voice|chat
    voice_script: Optional[str] = Field(default=None, max_length=20000)
    chat_script: Optional[str] = Field(default=None, max_length=20000)
    greeting: Optional[str] = Field(default=None, max_length=800)


@router.post("/agents/generate-preview")
async def generate_agent_preview(body: SiteAgentRequest, identity: Identity = Depends(get_identity)):
    """Extract content from site/docs and generate high-quality Voice & Chat prompts for owner review."""
    _require_workspace_owner(identity)
    from app.services.site_ingest import fetch_site_pages, build_prompt_with_mistral
    url = (body.url or "").strip()
    pages: list[dict] = []
    if url:
        try:
            pages = await fetch_site_pages(url)
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e)[:400])
    else:
        try:
            docs = await repositories.list_documents(identity.tenant_id, purpose="agent")
            if docs:
                from app.api.routes import vector_store as _vs
                from fastapi.concurrency import run_in_threadpool as _rt
                pages = []
                for d in docs[:3]:
                    try:
                        chunks = await _rt(_vs.get_document_chunks, d.document_id, identity.tenant_id)
                        text = "\n\n".join(c.get("content", "") for c in chunks)[:4000] if chunks else d.filename
                        if not text.strip():
                            text = d.filename
                        pages.append({"title": d.filename, "text": text, "url": ""})
                    except Exception:
                        pages.append({"title": d.filename, "text": d.filename, "url": ""})
        except Exception:
            pass

    prompt = await build_prompt_with_mistral(pages, {"name": body.name, "business": body.business, "goal": body.goal, "tone": body.tone})
    ch = (body.channel or "both").strip().lower()
    vs = prompt["voice_script"] if ch in ("voice", "both") else ""
    cs = prompt["chat_script"] if ch in ("chat", "both") else ""
    return {
        "voice_script": vs,
        "chat_script": cs,
        "greeting": prompt.get("greeting", ""),
        "business": body.business or (pages[0]["title"] if pages else "Assistant"),
        "pages_found": len(pages),
    }


@router.post("/agents/from-site")
async def create_from_site(body: SiteAgentRequest, identity: Identity = Depends(get_identity)):
    """Create a draft agent from a site link or PDF docs."""
    _require_workspace_owner(identity)
    from app.services.site_ingest import fetch_site_pages, build_prompt_with_mistral
    import uuid
    url = (body.url or "").strip()
    pages: list[dict] = []
    source = "manual"
    source_url = None
    snapshot_id = uuid.uuid4().hex[:12]
    if url:
        try:
            pages = await fetch_site_pages(url)
            source = "site"
            source_url = url
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e)[:400])
    else:
        source = "upload"
        try:
            docs = await repositories.list_documents(identity.tenant_id, purpose="agent")
            if docs and not pages:
                from app.api.routes import vector_store as _vs
                from fastapi.concurrency import run_in_threadpool as _rt
                pages = []
                for d in docs[:3]:
                    try:
                        chunks = await _rt(_vs.get_document_chunks, d.document_id, identity.tenant_id)
                        text = "\n\n".join(c.get("content", "") for c in chunks)[:4000] if chunks else d.filename
                        if not text.strip():
                            text = d.filename
                        pages.append({"title": d.filename, "text": text, "url": ""})
                    except Exception:
                        pages.append({"title": d.filename, "text": d.filename, "url": ""})
        except Exception:
            pass

    # If scripts were reviewed & edited in preview modal, prioritize them
    if (body.voice_script and len(body.voice_script.strip()) > 20) or (body.chat_script and len(body.chat_script.strip()) > 20):
        prompt = {
            "voice_script": body.voice_script or "",
            "chat_script": body.chat_script or "",
            "greeting": body.greeting or f"Hello! Thanks for calling {body.business or 'our business'}. How can I help you today?",
        }
    else:
        prompt = await build_prompt_with_mistral(pages, {"name": body.name, "business": body.business, "goal": body.goal, "tone": body.tone})

    ch = (body.channel or "both").strip().lower()
    vs = (body.voice_script if body.voice_script is not None else prompt.get("voice_script")) if ch in ("voice", "both") else None
    cs = (body.chat_script if body.chat_script is not None else prompt.get("chat_script")) if ch in ("chat", "both") else None
    if body.voice_script == "" or ch == "chat":
        vs = None
    if body.chat_script == "" or ch == "voice":
        cs = None

    fallback_script = ((cs if ch == "chat" else vs if ch == "voice" else (cs or vs or "")) or "")[:5000]
    from app.services import owner_service as _svc
    agent_display_name = (body.name or body.business or "Assistant").strip()[:120] or "Assistant"
    cfg = await _svc.save_agent_config(
        identity.tenant_id,
        name=agent_display_name,
        voice_id=None,
        language=body.language or "unknown",
        script=fallback_script,
        voice_script=vs,
        chat_script=cs,
        greeting=body.greeting or prompt.get("greeting"),
        allowed_voices=SUPPORTED_TTS_VOICE_IDS,
    )
    # also snapshot for history (use pre-allocated snapshot_id so fallback doc can link)
    try:
        from app.database import async_session
        from app.models.db_models import AgentSnapshotRecord
        async with async_session() as session:
            session.add(AgentSnapshotRecord(
                snapshot_id=snapshot_id,
                tenant_id=identity.tenant_id,
                name=cfg.get("name", "Assistant"),
                script=cfg.get("script", ""),
                voice_script=cfg.get("voice_script"),
                chat_script=cfg.get("chat_script"),
                voice_id=cfg.get("voice_id", "anushka"),
                language=cfg.get("language", "unknown"),
                greeting=cfg.get("greeting"),
                source=source,
                source_url=source_url,
            ))
            await session.commit()
    except Exception:
        logger.warning("Failed to save snapshot %s", snapshot_id, exc_info=True)
    # ONE consolidated fallback RAG doc per agent (full verbatim, not per-page). Linked to snapshot for cascade delete.
    # RAG is OFF by default — this doc is fallback only when owner enables voice_rag/chat_rag.
    if pages:
        try:
            from app.api.routes import _ingest_file as _ingest_site_file
            if source == "site":
                combined = "\n\n---\n\n".join([f"# {p.get('title', '')}\nSource: {p.get('url', '')}\n\n{p.get('text', '')}" for p in pages])
                # cap ~80k chars for embedding (still detailed for fallback)
                if len(combined) > 80000:
                    combined = combined[:80000]
                md = f"# Fallback knowledge for {snapshot_id} — {source_url or 'upload'}\n\n{combined}"
                doc_id = uuid.uuid4().hex
                safe = f"fallback-{snapshot_id}.md"
                await _ingest_site_file(md.encode("utf-8"), doc_id, safe, identity.tenant_id, len(md.encode("utf-8")), purpose="rag", source_snapshot_id=snapshot_id)
            else:
                # PDF/upload fallback: combine retrieved agent doc texts
                combined = "\n\n---\n\n".join([f"# {p.get('title', '')}\n\n{p.get('text', '')}" for p in pages])
                if len(combined) > 80000:
                    combined = combined[:80000]
                md = f"# Fallback knowledge for {snapshot_id} — upload\n\n{combined}"
                doc_id = uuid.uuid4().hex
                safe = f"fallback-{snapshot_id}.md"
                await _ingest_site_file(md.encode("utf-8"), doc_id, safe, identity.tenant_id, len(md.encode("utf-8")), purpose="rag", source_snapshot_id=snapshot_id)
        except Exception:
            logger.warning("Failed to create fallback RAG doc for %s", snapshot_id, exc_info=True)
    return cfg


@router.get("/agents")
async def list_agents(identity: Identity = Depends(get_identity)):
    """All past agents (snapshots) + active. One live at a time — activate any."""
    _require_workspace_owner(identity)
    from app.database import async_session
    from app.models.db_models import AgentSnapshotRecord
    from sqlalchemy import select
    async with async_session() as session:
        result = await session.execute(
            select(AgentSnapshotRecord).where(AgentSnapshotRecord.tenant_id == identity.tenant_id).order_by(AgentSnapshotRecord.created_at.desc())
        )
        rows = list(result.scalars().all())
    active = await repositories.get_agent(identity.tenant_id)
    
    def _is_active(r) -> bool:
        if not active:
            return False
        if active.name and r.name and active.name == r.name:
            if active.voice_script and r.voice_script and active.voice_script == r.voice_script:
                return True
            if active.script and r.script and active.script == r.script:
                return True
        return False

    return {
        "active_agent": {
            "name": active.name if active else "Assistant",
            "status": active.status if active else "draft",
            "voice_id": active.voice_id if active else "anushka",
            "language": active.language if active else "unknown",
        } if active else None,
        "snapshots": [
            {
                "snapshot_id": r.snapshot_id,
                "name": r.name,
                "source": r.source,
                "source_url": r.source_url,
                "language": r.language,
                "voice_id": r.voice_id,
                "greeting": r.greeting,
                "is_active": _is_active(r),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "script": r.script or "",
                "voice_script": r.voice_script or "",
                "chat_script": r.chat_script or "",
            }
            for r in rows[:50]
        ],
    }


@router.post("/agents/{snapshot_id}/activate")
async def activate_snapshot(snapshot_id: str, identity: Identity = Depends(get_identity)):
    """Make a past snapshot live again."""
    _require_workspace_owner(identity)
    from app.database import async_session
    from app.models.db_models import AgentSnapshotRecord
    from sqlalchemy import select
    async with async_session() as session:
        result = await session.execute(select(AgentSnapshotRecord).where(AgentSnapshotRecord.snapshot_id == snapshot_id, AgentSnapshotRecord.tenant_id == identity.tenant_id))
        snap = result.scalar_one_or_none()
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        # copy to active
        await owner_service.save_agent_config(
            identity.tenant_id,
            name=snap.name,
            script=snap.script,
            voice_id=snap.voice_id,
            language=snap.language,
            greeting=snap.greeting,
            voice_script=snap.voice_script,
            chat_script=snap.chat_script,
            allowed_voices=SUPPORTED_TTS_VOICE_IDS,
        )
    return {"status": "activated", "snapshot_id": snapshot_id}


@router.delete("/agents/{snapshot_id}")
async def delete_snapshot(snapshot_id: str, identity: Identity = Depends(get_identity)):
    """Delete a past agent snapshot and its linked fallback RAG doc + vectors. Active stays."""
    _require_workspace_owner(identity)
    from app.database import async_session
    from app.models.db_models import AgentSnapshotRecord
    from sqlalchemy import select, delete
    async with async_session() as session:
        result = await session.execute(select(AgentSnapshotRecord).where(AgentSnapshotRecord.snapshot_id == snapshot_id, AgentSnapshotRecord.tenant_id == identity.tenant_id))
        snap = result.scalar_one_or_none()
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        await session.execute(delete(AgentSnapshotRecord).where(AgentSnapshotRecord.snapshot_id == snapshot_id))
        await session.commit()
    # Cascade delete linked fallback RAG doc(s) + vectors/storage (no orphaned many docs)
    try:
        from app.api.routes import vector_store as _vs
        from app.services.storage import storage as _storage, build_key
        from fastapi.concurrency import run_in_threadpool
        linked = await repositories.list_documents_by_snapshot(identity.tenant_id, snapshot_id)
        for doc in linked:
            try:
                await run_in_threadpool(_vs.delete_by_document, doc.document_id, identity.tenant_id)
            except Exception:
                pass
            try:
                await _storage.delete(build_key(doc.document_id, doc.filename))
            except Exception:
                pass
            try:
                await repositories.delete_document_record(doc.document_id, identity.tenant_id)
            except Exception:
                pass
        if linked:
            from app.api.routes import _invalidate_document_selection
            _invalidate_document_selection(identity.tenant_id)
    except Exception:
        logger.warning("Failed to cascade delete RAG for snapshot %s", snapshot_id, exc_info=True)
    return {"status": "deleted"}

class SnapshotPatchRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    script: Optional[str] = Field(default=None, max_length=8000)
    voice_script: Optional[str] = Field(default=None, max_length=8000)
    chat_script: Optional[str] = Field(default=None, max_length=8000)
    greeting: Optional[str] = Field(default=None, max_length=500)

@router.patch("/agents/{snapshot_id}")
async def edit_snapshot(snapshot_id: str, body: SnapshotPatchRequest, identity: Identity = Depends(get_identity)):
    """Edit a past snapshot's prompt/name."""
    _require_workspace_owner(identity)
    from app.database import async_session
    from app.models.db_models import AgentSnapshotRecord
    from sqlalchemy import select
    async with async_session() as session:
        result = await session.execute(select(AgentSnapshotRecord).where(AgentSnapshotRecord.snapshot_id == snapshot_id, AgentSnapshotRecord.tenant_id == identity.tenant_id))
        snap = result.scalar_one_or_none()
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        if body.name is not None:
            snap.name = body.name.strip()[:120] or snap.name
        if body.script is not None:
            snap.script = body.script
        if body.voice_script is not None:
            snap.voice_script = body.voice_script
        if body.chat_script is not None:
            snap.chat_script = body.chat_script
        if body.greeting is not None:
            snap.greeting = body.greeting
        await session.commit()
        await session.refresh(snap)
        return {"snapshot_id": snap.snapshot_id, "name": snap.name}


@router.post("/agents/{snapshot_id}/duplicate")
async def duplicate_snapshot(snapshot_id: str, identity: Identity = Depends(get_identity)):
    """Duplicate/clone an existing agent snapshot."""
    _require_workspace_owner(identity)
    import uuid
    from app.database import async_session
    from app.models.db_models import AgentSnapshotRecord
    from sqlalchemy import select
    async with async_session() as session:
        result = await session.execute(
            select(AgentSnapshotRecord).where(
                AgentSnapshotRecord.snapshot_id == snapshot_id,
                AgentSnapshotRecord.tenant_id == identity.tenant_id
            )
        )
        snap = result.scalar_one_or_none()
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        
        new_id = uuid.uuid4().hex[:12]
        new_snap = AgentSnapshotRecord(
            snapshot_id=new_id,
            tenant_id=identity.tenant_id,
            name=f"{snap.name} (Copy)"[:120],
            script=snap.script,
            voice_script=snap.voice_script,
            chat_script=snap.chat_script,
            voice_id=snap.voice_id,
            language=snap.language,
            greeting=snap.greeting,
            source="duplicate",
            source_url=snap.source_url,
        )
        session.add(new_snap)
        await session.commit()
        await session.refresh(new_snap)
        return {
            "snapshot_id": new_snap.snapshot_id,
            "name": new_snap.name,
            "source": new_snap.source,
            "created_at": new_snap.created_at.isoformat() if new_snap.created_at else None,
        }



@router.get("/directory-handle")
async def get_directory_handle(identity: Identity = Depends(get_identity)):
    """This workspace's public directory handle, minted on first request."""
    _require_workspace_owner(identity)
    handle = await repositories.ensure_public_handle(identity.tenant_id)
    if handle is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return {"handle": handle}


@router.post("/directory-handle/rotate")
async def rotate_directory_handle(identity: Identity = Depends(get_identity)):
    """Issue a new public handle and invalidate the old one.

    The remedy when a business is being targeted through the directory: every
    copy of the old handle stops resolving immediately. Nothing else about the
    workspace changes — documents, contacts, and invite links the owner sent are
    all keyed on the tenant id, which is not what the directory publishes.
    """
    _require_workspace_owner(identity)
    handle = await repositories.rotate_public_handle(identity.tenant_id)
    if handle is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    logger.info("Directory handle rotated for %s", identity.tenant_id)
    return {"handle": handle}


@router.get("/usage")
async def get_usage(identity: Identity = Depends(get_identity)):
    """What this workspace has spent today, against its ceiling.

    Without this, abuse is invisible until a provider bill or a wall of 429s —
    neither of which tells an owner what happened or when it started.
    """
    _require_workspace_owner(identity)
    from app.services import usage

    return (await usage.usage_today(identity.tenant_id)).to_dict()
