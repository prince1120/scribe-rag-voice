"""Calendar: per-service slots, availability, free-check, reschedule, cancellation, and reporting.

Modular, in-app only. Owner sets weekly hours once; services inherit.
Free slots = expand Availability into slots of service.duration_mins minus overlapping Bookings + Holidays.
Real-time notification and collision prevention on every action.
"""
from datetime import date as _date, datetime, timedelta, timezone
import logging
from hashlib import sha256
from zoneinfo import ZoneInfo
from typing import Dict, List, Optional
from uuid import uuid4

from sqlalchemy import delete, func, select, update

from app.database import async_session
from app.models.db_models import AvailabilityRecord, BookingRecord, HolidayRecord, ServiceRecord, CalendarSettingsRecord, ContactRecord
from app.repositories.business import transaction_lock
from app.services.notification_service import notify

logger = logging.getLogger(__name__)


async def business_timezone(tenant_id: str) -> ZoneInfo:
    async with async_session() as session:
        settings = await session.get(CalendarSettingsRecord, tenant_id)
        return ZoneInfo(settings.timezone_name if settings else "UTC")


def as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def local_booking_time(tenant_id, date_str, time_str):
    zone = await business_timezone(tenant_id)
    try:
        naive = datetime.fromisoformat(f"{date_str}T{time_str}:00")
        local = naive.replace(tzinfo=zone)
        if local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
            raise ValueError("This local time does not exist due to a clock change")
        if local.utcoffset() != local.replace(fold=1).utcoffset():
            raise ValueError("This local time is ambiguous due to a clock change; choose another slot")
        return local.astimezone(timezone.utc)
    except (TypeError, ValueError) as exc:
        raise ValueError("Choose a valid date and time in the business time zone") from exc


async def _slots(session, tenant_id, svc, date_str, zone, exclude_booking=None):
    d = _date.fromisoformat(date_str)
    avail = await session.scalar(select(AvailabilityRecord).where(
        AvailabilityRecord.tenant_id == tenant_id, AvailabilityRecord.weekday == d.weekday()))
    if not avail or avail.is_closed or await session.scalar(select(HolidayRecord).where(
            HolidayRecord.tenant_id == tenant_id, HolidayRecord.date == date_str)):
        return []
    start, end = _parse_hm(avail.start_time), _parse_hm(avail.end_time)
    day_start = datetime.combine(d, datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
    day_end = datetime.combine(d + timedelta(days=1), datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
    query = select(BookingRecord).where(BookingRecord.tenant_id == tenant_id,
        BookingRecord.start_ts < day_end, BookingRecord.end_ts > day_start,
        BookingRecord.status != "cancelled")
    if exclude_booking:
        query = query.where(BookingRecord.booking_id != exclude_booking)
    bookings = (await session.scalars(query)).all()
    result = []
    for minute in range(start, end - svc.duration_mins + 1, max(10, svc.duration_mins)):
        naive = datetime(d.year, d.month, d.day, minute // 60, minute % 60)
        local = naive.replace(tzinfo=zone)
        stamp = local.astimezone(timezone.utc)
        if stamp.astimezone(zone).replace(tzinfo=None) != naive or local.utcoffset() != local.replace(fold=1).utcoffset():
            continue
        finish = stamp + timedelta(minutes=svc.duration_mins)
        if stamp > datetime.now(timezone.utc) and not any(
                as_utc(b.start_ts) < finish and as_utc(b.end_ts) > stamp for b in bookings):
            result.append(f"{minute // 60:02d}:{minute % 60:02d}")
    return result


async def _safe_notify(**kwargs):
    try:
        await notify(**kwargs)
    except Exception:
        # The booking is already committed. A notification failure is not a failed booking.
        logger.exception("Booking notification failed")

DEFAULTS = {
    "clinic": [("Consultation", 20), ("Cleaning", 40), ("Follow-up", 15)],
    "salon": [("Haircut", 30), ("Color", 90), ("Cleanup", 30)],
    "hospitality": [("Table Reservation", 90), ("Private Dining", 120)],
    "restaurant": [("Table Reservation", 90)],
    "retail": [("Personal Consultation", 20), ("Styling Session", 45)],
    "education": [("Coaching Session", 45), ("Doubt Clearing", 30), ("Demo Class", 60)],
    "realestate": [("Site Visit", 45), ("Consultation", 30)],
    "professional": [("Consultation", 30), ("Review Meeting", 45)],
    "services": [("Service Booking", 30), ("Inspection", 45)],
    "other": [("Consultation", 20), ("General Appointment", 30)],
}


def _parse_hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


async def ensure_defaults(tenant_id: str, category: Optional[str] = None) -> None:
    """Ensure at least default services and weekly availability exist for tenant."""
    async with async_session() as session:
        await transaction_lock(session, f"calendar:{tenant_id}")
        cur = await session.execute(select(ServiceRecord).where(ServiceRecord.tenant_id == tenant_id))
        if cur.scalars().first():
            return
        key = (category or "other").lower().replace(" ", "")
        items = DEFAULTS.get(key, DEFAULTS["other"])[:6]
        for name, mins in items:
            session.add(ServiceRecord(service_id=uuid4().hex[:12], tenant_id=tenant_id, name=name, duration_mins=mins))
        # default availability Mon-Sat 09:00-18:00, Sun closed
        for wd in range(7):
            if wd == 6:
                session.add(AvailabilityRecord(tenant_id=tenant_id, weekday=wd, start_time="09:00", end_time="18:00", is_closed=True))
            else:
                session.add(AvailabilityRecord(tenant_id=tenant_id, weekday=wd, start_time="09:00", end_time="18:00", is_closed=False))
        await session.commit()


async def list_services(tenant_id: str) -> List[ServiceRecord]:
    """List all active services for tenant."""
    async with async_session() as session:
        r = await session.execute(
            select(ServiceRecord)
            .where(ServiceRecord.tenant_id == tenant_id, ServiceRecord.active.is_(True))
            .order_by(ServiceRecord.created_at)
        )
        return list(r.scalars().all())


async def resolve_service(tenant_id: str, service_name_or_id: str) -> Optional[ServiceRecord]:
    """Resolve a service by exact ID or case-insensitive fuzzy name match."""
    if not service_name_or_id:
        return None
    sname = service_name_or_id.strip().lower()
    async with async_session() as session:
        # Check direct service_id
        r = await session.execute(
            select(ServiceRecord).where(
                ServiceRecord.tenant_id == tenant_id,
                ServiceRecord.service_id == service_name_or_id.strip(),
                ServiceRecord.active.is_(True),
            )
        )
        rec = r.scalar_one_or_none()
        if rec:
            return rec

        # Check by name match
        r = await session.execute(
            select(ServiceRecord).where(
                ServiceRecord.tenant_id == tenant_id,
                ServiceRecord.active.is_(True),
            )
        )
        services = list(r.scalars().all())
        exact = [s for s in services if s.name.lower() == sname]
        return exact[0] if len(exact) == 1 else None


async def free_slots(tenant_id: str, service_id_or_name: str, date_str: str) -> List[str]:
    """Return future available slots in the business's configured time zone."""
    svc = await resolve_service(tenant_id, service_id_or_name)
    if not svc:
        return []
    zone = await business_timezone(tenant_id)
    async with async_session() as session:
        try:
            return await _slots(session, tenant_id, svc, date_str, zone)
        except ValueError:
            return []


async def create_booking(
    tenant_id: str,
    service_id_or_name: str,
    start_ts: datetime,
    title: str,
    contact_id: Optional[str] = None,
    source: str = "voice",
    idempotency_key: Optional[str] = None,
) -> BookingRecord:
    """Create a new booking with collision prevention and notification."""
    svc = await resolve_service(tenant_id, service_id_or_name)
    if not svc:
        raise ValueError("Service not found. Please choose a listed service.")
    zone = await business_timezone(tenant_id)
    start_ts = as_utc(start_ts)
    async with async_session() as session:
        await transaction_lock(session, f"calendar:{tenant_id}")
        dur, sid, sname = svc.duration_mins, svc.service_id, svc.name
        booking_id = (sha256(f"{tenant_id}:{idempotency_key}".encode()).hexdigest()[:32]
                      if idempotency_key else uuid4().hex)
        existing = await session.scalar(select(BookingRecord).where(
            BookingRecord.booking_id == booking_id, BookingRecord.tenant_id == tenant_id))
        if existing:
            if existing.contact_id != contact_id or existing.service_id != sid or as_utc(existing.start_ts) != start_ts:
                raise ValueError("This request was already used for a different booking")
            if existing.status != "cancelled":
                return existing
            # If previously cancelled, check collision before reactivating
            end_ts = start_ts + timedelta(minutes=dur)
            q = await session.execute(
                select(BookingRecord).where(
                    BookingRecord.tenant_id == tenant_id,
                    BookingRecord.booking_id != existing.booking_id,
                    BookingRecord.start_ts < end_ts,
                    BookingRecord.end_ts > start_ts,
                    BookingRecord.status != "cancelled",
                )
            )
            if q.scalars().first():
                raise ValueError("Requested time slot is already booked. Please choose another time.")
            existing.status = "confirmed"
            existing.title = title[:200] if title else f"{sname} booking"
            existing.source = source
            await session.commit()
            await session.refresh(existing)
            return existing
        if contact_id and not await session.scalar(select(ContactRecord).where(
                ContactRecord.contact_id == contact_id, ContactRecord.owner_tenant_id == tenant_id)):
            raise ValueError("Contact not found")
        local = start_ts.astimezone(zone)
        slots = await _slots(session, tenant_id, svc, local.date().isoformat(), zone)
        if local.strftime("%H:%M") not in slots or start_ts.second or start_ts.microsecond:
            raise ValueError("This slot is unavailable. Choose a future time within business hours.")

        # Collision verification
        end_ts = start_ts + timedelta(minutes=dur)
        q = await session.execute(
            select(BookingRecord).where(
                BookingRecord.tenant_id == tenant_id,
                BookingRecord.start_ts < end_ts,
                BookingRecord.end_ts > start_ts,
                BookingRecord.status != "cancelled",
            )
        )
        if q.scalars().first():
            raise ValueError(f"Requested time slot is already booked. Please choose another time.")

        rec = BookingRecord(
            booking_id=booking_id,
            tenant_id=tenant_id,
            service_id=sid,
            contact_id=contact_id,
            title=title[:200] if title else f"{sname} booking",
            start_ts=start_ts,
            end_ts=end_ts,
            status="confirmed",
            source=source,
        )
        session.add(rec)
        await session.commit()
        await session.refresh(rec)

        # Notify workspace owner
        date_fmt = start_ts.strftime("%Y-%m-%d %H:%M")
        await _safe_notify(
            tenant_id=tenant_id,
            type="booking_created",
            title=f"New Booking: {sname}",
            body=f"{title or sname} scheduled for {date_fmt} ({source} agent)",
            link_id=rec.booking_id,
        )
        return rec


async def reschedule_booking(
    tenant_id: str,
    booking_id: str,
    new_date_str: str,
    new_time_str: str,
    contact_id: Optional[str] = None,
) -> BookingRecord:
    """Reschedule an existing booking to a new date and time."""
    try:
        new_start = await local_booking_time(tenant_id, new_date_str, new_time_str)
    except Exception as e:
        raise ValueError(f"Invalid new date/time format: {e}")

    zone = await business_timezone(tenant_id)
    async with async_session() as session:
        await transaction_lock(session, f"calendar:{tenant_id}")
        q = select(BookingRecord).where(
            BookingRecord.tenant_id == tenant_id,
            BookingRecord.booking_id == booking_id,
        )
        if contact_id:
            q = q.where(BookingRecord.contact_id == contact_id)
        
        rec = (await session.execute(q)).scalar_one_or_none()
        if not rec:
            raise ValueError(f"Booking ID '{booking_id}' not found.")
        if rec.status == "cancelled":
            raise ValueError(f"Cannot reschedule a cancelled booking.")
        if as_utc(rec.start_ts) == new_start:
            return rec
        svc = await session.scalar(select(ServiceRecord).where(
            ServiceRecord.service_id == rec.service_id, ServiceRecord.tenant_id == tenant_id,
            ServiceRecord.active.is_(True)))
        if not svc or new_time_str not in await _slots(session, tenant_id, svc, new_date_str, zone, booking_id):
            raise ValueError("This slot is unavailable. Choose a future time within business hours.")

        dur = int((rec.end_ts - rec.start_ts).total_seconds() / 60) if (rec.end_ts and rec.start_ts) else 30
        new_end = new_start + timedelta(minutes=dur)

        # Check collision with other bookings
        collision_q = select(BookingRecord).where(
            BookingRecord.tenant_id == tenant_id,
            BookingRecord.booking_id != booking_id,
            BookingRecord.start_ts < new_end,
            BookingRecord.end_ts > new_start,
            BookingRecord.status != "cancelled",
        )
        if (await session.execute(collision_q)).scalars().first():
            raise ValueError(f"New slot on {new_date_str} at {new_time_str} is already occupied.")

        old_date_fmt = rec.start_ts.strftime("%Y-%m-%d %H:%M") if rec.start_ts else "earlier"
        rec.start_ts = new_start
        rec.end_ts = new_end
        rec.status = "rescheduled"
        await session.commit()
        await session.refresh(rec)

        new_date_fmt = new_start.strftime("%Y-%m-%d %H:%M")
        await _safe_notify(
            tenant_id=tenant_id,
            type="booking_rescheduled",
            title=f"Booking Rescheduled: {rec.title}",
            body=f"Moved from {old_date_fmt} to {new_date_fmt}",
            link_id=rec.booking_id,
        )
        return rec


async def cancel_booking(
    tenant_id: str,
    booking_id: str,
    reason: str = "",
    contact_id: Optional[str] = None,
) -> BookingRecord:
    """Cancel an existing booking and notify owner."""
    async with async_session() as session:
        await transaction_lock(session, f"calendar:{tenant_id}")
        q = select(BookingRecord).where(
            BookingRecord.tenant_id == tenant_id,
            BookingRecord.booking_id == booking_id,
        )
        if contact_id:
            q = q.where(BookingRecord.contact_id == contact_id)

        rec = (await session.execute(q)).scalar_one_or_none()
        if not rec:
            raise ValueError(f"Booking ID '{booking_id}' not found.")
        if rec.status == "cancelled":
            return rec  # Already cancelled

        rec.status = "cancelled"
        await session.commit()
        await session.refresh(rec)

        date_fmt = rec.start_ts.strftime("%Y-%m-%d %H:%M") if rec.start_ts else ""
        await _safe_notify(
            tenant_id=tenant_id,
            type="booking_cancelled",
            title=f"Booking Cancelled: {rec.title}",
            body=f"Cancelled for {date_fmt}. Reason: {reason or 'Requested by caller'}",
            link_id=rec.booking_id,
        )
        return rec


async def get_booking(tenant_id: str, booking_id: str) -> Optional[BookingRecord]:
    """Retrieve single booking by ID."""
    async with async_session() as session:
        r = await session.execute(
            select(BookingRecord).where(
                BookingRecord.tenant_id == tenant_id,
                BookingRecord.booking_id == booking_id,
            )
        )
        return r.scalar_one_or_none()


async def list_bookings(
    tenant_id: str,
    contact_id: Optional[str] = None,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 50,
) -> List[BookingRecord]:
    """List bookings filtered by contact, status, or date range."""
    async with async_session() as session:
        q = select(BookingRecord).where(BookingRecord.tenant_id == tenant_id)
        if contact_id:
            q = q.where(BookingRecord.contact_id == contact_id)
        if status:
            q = q.where(BookingRecord.status == status)
        if from_date:
            try:
                dt_from = datetime.fromisoformat(f"{from_date}T00:00:00").replace(tzinfo=timezone.utc)
                q = q.where(BookingRecord.start_ts >= dt_from)
            except Exception:
                pass
        if to_date:
            try:
                dt_to = datetime.fromisoformat(f"{to_date}T23:59:59").replace(tzinfo=timezone.utc)
                q = q.where(BookingRecord.start_ts <= dt_to)
            except Exception:
                pass
        q = q.order_by(BookingRecord.start_ts.desc()).limit(limit)
        r = await session.execute(q)
        return list(r.scalars().all())


async def get_calendar_reports_summary(tenant_id: str) -> Dict:
    """Generate comprehensive calendar and booking performance report for workspace owner."""
    from sqlalchemy import case, func, and_

    async with async_session() as session:
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        today_end = today_start + timedelta(days=1)

        # Return seven counts, not every customer's booking record. All
        # predicates stay tenant-scoped and preserve the existing report rules.
        def count_where(condition):
            return func.count(case((condition, 1)))

        totals = await session.execute(select(
            func.count(BookingRecord.booking_id),
            count_where(BookingRecord.status.in_(("confirmed", "rescheduled"))),
            count_where(BookingRecord.status == "cancelled"),
            count_where(and_(BookingRecord.start_ts >= today_start, BookingRecord.start_ts < today_end, BookingRecord.status != "cancelled")),
            count_where(and_(BookingRecord.start_ts >= week_ago, BookingRecord.status != "cancelled")),
            count_where(BookingRecord.source == "voice"),
            count_where(BookingRecord.source == "chat"),
        ).where(BookingRecord.tenant_id == tenant_id))
        total_count, confirmed_count, cancelled_count, today_count, this_week_count, voice_bookings, chat_bookings = totals.one()

        cancellation_rate = round((cancelled_count / total_count * 100), 1) if total_count > 0 else 0.0

        # Breakdown by service
        services_q = await session.execute(
            select(ServiceRecord).where(ServiceRecord.tenant_id == tenant_id)
        )
        service_map = {s.service_id: s.name for s in services_q.scalars().all()}
        service_counts: Dict[str, int] = {}
        grouped = await session.execute(
            select(BookingRecord.service_id, func.count(BookingRecord.booking_id))
            .where(BookingRecord.tenant_id == tenant_id)
            .group_by(BookingRecord.service_id)
        )
        for service_id, count in grouped:
            sname = service_map.get(service_id or "", "General Appointment")
            service_counts[sname] = service_counts.get(sname, 0) + count

        return {
            "total_bookings": total_count,
            "confirmed_bookings": confirmed_count,
            "cancelled_bookings": cancelled_count,
            "cancellation_rate_pct": cancellation_rate,
            "bookings_today": today_count,
            "bookings_this_week": this_week_count,
            "channel_breakdown": {
                "voice": voice_bookings,
                "chat": chat_bookings,
            },
            "service_breakdown": service_counts,
        }
