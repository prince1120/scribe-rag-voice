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
    script: Optional[str] = Field(default=None, max_length=8000)
    voice_id: Optional[str] = Field(default=None, max_length=64)
    rag_enabled: Optional[bool] = None
    greeting: Optional[str] = Field(default=None, max_length=500)


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
        "mode": record.mode,
        "business_name": record.business_name,
        "is_business": record.mode == owner_service.BUSINESS,
    }


@router.post("/logout")
async def logout(response: Response):
    """Clear the session. Flags must match the ones it was set with, or the
    browser keeps the original cookie."""
    params = cookie_params()
    response.delete_cookie(
        key=params["key"], path=params["path"], samesite=params["samesite"],
        secure=params["secure"], httponly=params["httponly"],
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
            rag_enabled=body.rag_enabled,
            greeting=body.greeting,
            # The allowed set is owned by the voice config, not duplicated here,
            # so adding a voice in one place is enough.
            allowed_voices=SUPPORTED_TTS_VOICE_IDS,
        )
    except owner_service.OwnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
