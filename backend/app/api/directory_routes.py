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

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import contacts, repositories
from app.config import settings
from app.rate_limit import client_ip, limiter
from app.services import usage

logger = logging.getLogger(__name__)
router = APIRouter()

# Marks a contact as created by the public directory. Only rows carrying this
# are eligible for token reuse below — a contact the owner created by hand, or
# one from a different directory visitor, must never be reachable by guessing a
# name.
DIRECTORY_SOURCE = "directory"


class ConnectRequest(BaseModel):
    # The opaque public handle from /agents, not a tenant id. The tenant id is
    # the key every other table joins on and is no longer published.
    handle: str = Field(min_length=8, max_length=32)
    name: Optional[str] = Field(default=None, max_length=100)
    mode: str = Field(default="voice", pattern="^(voice|chat|both)$")


# Limits for a caller who arrived from the public directory.
#
# Deliberately far tighter than an invite link the owner sent to someone they
# know. A directory visitor is an unauthenticated stranger whose calls are
# billed to the owner's own provider keys, so the defaults answer "how much is
# an owner willing to spend on a person who just walked up" rather than "how
# much would a customer plausibly use".
#
# The per-contact cap is not a budget on its own — /connect can mint contacts —
# so this bounds a single link, not the total. A per-workspace daily budget is
# the thing that bounds the total, and is tracked separately.
# Values live in settings so they are tunable without a deploy.


# The listing changes only when an owner deploys, undeploys, or edits their
# agent — minutes-scale at best — while the endpoint is unauthenticated and
# therefore trivially hammerable. Served from a short cache so a flood costs one
# query per minute rather than one per request.
_LISTING_TTL_S = 60.0


@router.get("/agents")
@limiter.limit("30/minute")
async def list_public_agents(request: Request, response: Response):
    """Deployed business assistants, for public discovery.

    Publishes an opaque `handle` per business, never the tenant id.
    """
    from app.services import cache

    agents = await cache.config_cache.get_or_load(
        ("directory-listing",),
        repositories.list_deployed_agents,
        ttl=_LISTING_TTL_S,
    )
    # Lets a CDN or the browser absorb repeat views as well. Short, because a
    # newly deployed assistant appearing a minute late is fine and an undeployed
    # one still listed for an hour is not.
    response.headers["Cache-Control"] = "public, max-age=60"
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
    # Resolved from the handle. A rotated handle stops resolving here, which is
    # what makes rotation an actual remedy rather than cosmetic.
    owner = await repositories.get_owner_by_handle(body.handle)
    if owner is None:
        raise HTTPException(
            status_code=404,
            detail="This assistant is no longer available.",
        )

    agent = await repositories.get_agent(owner.tenant_id)
    if agent is None or agent.status != "deployed":
        raise HTTPException(
            status_code=404,
            detail="This assistant is not currently available or deployed.",
        )

    # Cross-tenant velocity. Every other limit in this app is scoped to one
    # workspace, so a caller working through the directory looks unremarkable to
    # each owner individually while the aggregate is plainly an attack. This is
    # the only check that sees the pattern.
    if settings.DIRECTORY_VELOCITY_MAX_BUSINESSES > 0:
        reached = await usage.distinct_businesses_contacted(
            device_id=None,
            ip_address=client_ip(request),
            minutes=settings.DIRECTORY_VELOCITY_WINDOW_MIN,
        )
        if reached >= settings.DIRECTORY_VELOCITY_MAX_BUSINESSES:
            logger.warning(
                "Directory velocity limit: %s reached %d businesses in %d min",
                client_ip(request), reached, settings.DIRECTORY_VELOCITY_WINDOW_MIN,
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    "You've connected to a lot of assistants in a short time. "
                    "Please wait a few minutes and try again."
                ),
            )

    caller_name = (body.name or "").strip() or "Guest Caller"
    token = contacts.generate_token()

    await repositories.create_contact(
        contact_id=str(uuid4()),
        owner_tenant_id=owner.tenant_id,
        name=caller_name,
        note=f"Connected via Public Directory ({body.mode})",
        token_hash=contacts.hash_token(token),
        pin=None,
        expires_at=contacts.default_expiry(settings.DIRECTORY_LINK_TTL_DAYS),
        max_sessions_per_day=settings.DIRECTORY_SESSIONS_PER_DAY,
        mode=body.mode,
        source=DIRECTORY_SOURCE,
    )
    logger.info(
        "Directory connect: new guest contact for tenant %s (mode=%s)",
        owner.tenant_id, body.mode,
    )

    return {
        "token": token,
        "redirect_url": f"/t/{token}",
        "business_name": owner.business_name or "Business",
        "agent_name": agent.name or "Assistant",
        "mode": body.mode,
    }
