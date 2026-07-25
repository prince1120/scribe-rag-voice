"""Passcode login — the boundary that turns an anonymous visitor into the owner.

This is the only endpoint that can mint an owner session, which makes it the
one worth rate limiting hardest: without a limit, a 6-character passcode falls
to brute force in minutes.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.config import settings
from app.identity import Identity, get_identity
from app.rate_limit import limiter
from app.session import COOKIE_NAME, check_passcode, cookie_params, issue

logger = logging.getLogger(__name__)

router = APIRouter()


class LoginRequest(BaseModel):
    passcode: str = Field(min_length=1, max_length=256)


class SessionStatus(BaseModel):
    authenticated: bool
    is_owner: bool
    # Lets the frontend skip the passcode screen entirely in local development,
    # instead of showing a prompt that no passcode can satisfy.
    gate_enabled: bool


@router.get("", response_model=SessionStatus)
async def read_session(identity: Identity = Depends(get_identity)) -> SessionStatus:
    return SessionStatus(
        authenticated=True,
        is_owner=identity.is_owner,
        gate_enabled=bool(settings.APP_ACCESS_PASSCODE),
    )


@router.post("/login", response_model=SessionStatus)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, response: Response) -> SessionStatus:
    if not check_passcode(body.passcode):
        # Logged without the attempted value — passcode guesses in logs are a
        # liability, and near-misses reveal the real one.
        logger.warning("Rejected login attempt")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect passcode"
        )

    response.set_cookie(
        value=issue("owner"),
        max_age=settings.SESSION_TTL_DAYS * 86400,
        **cookie_params(),
    )
    logger.info("Owner session issued")
    return SessionStatus(authenticated=True, is_owner=True, gate_enabled=True)


@router.post("/logout")
async def logout(response: Response) -> dict:
    params = cookie_params()
    response.delete_cookie(
        key=params.pop("key"), path=params["path"], samesite=params["samesite"]
    )
    return {"status": "logged_out"}


# Unauthenticated on purpose: the frontend calls this before it has a session,
# to decide whether to render the passcode screen at all. It exposes only
# whether the gate is on, never the passcode.
@router.get("/config")
async def session_config() -> dict:
    return {"gate_enabled": bool(settings.APP_ACCESS_PASSCODE)}
