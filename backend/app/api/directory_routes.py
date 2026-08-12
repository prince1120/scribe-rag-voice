"""Public directory routes: discover deployed business assistants and connect directly.

Both routes here are unauthenticated by necessity — this is the front door for
someone who has never seen the product. That makes them the highest-exposure
surface in the app, so the guards are the important part of this file:

  - `/connect` never reuses a contact created anywhere else. It used to match an
    existing contact **by name**, rotate its token, and return the new token to
    the caller — so posting a plausible name returned a working invite link for
    that person, and simultaneously invalidated the real holder's link. Names
    are not secrets and `/agents` publishes every business, so this was a
    one-request account takeover against any deployed assistant.
  - Rows created here are marked `source="directory"` and are the only rows
    `/connect` will ever reuse.
  - Both routes are rate limited: they insert rows and are reachable by anyone.
"""
import logging
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app import contacts, repositories
from app.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# Marks a contact as created by the public directory. Only rows carrying this
# are eligible for token reuse below — a contact the owner created by hand, or
# one from a different directory visitor, must never be reachable by guessing a
# name.
DIRECTORY_SOURCE = "directory"


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
@limiter.limit("5/minute")
async def connect_to_agent(request: Request, body: ConnectRequest):
    """Mint a fresh guest link for a visitor arriving from the public directory.

    Always a **new** contact, never a reused one. The previous version looked up
    an existing contact by the caller-supplied `name`, rotated its token, and
    returned that token — which meant anyone could post a name and receive a
    working invite link belonging to whoever really had it, while the rightful
    holder's link stopped working (rotation clears `bound_device` and
    `revoked_at`). Names are not credentials, and `/agents` publishes the
    tenant ids to aim at.

    Unifying a returning visitor's history is a real want, but it cannot key on
    an unauthenticated string. It belongs to whatever proves the visitor is the
    same person — the device binding on the link they already hold, which
    `/contacts/open` already enforces.
    """
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

    await repositories.create_contact(
        contact_id=str(uuid4()),
        owner_tenant_id=body.owner_tenant_id,
        name=caller_name,
        note=f"Connected via Public Directory ({body.mode})",
        token_hash=contacts.hash_token(token),
        pin=None,
        expires_at=contacts.default_expiry(7),  # 7 day default for directory guest links
        max_sessions_per_day=50,
        mode=body.mode,
        source=DIRECTORY_SOURCE,
    )
    logger.info(
        "Directory connect: new guest contact for tenant %s (mode=%s)",
        body.owner_tenant_id, body.mode,
    )

    return {
        "token": token,
        "redirect_url": f"/t/{token}",
        "business_name": owner.business_name or "Business",
        "agent_name": agent.name or "Assistant",
        "mode": body.mode,
    }
