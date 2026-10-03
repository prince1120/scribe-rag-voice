"""Booking intake, live availability and single-owner voice announcements."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.db_models import Base, ServiceRecord, AvailabilityRecord
from app.services import calendar_service as cal
from app.services.voice.agent import VoiceAssistant


@pytest.fixture
async def calendar(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(cal, "async_session", sessions)
    monkeypatch.setattr(cal, "_safe_notify", AsyncMock())
    day = (datetime.now(timezone.utc) + timedelta(days=2)).date()
    async with sessions() as session:
        session.add(ServiceRecord(service_id="consult", tenant_id="one", name="Consultation", duration_mins=30))
        session.add(AvailabilityRecord(tenant_id="one", weekday=day.weekday(), start_time="09:00", end_time="11:00", is_closed=False))
        await session.commit()
    yield day.isoformat()
    await engine.dispose()


async def test_live_slots_customer_snapshot_and_tenant_scope(calendar):
    assert "10:00" in await cal.free_slots("one", "consult", calendar)
    record = await cal.create_booking("one", "consult", await cal.local_booking_time("one", calendar, "10:00"),
                                      "Consultation", customer_name=" Ken ", customer_phone="+91 98765-43210")
    assert "10:00" not in await cal.free_slots("one", "consult", calendar)
    details = await cal.booking_details("one", record.booking_id)
    assert details["contact_name"] == "Ken"
    assert details["customer_phone"] == "+919876543210"
    assert await cal.booking_details("other", record.booking_id) is None
    with pytest.raises(ValueError, match="unavailable|already booked"):
        await cal.create_booking("one", "consult", record.start_ts, "Duplicate")
    await cal.cancel_booking("one", record.booking_id)
    assert "10:00" in await cal.free_slots("one", "consult", calendar)


async def test_missing_details_do_not_start_voice_booking():
    agent = SimpleNamespace(_tenant_id="one", _run_background_booking=AsyncMock())
    result = await VoiceAssistant.book_appointment(agent, "consult", "2030-01-01", "10:00", customer_name="Ken")
    assert "missing" in result
    agent._run_background_booking.assert_not_called()


async def test_voice_workflow_speaks_progress_and_result_once(monkeypatch):
    create = AsyncMock(return_value=SimpleNamespace(status="confirmed", booking_id="booking"))
    monkeypatch.setattr(cal, "create_booking", create)
    spoken = []

    async def say(text, **kwargs):
        spoken.append(text)

    agent = SimpleNamespace(_tenant_id="one", _call_id="call", _last_user_lang="en-IN",
                            _booking_tasks=set(), _pending_bookings={("consult", "2030-01-01", "10:00")},
                            session=SimpleNamespace(say=say), _publish_booking_event=AsyncMock())
    agent._speak_booking_progress = lambda: VoiceAssistant._speak_booking_progress(agent)
    VoiceAssistant._run_background_booking(agent, service_id="consult", service_name="Consultation",
        date="2030-01-01", time="10:00", start_ts=datetime(2030, 1, 1, 10, tzinfo=timezone.utc),
        timezone_name="UTC", reason="", contact_id=None, customer_name="Ken", customer_phone="9876543210")
    await asyncio.gather(*agent._booking_tasks)
    assert len(spoken) == 2
    assert "booking that" in spoken[0]
    assert spoken[1].startswith("Done,")
    assert create.await_args.kwargs["customer_phone"] == "9876543210"
    assert not agent._pending_bookings
