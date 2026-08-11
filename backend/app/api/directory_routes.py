"""Public directory routes: discover deployed business assistants and connect directly."""
import logging
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import contacts, repositories

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectRequest(BaseModel):
    owner_tenant_id: str = Field(min_length=1, max_length=120)
    name: Optional[str] = Field(default=None, max_length=100)
    mode: str = Field(default="voice", pattern="^(voice|chat|both)$")


@router.get("/agents")
async def list_public_agents():
    """List all deployed business agents for public discovery."""
    agents = await repositories.list_deployed_agents()
    return {"agents": agents}


@router.post("/connect")
async def connect_to_agent(body: ConnectRequest):
    """Generate a guest contact session to connect a visitor directly to a deployed agent."""
    agent = await repositories.get_agent(body.owner_tenant_id)
    if agent is None or agent.status != "deployed":
        raise HTTPException(
            status_code=404,
            detail="This assistant is not currently available or deployed.",
        )

    owner = await repositories.get_owner(body.owner_tenant_id)
    if owner is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found.",
        )

    caller_name = (body.name or "").strip() or "Guest Caller"
    token = contacts.generate_token()

    # Check if this caller already has an active contact for this specific agent
    existing_contact = await repositories.get_active_contact_by_name(
        owner_tenant_id=body.owner_tenant_id,
        name=caller_name,
    )

    if existing_contact:
        # Re-issue active token for existing contact so all history stays unified
        await repositories.rotate_contact_token(
            contact_id=existing_contact.contact_id,
            owner_tenant_id=body.owner_tenant_id,
            token_hash=contacts.hash_token(token),
        )
    else:
        # First time caller for this agent — create dedicated contact
        contact_id = str(uuid4())
        await repositories.create_contact(
            contact_id=contact_id,
            owner_tenant_id=body.owner_tenant_id,
            name=caller_name,
            note=f"Connected via Public Directory ({body.mode})",
            token_hash=contacts.hash_token(token),
            pin=None,
            expires_at=contacts.default_expiry(7),  # 7 day default for directory guest links
            max_sessions_per_day=50,
            mode=body.mode,
        )

    return {
        "token": token,
        "redirect_url": f"/t/{token}",
        "business_name": owner.business_name or "Business",
        "agent_name": agent.name or "Assistant",
        "mode": body.mode,
    }
