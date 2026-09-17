"""Data-access helpers for Product QR entities (Milestone M1A).

Handles CRUD for products, linking documents to products, generating and
verifying hashed QR link tokens, and managing isolated visitor sessions.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from app.database import async_session
from app.models.db_models import (
    DocumentRecord,
    ProductDocumentRecord,
    ProductQrLinkRecord,
    ProductRecord,
    ProductSupportRequestRecord,
    ProductVisitorSessionRecord,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    """SHA-256 hex digest of plaintext token for secure database storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---- Products ---------------------------------------------------------------

async def create_product(
    tenant_id: str,
    name: str,
    model_number: str,
    category: Optional[str] = None,
    short_description: Optional[str] = None,
    support_disclaimer: Optional[str] = None,
    status: str = "active",
    is_active: Optional[bool] = None,
    description: Optional[str] = None,
) -> ProductRecord:
    product_id = str(uuid4())
    active_flag = (status == "active") if is_active is None else bool(is_active)
    status_val = status if status in ("draft", "active", "archived") else ("active" if active_flag else "archived")
    effective_desc = (short_description or description or "").strip() or None
    async with async_session() as session:
        product = ProductRecord(
            product_id=product_id,
            tenant_id=tenant_id,
            name=name.strip(),
            model_number=model_number.strip(),
            category=category.strip() if category else None,
            short_description=effective_desc,
            support_disclaimer=support_disclaimer.strip() if support_disclaimer else None,
            status=status_val,
            is_active=active_flag,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(product)
        await session.commit()
        await session.refresh(product)
        return product


async def get_product(
    product_id: str, tenant_id: Optional[str] = None
) -> Optional[ProductRecord]:
    async with async_session() as session:
        q = select(ProductRecord).where(ProductRecord.product_id == product_id)
        if tenant_id:
            q = q.where(ProductRecord.tenant_id == tenant_id)
        result = await session.execute(q)
        return result.scalar_one_or_none()


async def list_products(
    tenant_id: str, active_only: bool = False
) -> List[ProductRecord]:
    async with async_session() as session:
        q = select(ProductRecord).where(ProductRecord.tenant_id == tenant_id)
        if active_only:
            q = q.where(ProductRecord.status == "active")
        q = q.order_by(ProductRecord.created_at.desc())
        result = await session.execute(q)
        return list(result.scalars().all())


async def list_products_with_counts(
    tenant_id: str, active_only: bool = False
) -> List[Dict[str, Any]]:
    """Returns products along with assigned-document count and active-link count."""
    async with async_session() as session:
        q = select(ProductRecord).where(ProductRecord.tenant_id == tenant_id)
        if active_only:
            q = q.where(ProductRecord.status == "active")
        q = q.order_by(ProductRecord.created_at.desc())
        result = await session.execute(q)
        products = list(result.scalars().all())

        out = []
        for p in products:
            # Count assigned documents
            doc_count_res = await session.execute(
                select(func.count(ProductDocumentRecord.id)).where(
                    ProductDocumentRecord.product_id == p.product_id,
                    ProductDocumentRecord.tenant_id == tenant_id,
                )
            )
            doc_count = doc_count_res.scalar() or 0

            # Count active links
            link_count_res = await session.execute(
                select(func.count(ProductQrLinkRecord.id)).where(
                    ProductQrLinkRecord.product_id == p.product_id,
                    ProductQrLinkRecord.tenant_id == tenant_id,
                    ProductQrLinkRecord.active.is_(True),
                )
            )
            link_count = link_count_res.scalar() or 0

            out.append({
                "product": p,
                "assigned_documents_count": doc_count,
                "active_links_count": link_count,
            })
        return out


async def update_product(
    product_id: str, tenant_id: str, **fields
) -> Optional[ProductRecord]:
    allowed = {
        "name", "model_number", "category", "short_description",
        "description", "support_disclaimer", "status", "is_active",
    }
    updates = {}
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        if k == "description":
            updates["short_description"] = v
        elif k == "is_active":
            updates["is_active"] = bool(v)
            updates["status"] = "active" if v else "archived"
        elif k == "status":
            updates["status"] = v
            updates["is_active"] = (v == "active")
        else:
            updates[k] = v

    if not updates:
        return await get_product(product_id, tenant_id)

    updates["updated_at"] = _utcnow()
    async with async_session() as session:
        q = (
            update(ProductRecord)
            .where(
                ProductRecord.product_id == product_id,
                ProductRecord.tenant_id == tenant_id,
            )
            .values(**updates)
        )
        await session.execute(q)
        await session.commit()
    return await get_product(product_id, tenant_id)


async def delete_product(product_id: str, tenant_id: str) -> bool:
    async with async_session() as session:
        q = delete(ProductRecord).where(
            ProductRecord.product_id == product_id,
            ProductRecord.tenant_id == tenant_id,
        )
        result = await session.execute(q)
        await session.commit()
        return bool(result.rowcount > 0)


# ---- Product Documents ------------------------------------------------------

async def link_document_to_product(
    product_id: str, document_id: str, tenant_id: str
) -> Optional[ProductDocumentRecord]:
    """Links document to product. Returns None if already linked (reject duplicate)."""
    async with async_session() as session:
        # Check if already linked
        existing = await session.execute(
            select(ProductDocumentRecord).where(
                ProductDocumentRecord.product_id == product_id,
                ProductDocumentRecord.document_id == document_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            return None  # Duplicate rejected

        link = ProductDocumentRecord(
            product_id=product_id,
            document_id=document_id,
            tenant_id=tenant_id,
            created_at=_utcnow(),
        )
        session.add(link)
        await session.commit()
        await session.refresh(link)
        return link


async def unlink_document_from_product(
    product_id: str, document_id: str, tenant_id: str
) -> bool:
    async with async_session() as session:
        q = delete(ProductDocumentRecord).where(
            ProductDocumentRecord.product_id == product_id,
            ProductDocumentRecord.document_id == document_id,
            ProductDocumentRecord.tenant_id == tenant_id,
        )
        res = await session.execute(q)
        await session.commit()
        return bool(res.rowcount > 0)


async def list_product_documents(
    product_id: str, tenant_id: Optional[str] = None
) -> List[DocumentRecord]:
    """Returns the full DocumentRecord list linked to this product."""
    async with async_session() as session:
        q = (
            select(DocumentRecord)
            .join(
                ProductDocumentRecord,
                ProductDocumentRecord.document_id == DocumentRecord.document_id,
            )
            .where(ProductDocumentRecord.product_id == product_id)
        )
        if tenant_id:
            q = q.where(ProductDocumentRecord.tenant_id == tenant_id)
        q = q.order_by(DocumentRecord.created_at.desc())
        res = await session.execute(q)
        return list(res.scalars().all())


async def list_product_document_ids(
    product_id: str, tenant_id: Optional[str] = None
) -> List[str]:
    """Returns strictly the document_id strings assigned to this product."""
    async with async_session() as session:
        q = select(ProductDocumentRecord.document_id).where(
            ProductDocumentRecord.product_id == product_id
        )
        if tenant_id:
            q = q.where(ProductDocumentRecord.tenant_id == tenant_id)
        res = await session.execute(q)
        return list(res.scalars().all())


# ---- QR Links ---------------------------------------------------------------

async def create_qr_link(
    product_id: str,
    tenant_id: str,
    label: str = "Product Support QR",
    expires_in_days: Optional[int] = None,
    name: Optional[str] = None,
) -> Tuple[ProductQrLinkRecord, str]:
    """Mints a random plaintext token, saves its SHA-256 hash, and returns (record, token)."""
    raw_token = secrets.token_urlsafe(32)
    tok_hash = hash_token(raw_token)
    link_id = str(uuid4())
    effective_label = (label or name or "Product Support QR").strip()

    expires_at = None
    if expires_in_days and expires_in_days > 0:
        expires_at = _utcnow() + timedelta(days=expires_in_days)

    now = _utcnow()
    async with async_session() as session:
        record = ProductQrLinkRecord(
            link_id=link_id,
            tenant_id=tenant_id,
            product_id=product_id,
            label=effective_label,
            public_token_hash=tok_hash,
            active=True,
            expires_at=expires_at,
            scan_count=0,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return record, raw_token


async def get_qr_link_by_token(token: str) -> Optional[ProductQrLinkRecord]:
    tok_hash = hash_token(token)
    async with async_session() as session:
        q = select(ProductQrLinkRecord).where(
            ProductQrLinkRecord.public_token_hash == tok_hash
        )
        res = await session.execute(q)
        return res.scalar_one_or_none()


async def get_qr_link_by_id(
    link_id: str, tenant_id: Optional[str] = None
) -> Optional[ProductQrLinkRecord]:
    async with async_session() as session:
        q = select(ProductQrLinkRecord).where(ProductQrLinkRecord.link_id == link_id)
        if tenant_id:
            q = q.where(ProductQrLinkRecord.tenant_id == tenant_id)
        res = await session.execute(q)
        return res.scalar_one_or_none()


async def list_product_qr_links(
    product_id: str, tenant_id: Optional[str] = None
) -> List[ProductQrLinkRecord]:
    async with async_session() as session:
        q = select(ProductQrLinkRecord).where(
            ProductQrLinkRecord.product_id == product_id
        )
        if tenant_id:
            q = q.where(ProductQrLinkRecord.tenant_id == tenant_id)
        q = q.order_by(ProductQrLinkRecord.created_at.desc())
        res = await session.execute(q)
        return list(res.scalars().all())


async def revoke_qr_link(
    link_id: str, tenant_id: str
) -> Optional[ProductQrLinkRecord]:
    now = _utcnow()
    async with async_session() as session:
        q = (
            update(ProductQrLinkRecord)
            .where(
                ProductQrLinkRecord.link_id == link_id,
                ProductQrLinkRecord.tenant_id == tenant_id,
            )
            .values(active=False, revoked_at=now, updated_at=now)
        )
        await session.execute(q)
        await session.commit()
    return await get_qr_link_by_id(link_id, tenant_id)


async def increment_link_scans(link_id: str) -> None:
    async with async_session() as session:
        q = (
            update(ProductQrLinkRecord)
            .where(ProductQrLinkRecord.link_id == link_id)
            .values(scan_count=ProductQrLinkRecord.scan_count + 1)
        )
        await session.execute(q)
        await session.commit()


# ---- Visitor Sessions -------------------------------------------------------

async def create_visitor_session(
    tenant_id: str,
    product_id: str,
    link_id: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    session_token: Optional[str] = None,
    expires_in_days: int = 30,
) -> ProductVisitorSessionRecord:
    session_id = str(uuid4())
    conversation_id = str(uuid4())
    now = _utcnow()
    expires_at = now + timedelta(days=expires_in_days)
    tok_hash = hash_token(session_token) if session_token else hash_token(session_id)

    async with async_session() as session:
        sess = ProductVisitorSessionRecord(
            session_id=session_id,
            tenant_id=tenant_id,
            product_id=product_id,
            qr_link_id=link_id,
            session_token_hash=tok_hash,
            conversation_id=conversation_id,
            ip_address=ip_address,
            user_agent=user_agent,
            message_count=0,
            created_at=now,
            last_seen_at=now,
            expires_at=expires_at,
            revoked_at=None,
        )
        session.add(sess)
        await session.commit()
        await session.refresh(sess)
        return sess


async def get_visitor_session(
    session_id: str, tenant_id: Optional[str] = None
) -> Optional[ProductVisitorSessionRecord]:
    async with async_session() as session:
        q = select(ProductVisitorSessionRecord).where(
            ProductVisitorSessionRecord.session_id == session_id
        )
        if tenant_id:
            q = q.where(ProductVisitorSessionRecord.tenant_id == tenant_id)
        res = await session.execute(q)
        return res.scalar_one_or_none()


async def touch_visitor_session(session_id: str) -> None:
    async with async_session() as session:
        q = (
            update(ProductVisitorSessionRecord)
            .where(ProductVisitorSessionRecord.session_id == session_id)
            .values(
                last_seen_at=_utcnow(),
                message_count=ProductVisitorSessionRecord.message_count + 1,
            )
        )
        await session.execute(q)
        await session.commit()


# ---- Human Support Requests (M1B) -------------------------------------------

# Abuse ceiling: support requests per visitor session per day. Mirrors the
# contact-request cap pattern, stricter because product sessions are weaker
# identity than invite-link contacts.
SUPPORT_REQUESTS_PER_SESSION_PER_DAY = 5

SUPPORT_REQUEST_STATUSES = ("open", "contacted", "resolved")
SUPPORT_REQUEST_TRIGGERS = ("manual", "abstention", "safety")


async def create_support_request(
    *,
    tenant_id: str,
    product_id: str,
    session_id: str,
    request_id: str,
    name: str,
    reply_to: str,
    preferred_time: Optional[str],
    message: str,
    trigger: str,
) -> Tuple[ProductSupportRequestRecord, bool]:
    """File a human-support request. Idempotent on (request_id, session):
    a retry of the same submission returns the existing row. A UUID that
    belongs to another session (or tenant/product) reads as not found, so
    callers cannot probe for other visitors' requests.
    """
    async with async_session() as session:
        existing = await session.scalar(
            select(ProductSupportRequestRecord).where(
                ProductSupportRequestRecord.request_id == request_id
            )
        )
        if existing is not None:
            if (
                existing.tenant_id != tenant_id
                or existing.product_id != product_id
                or existing.session_id != session_id
            ):
                raise LookupError("Request not found")
            return existing, False
        count = await session.scalar(
            select(func.count())
            .select_from(ProductSupportRequestRecord)
            .where(
                ProductSupportRequestRecord.session_id == session_id,
                ProductSupportRequestRecord.created_at >= _utcnow() - timedelta(days=1),
            )
        )
        if (count or 0) >= SUPPORT_REQUESTS_PER_SESSION_PER_DAY:
            raise ValueError(
                "This session has filed several support requests today. "
                "Please wait for the brand to respond."
            )
        record = ProductSupportRequestRecord(
            request_id=request_id,
            tenant_id=tenant_id,
            product_id=product_id,
            session_id=session_id,
            name=name.strip(),
            reply_to=reply_to.strip(),
            preferred_time=(preferred_time or "").strip() or None,
            message=message.strip(),
            trigger=trigger,
            consent=True,
            status="open",
            owner_note="",
        )
        session.add(record)
        try:
            await session.commit()
        except IntegrityError:
            # Two network retries can pass the initial lookup together. The
            # unique request_id constraint chooses one winner; resolve the
            # loser as the same idempotent request without exposing a UUID
            # owned by another visitor session.
            await session.rollback()
            existing = await session.scalar(
                select(ProductSupportRequestRecord).where(
                    ProductSupportRequestRecord.request_id == request_id
                )
            )
            if existing is None or (
                existing.tenant_id != tenant_id
                or existing.product_id != product_id
                or existing.session_id != session_id
            ):
                raise LookupError("Request not found")
            return existing, False
        await session.refresh(record)
        return record, True


async def list_support_requests(
    tenant_id: str,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[list, int]:
    async with async_session() as session:
        q = select(ProductSupportRequestRecord).where(
            ProductSupportRequestRecord.tenant_id == tenant_id
        )
        if status:
            q = q.where(ProductSupportRequestRecord.status == status)
        total = await session.scalar(
            select(func.count()).select_from(q.subquery())
        )
        rows = await session.execute(
            q.order_by(ProductSupportRequestRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(rows.scalars().all()), int(total or 0)


async def update_support_request(
    tenant_id: str,
    request_id: str,
    status: str,
    owner_note: str = "",
) -> ProductSupportRequestRecord:
    async with async_session() as session:
        record = await session.scalar(
            select(ProductSupportRequestRecord).where(
                ProductSupportRequestRecord.request_id == request_id,
                ProductSupportRequestRecord.tenant_id == tenant_id,
            )
        )
        if record is None:
            raise LookupError("Request not found")
        record.status = status
        record.owner_note = (owner_note or "").strip()
        record.updated_at = _utcnow()
        await session.commit()
        await session.refresh(record)
        return record
