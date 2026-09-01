"""Calendar: per-service slots, availability, free-check, reschedule, cancellation, and reporting.

Modular, in-app only. Owner sets weekly hours once; services inherit.
Free slots = expand Availability into slots of service.duration_mins minus overlapping Bookings + Holidays.
Real-time notification and collision prevention on every action.
"""
from datetime import date as _date, datetime, timedelta, timezone
import logging
from typing import Dict, List, Optional
from uuid import uuid4

from sqlalchemy import delete, func, select, update

from app.database import async_session
from app.models.db_models import AvailabilityRecord, BookingRecord, HolidayRecord, ServiceRecord
from app.services.notification_service import notify

logger = logging.getLogger(__name__)

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
        for s in services:
            if s.name.lower() == sname or sname in s.name.lower() or s.name.lower() in sname:
                return s
        return services[0] if services else None


async def free_slots(tenant_id: str, service_id_or_name: str, date_str: str) -> List[str]:
    """Return free HH:MM slots for date (YYYY-MM-DD) for specified service."""
    try:
        d = _date.fromisoformat(date_str)
    except Exception:
        return []

    wd = d.weekday()
    async with async_session() as session:
        svc = await resolve_service(tenant_id, service_id_or_name)
        if not svc:
            return []

        avail = (
            await session.execute(
                select(AvailabilityRecord).where(
                    AvailabilityRecord.tenant_id == tenant_id,
                    AvailabilityRecord.weekday == wd,
                )
            )
        ).scalar_one_or_none()

        if not avail or avail.is_closed:
            return []

        hol = (
            await session.execute(
                select(HolidayRecord).where(
                    HolidayRecord.tenant_id == tenant_id,
                    HolidayRecord.date == date_str,
                )
            )
        ).scalar_one_or_none()

        if hol:
            return []

        sh, sm = _parse_hm(avail.start_time), _parse_hm(avail.end_time)
        dur = max(10, svc.duration_mins)
        slots = [
            f"{(sh + i * dur) // 60:02d}:{(sh + i * dur) % 60:02d}"
            for i in range((sm - sh) // dur)
        ]

        # Filter out overlapping existing active bookings
        day_start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        br = await session.execute(
            select(BookingRecord).where(
                BookingRecord.tenant_id == tenant_id,
                BookingRecord.start_ts >= day_start,
                BookingRecord.start_ts < day_end,
                BookingRecord.status != "cancelled",
            )
        )
        bookings = br.scalars().all()
        
        # Mark all busy minute spans
        busy_minutes = set()
        for b in bookings:
            if b.start_ts and b.end_ts:
                b_start = b.start_ts.hour * 60 + b.start_ts.minute
                b_end = b.end_ts.hour * 60 + b.end_ts.minute
                for m in range(b_start, b_end):
                    busy_minutes.add(m)

        def is_slot_free(slot_str: str) -> bool:
            slot_m = _parse_hm(slot_str)
            for m in range(slot_m, slot_m + dur):
                if m in busy_minutes:
                    return False
            return True

        return [s for s in slots if is_slot_free(s)]


async def create_booking(
    tenant_id: str,
    service_id_or_name: str,
    start_ts: datetime,
    title: str,
    contact_id: Optional[str] = None,
    source: str = "voice",
) -> BookingRecord:
    """Create a new booking with collision prevention and notification."""
    async with async_session() as session:
        svc = await resolve_service(tenant_id, service_id_or_name)
        dur = svc.duration_mins if svc else 30
        sid = svc.service_id if svc else None
        sname = svc.name if svc else "Appointment"

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
            booking_id=uuid4().hex[:12],
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
        await notify(
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
        new_start = datetime.fromisoformat(f"{new_date_str}T{new_time_str}:00").replace(tzinfo=timezone.utc)
    except Exception as e:
        raise ValueError(f"Invalid new date/time format: {e}")

    async with async_session() as session:
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
        await notify(
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
        await notify(
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
    async with async_session() as session:
        # Total counts by status
        all_bookings_q = await session.execute(
            select(BookingRecord).where(BookingRecord.tenant_id == tenant_id)
        )
        all_bookings = list(all_bookings_q.scalars().all())

        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        today_end = today_start + timedelta(days=1)

        total_count = len(all_bookings)
        confirmed_count = sum(1 for b in all_bookings if b.status in ("confirmed", "rescheduled"))
        cancelled_count = sum(1 for b in all_bookings if b.status == "cancelled")
        today_count = sum(1 for b in all_bookings if b.start_ts and today_start <= b.start_ts < today_end and b.status != "cancelled")
        this_week_count = sum(1 for b in all_bookings if b.start_ts and b.start_ts >= week_ago and b.status != "cancelled")
        voice_bookings = sum(1 for b in all_bookings if b.source == "voice")
        chat_bookings = sum(1 for b in all_bookings if b.source == "chat")

        cancellation_rate = round((cancelled_count / total_count * 100), 1) if total_count > 0 else 0.0

        # Breakdown by service
        services_q = await session.execute(
            select(ServiceRecord).where(ServiceRecord.tenant_id == tenant_id)
        )
        service_map = {s.service_id: s.name for s in services_q.scalars().all()}
        service_counts: Dict[str, int] = {}
        for b in all_bookings:
            sname = service_map.get(b.service_id or "", "General Appointment")
            service_counts[sname] = service_counts.get(sname, 0) + 1

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
