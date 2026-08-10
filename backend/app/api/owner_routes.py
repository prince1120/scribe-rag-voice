"""Workspace and agent endpoints.

Thin by design: parse, delegate to `owner_service`, translate errors to status
codes. No business rules live here — if a decision is being made in this file,
it is in the wrong place.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.identity import Identity, get_identity
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
    body: ChooseModeRequest, identity: Identity = Depends(get_identity)
):
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
    return workspace.to_dict()


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
