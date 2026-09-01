"""Calendar: services, availability, bookings, reports, and notifications — all in-app.
Owner sets slots; AI and owner manage live bookings with collision prevention.
"""
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.identity import Identity, get_identity
from app.api.contact_routes import _require_owner
from app.services import calendar_service as cal
from app.services.notification_service import list_notifications, mark_read

router = APIRouter()


class AvailabilityBody(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    is_closed: bool = False


class ServiceBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    duration_mins: int = Field(ge=10, le=180)
    active: bool = True


class BookingBody(BaseModel):
    service_id: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    title: Optional[str] = Field(default=None, max_length=200)
    contact_id: Optional[str] = None


class RescheduleBody(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")


class CancelBody(BaseModel):
    reason: Optional[str] = Field(default="", max_length=250)


# ---- Services --------------------------------------------------------------

@router.get("/services")
async def get_services(identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    await cal.ensure_defaults(identity.tenant_id, None)
    return await cal.list_services(identity.tenant_id)


@router.post("/services")
async def create_service(body: ServiceBody, identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    from app.database import async_session
    from app.models.db_models import ServiceRecord
    from uuid import uuid4
    from sqlalchemy import select, func
    async with async_session() as s:
        cnt = await s.execute(
            select(func.count()).select_from(ServiceRecord).where(
                ServiceRecord.tenant_id == identity.tenant_id,
                ServiceRecord.active.is_(True)
            )
        )
        if (cnt.scalar() or 0) >= 12:
            raise HTTPException(status_code=400, detail="Max 12 services allowed per workspace")
        rec = ServiceRecord(
            service_id=uuid4().hex[:12],
            tenant_id=identity.tenant_id,
            name=body.name.strip(),
            duration_mins=body.duration_mins,
            active=body.active,
        )
        s.add(rec)
        await s.commit()
        await s.refresh(rec)
        return {"service_id": rec.service_id, "name": rec.name, "duration_mins": rec.duration_mins}


# ---- Availability ----------------------------------------------------------

@router.get("/availability")
async def get_availability(identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    from app.database import async_session
    from app.models.db_models import AvailabilityRecord
    from sqlalchemy import select
    async with async_session() as s:
        r = await s.execute(
            select(AvailabilityRecord).where(AvailabilityRecord.tenant_id == identity.tenant_id).order_by(AvailabilityRecord.weekday)
        )
        rows = list(r.scalars().all())
        if not rows:
            await cal.ensure_defaults(identity.tenant_id, None)
            r = await s.execute(
                select(AvailabilityRecord).where(AvailabilityRecord.tenant_id == identity.tenant_id).order_by(AvailabilityRecord.weekday)
            )
            rows = list(r.scalars().all())
        return [{"weekday": x.weekday, "start_time": x.start_time, "end_time": x.end_time, "is_closed": x.is_closed} for x in rows]


@router.put("/availability")
async def put_availability(body: list[AvailabilityBody], identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    from app.database import async_session
    from app.models.db_models import AvailabilityRecord
    from sqlalchemy import delete
    async with async_session() as s:
        await s.execute(delete(AvailabilityRecord).where(AvailabilityRecord.tenant_id == identity.tenant_id))
        for b in body[:7]:
            s.add(AvailabilityRecord(tenant_id=identity.tenant_id, weekday=b.weekday, start_time=b.start_time, end_time=b.end_time, is_closed=b.is_closed))
        await s.commit()
    return {"ok": True}


@router.get("/slots")
async def get_slots(service_id: str, date: str, identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    return {"slots": await cal.free_slots(identity.tenant_id, service_id, date)}


# ---- Bookings --------------------------------------------------------------

@router.get("/bookings")
async def list_bookings(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    status: Optional[str] = None,
    identity: Identity = Depends(get_identity)
):
    _require_owner(identity)
    bookings = await cal.list_bookings(identity.tenant_id, from_date=from_date, to_date=to_date, status=status)
    return [
        {
            "booking_id": b.booking_id,
            "title": b.title,
            "service_id": b.service_id,
            "contact_id": b.contact_id,
            "start_ts": b.start_ts.isoformat() if b.start_ts else None,
            "end_ts": b.end_ts.isoformat() if b.end_ts else None,
            "status": b.status,
            "source": b.source,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in bookings
    ]


@router.post("/bookings")
async def create_booking(body: BookingBody, identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    try:
        dt = datetime.fromisoformat(f"{body.date}T{body.time}:00").replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date/time format. Use YYYY-MM-DD and HH:MM.")
    try:
        rec = await cal.create_booking(
            tenant_id=identity.tenant_id,
            service_id_or_name=body.service_id,
            start_ts=dt,
            title=body.title or "Direct Booking",
            contact_id=body.contact_id,
            source="manual",
        )
        return {
            "booking_id": rec.booking_id,
            "title": rec.title,
            "start_ts": rec.start_ts.isoformat(),
            "status": rec.status,
        }
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/bookings/{booking_id}/reschedule")
async def reschedule_booking_endpoint(
    booking_id: str,
    body: RescheduleBody,
    identity: Identity = Depends(get_identity)
):
    _require_owner(identity)
    try:
        rec = await cal.reschedule_booking(
            tenant_id=identity.tenant_id,
            booking_id=booking_id,
            new_date_str=body.date,
            new_time_str=body.time,
        )
        return {
            "booking_id": rec.booking_id,
            "title": rec.title,
            "start_ts": rec.start_ts.isoformat(),
            "status": rec.status,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking_endpoint(
    booking_id: str,
    body: Optional[CancelBody] = None,
    identity: Identity = Depends(get_identity)
):
    _require_owner(identity)
    try:
        reason = body.reason if body else ""
        rec = await cal.cancel_booking(
            tenant_id=identity.tenant_id,
            booking_id=booking_id,
            reason=reason,
        )
        return {
            "booking_id": rec.booking_id,
            "title": rec.title,
            "status": rec.status,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---- Reports & Analytics ---------------------------------------------------

@router.get("/reports")
async def get_reports(identity: Identity = Depends(get_identity)):
    """Summary metrics of bookings, cancellations, and service performance."""
    _require_owner(identity)
    return await cal.get_calendar_reports_summary(identity.tenant_id)


# ---- Notifications ---------------------------------------------------------

@router.get("/notifications")
async def get_notifications(identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    rows = await list_notifications(identity.tenant_id)
    return [
        {
            "notification_id": r.notification_id,
            "type": r.type,
            "title": r.title,
            "body": r.body,
            "link_id": r.link_id,
            "read": r.read,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/notifications/{nid}/read")
async def read_notif(nid: str, identity: Identity = Depends(get_identity)):
    _require_owner(identity)
    await mark_read(identity.tenant_id, nid)
    return {"ok": True}
