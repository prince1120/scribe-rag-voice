"""Owner product management endpoints for Product QR (Milestone M1A).

Gated by settings.PRODUCT_QR_ENABLED and owner identity.
Allows brand owners to register hardware products, associate uploaded manuals,
and generate or revoke public QR links.
"""
import logging
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.config import settings
from app.identity import Identity, get_identity
from app.repositories import product_qr as repo
from app.repositories import get_document_record

logger = logging.getLogger(__name__)

def _check_feature_enabled() -> None:
    if not settings.PRODUCT_QR_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product QR capability is currently disabled.",
        )


router = APIRouter(
    prefix="/api/v1/product-qr",
    tags=["Product QR Owner"],
    dependencies=[Depends(_check_feature_enabled)],
)


def _require_owner(identity: Identity) -> None:
    if not identity.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the signed-in business owner can manage products.",
        )


# ---- Schemas ----------------------------------------------------------------

class CreateProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    model_number: str = Field(min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=64)
    short_description: Optional[str] = Field(default=None, max_length=2000)
    description: Optional[str] = Field(default=None, max_length=2000)
    support_disclaimer: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = Field(default="active", pattern="^(draft|active|archived)$")


class UpdateProductRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    model_number: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=64)
    short_description: Optional[str] = Field(default=None, max_length=2000)
    description: Optional[str] = Field(default=None, max_length=2000)
    support_disclaimer: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = Field(default=None, pattern="^(draft|active|archived)$")
    is_active: Optional[bool] = None


class LinkDocumentRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=36)


class CreateQrLinkRequest(BaseModel):
    label: Optional[str] = Field(default=None, max_length=200)
    name: Optional[str] = Field(default=None, max_length=200)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=365)


def _product_out(p) -> Dict[str, Any]:
    return {
        "product_id": p.product_id,
        "name": p.name,
        "model_number": p.model_number,
        "category": p.category,
        "short_description": p.short_description,
        "description": p.short_description,
        "support_disclaimer": p.support_disclaimer,
        "status": p.status,
        "is_active": p.is_active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _link_out(link, token: Optional[str] = None) -> Dict[str, Any]:
    # Strictly omits token_hash and public_token_hash
    data = {
        "link_id": link.link_id,
        "product_id": link.product_id,
        "label": link.label or "Product Support QR",
        "name": link.label or "Product Support QR",
        "is_active": link.is_active,
        "active": link.is_active,
        "scan_count": link.scan_count,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }
    if token:
        data["token"] = token
        data["url"] = f"/p/{token}"
    return data


# ---- Product Endpoints ------------------------------------------------------

@router.post("/products")
async def create_product(
    body: CreateProductRequest,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    desc = body.short_description or body.description
    product = await repo.create_product(
        tenant_id=identity.tenant_id,
        name=body.name,
        model_number=body.model_number,
        category=body.category,
        short_description=desc,
        support_disclaimer=body.support_disclaimer,
        status=body.status or "active",
    )
    return {"product": _product_out(product)}


@router.get("/products")
async def list_products(
    active_only: bool = False,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    items = await repo.list_products_with_counts(
        tenant_id=identity.tenant_id, active_only=active_only
    )
    return {
        "products": [
            {
                **_product_out(item["product"]),
                "assigned_documents_count": item["assigned_documents_count"],
                "active_links_count": item["active_links_count"],
            }
            for item in items
        ]
    }


@router.get("/products/{product_id}")
async def get_product_details(
    product_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    docs = await repo.list_product_documents(product_id, tenant_id=identity.tenant_id)
    links = await repo.list_product_qr_links(product_id, tenant_id=identity.tenant_id)

    return {
        "product": _product_out(product),
        "documents": [
            {
                "document_id": d.document_id,
                "filename": d.filename,
                "file_size": d.file_size,
                "chunk_count": d.chunk_count,
                "status": d.status,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in docs
        ],
        "links": [_link_out(l) for l in links],
    }


@router.patch("/products/{product_id}")
async def update_product(
    product_id: str,
    body: UpdateProductRequest,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    existing = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")

    updates = body.model_dump(exclude_unset=True)
    if "description" in updates and "short_description" not in updates:
        updates["short_description"] = updates.pop("description")

    updated = await repo.update_product(
        product_id=product_id,
        tenant_id=identity.tenant_id,
        **updates,
    )
    return {"product": _product_out(updated)}


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    existing = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")

    ok = await repo.delete_product(product_id, tenant_id=identity.tenant_id)
    return {"success": ok}


# ---- Document Linking Endpoints ---------------------------------------------

@router.post("/products/{product_id}/documents")
async def link_document(
    product_id: str,
    body: LinkDocumentRequest,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Document must belong to the same tenant
    doc = await get_document_record(body.document_id, identity.tenant_id)
    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found in workspace",
        )

    link = await repo.link_document_to_product(
        product_id=product_id,
        document_id=body.document_id,
        tenant_id=identity.tenant_id,
    )
    if not link:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document is already assigned to this product.",
        )

    return {
        "success": True,
        "product_id": link.product_id,
        "document_id": link.document_id,
    }


@router.delete("/products/{product_id}/documents/{document_id}")
async def unlink_document(
    product_id: str,
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    ok = await repo.unlink_document_from_product(
        product_id=product_id,
        document_id=document_id,
        tenant_id=identity.tenant_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Document link not found")
    return {"success": ok}


@router.get("/products/{product_id}/documents")
async def list_product_documents(
    product_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    docs = await repo.list_product_documents(product_id, tenant_id=identity.tenant_id)
    return {
        "documents": [
            {
                "document_id": d.document_id,
                "filename": d.filename,
                "file_size": d.file_size,
                "chunk_count": d.chunk_count,
                "status": d.status,
            }
            for d in docs
        ]
    }


# ---- QR Link Generation Endpoints -------------------------------------------

@router.post("/products/{product_id}/links")
async def create_product_qr_link(
    product_id: str,
    body: CreateQrLinkRequest,
    identity: Identity = Depends(get_identity),
):
    """Generates a shareable QR access link for the product.
    
    The plaintext token is returned only here. It is stored as a SHA-256 hash.
    """
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    link_label = body.label or body.name or "Product Support QR"
    link, token = await repo.create_qr_link(
        product_id=product_id,
        tenant_id=identity.tenant_id,
        label=link_label,
        expires_in_days=body.expires_in_days,
    )
    return {"link": _link_out(link, token=token)}


@router.get("/products/{product_id}/links")
async def list_product_qr_links(
    product_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    product = await repo.get_product(product_id, tenant_id=identity.tenant_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    links = await repo.list_product_qr_links(product_id, tenant_id=identity.tenant_id)
    return {"links": [_link_out(l) for l in links]}


@router.post("/links/{link_id}/revoke")
async def revoke_qr_link(
    link_id: str,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    revoked = await repo.revoke_qr_link(link_id, tenant_id=identity.tenant_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"success": True, "link": _link_out(revoked)}


# ---- Human Support Request Triage (M1B) --------------------------------------

class UpdateSupportRequestBody(BaseModel):
    status: Literal["open", "contacted", "resolved"]
    owner_note: str = Field(default="", max_length=2000)


def _support_request_out(record, product_name: str = "") -> Dict[str, Any]:
    return {
        "request_id": record.request_id,
        "product_id": record.product_id,
        "product_name": product_name,
        "session_id": record.session_id,
        "name": record.name,
        "customer_name": record.name,
        "reply_to": record.reply_to,
        "preferred_time": record.preferred_time,
        "message": record.message,
        "trigger": record.trigger,
        "status": record.status,
        "owner_note": record.owner_note,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.get("/service-requests")
async def list_service_requests(
    status: Literal["open", "contacted", "resolved"] | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    rows, total = await repo.list_support_requests(
        identity.tenant_id, status=status, limit=limit, offset=offset
    )
    products = await repo.list_products(identity.tenant_id)
    product_names = {p.product_id: p.name for p in products}
    return {
        "items": [
            _support_request_out(r, product_names.get(r.product_id, "Unknown product"))
            for r in rows
        ],
        "total": total,
    }


@router.patch("/service-requests/{request_id}")
async def update_service_request(
    request_id: UUID,
    body: UpdateSupportRequestBody,
    identity: Identity = Depends(get_identity),
):
    _check_feature_enabled()
    _require_owner(identity)
    try:
        record = await repo.update_support_request(
            identity.tenant_id, str(request_id), body.status, body.owner_note
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Request not found")
    return _support_request_out(record)
