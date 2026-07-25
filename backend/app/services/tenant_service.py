import hashlib
from typing import Optional
from fastapi import Header, HTTPException, Query


class TenantContext:
    """Encapsulates authenticated tenant context and user API keys for a request.
    
    Adheres to SOLID principles by decoupling tenant resolution & isolation logic
    from API router endpoints.
    """

    def __init__(
        self,
        tenant_id: str,
        groq_api_key: Optional[str] = None,
        sarvam_api_key: Optional[str] = None,
        client_id: Optional[str] = None,
    ):
        self.tenant_id = tenant_id
        self.groq_api_key = groq_api_key
        self.sarvam_api_key = sarvam_api_key
        self.client_id = client_id

    def __repr__(self) -> str:
        return f"<TenantContext tenant_id={self.tenant_id} client_id={self.client_id}>"


def derive_tenant_id(
    groq_key: Optional[str] = None,
    sarvam_key: Optional[str] = None,
    client_id: Optional[str] = None,
    fallback_tenant_id: str = "default",
) -> str:
    """Derive a stable, isolated cryptographic tenant ID from user keys and client ID.

    Combines Groq Key, Sarvam Key, and Client UUID using SHA-256 to ensure
    100% cryptographic isolation between different users and browser sessions.
    """
    g = (groq_key or "").strip()
    s = (sarvam_key or "").strip()
    c = (client_id or "").strip()

    if not g and not s and not c:
        return fallback_tenant_id

    payload = f"groq:{g}|sarvam:{s}|client:{c}"
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]
    return f"tenant-{digest}"


def resolve_tenant_context(
    tenant_id: str = "default",
    x_user_groq_key: Optional[str] = None,
    x_user_sarvam_key: Optional[str] = None,
    x_client_id: Optional[str] = None,
    require_keys: bool = False,
) -> TenantContext:
    """Resolve TenantContext from headers or explicit arguments.

    If require_keys is True and session headers are provided, validates that
    both Groq and Sarvam API keys are provided.
    """
    g_key = (x_user_groq_key or "").strip()
    s_key = (x_user_sarvam_key or "").strip()
    c_id = (x_client_id or "").strip()

    if require_keys:
        if not g_key:
            raise HTTPException(status_code=400, detail="Groq API Key is required (X-User-Groq-Key header missing).")
        if not s_key:
            raise HTTPException(status_code=400, detail="Sarvam API Key is required (X-User-Sarvam-Key header missing).")

    if g_key or s_key or c_id:
        effective_id = derive_tenant_id(g_key, s_key, c_id, fallback_tenant_id=tenant_id)
    else:
        effective_id = tenant_id

    return TenantContext(
        tenant_id=effective_id,
        groq_api_key=g_key or None,
        sarvam_api_key=s_key or None,
        client_id=c_id or None,
    )


def get_tenant_context(
    tenant_id: str = Query(default="default"),
    x_user_groq_key: Optional[str] = Header(default=None, alias="X-User-Groq-Key"),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
    x_client_id: Optional[str] = Header(default=None, alias="X-Client-Id"),
) -> TenantContext:
    """FastAPI Dependency for endpoints requiring tenant resolution."""
    return resolve_tenant_context(
        tenant_id=tenant_id,
        x_user_groq_key=x_user_groq_key,
        x_user_sarvam_key=x_user_sarvam_key,
        x_client_id=x_client_id,
        require_keys=False,
    )
