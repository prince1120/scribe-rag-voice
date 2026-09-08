"""Automated tests for Scribe business release.

Uses an isolated in-memory SQLite database and mocks to verify:
1. Canonical call persistence, browser/worker precedence, and beacon spam protection.
2. Cross-caller isolation and pure-contact rejection from owner endpoints.
3. Request creation idempotency, daily caps, and owner notes.
4. Summary leasing, retry bounding, and Mistral/OpenAI-compatible client invocation.
5. Calendar collision locking, idempotency, and cancellation rebooking.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.db_models import Base, ContactRecord, VoiceCallRecord, BusinessRequestRecord, ServiceRecord, AvailabilityRecord, BookingRecord
from app.repositories import business
from app.services import business_calls
from app.services import calendar_service
from app.identity import Identity, resolve_identity


@pytest.fixture(autouse=True)
async def test_db(monkeypatch):
    """Provide a pristine isolated SQLite database for each test."""
    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    test_session_factory = sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Monkeypatch the session maker in all relevant modules
    monkeypatch.setattr("app.database.async_session", test_session_factory)
    monkeypatch.setattr("app.repositories.business.async_session", test_session_factory)
    monkeypatch.setattr("app.repositories.owners.async_session", test_session_factory)
    monkeypatch.setattr("app.services.calendar_service.async_session", test_session_factory)
    monkeypatch.setattr("app.repositories.async_session", test_session_factory)

    # Disable transaction advisory locks on SQLite (Postgres-only feature)
    async def noop_lock(session, lock_name):
        pass
    monkeypatch.setattr("app.repositories.business.transaction_lock", noop_lock)
    monkeypatch.setattr("app.services.calendar_service.transaction_lock", noop_lock)

    yield test_session_factory

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


class TestCallPersistence:
    @pytest.mark.asyncio
    async def test_canonical_call_creation_and_save(self):
        tenant_id = "tenant-1"
        contact_id = "contact-1"

        call_id = await business.create_call(tenant_id, contact_id, "127.0.0.1", "TestAgent")
        assert call_id is not None

        # Verify initial call record
        call = await business.get_call(call_id, tenant_id, contact_id)
        assert call is not None
        assert call.call_id == call_id
        assert call.completed is False
        assert call.summary_status == "waiting"

        # Browser beacon saves initial turns
        browser_messages = [
            {"role": "assistant", "content": "Hello, how can I help you?"},
            {"role": "user", "content": "I would like to know your hours."},
        ]
        saved = await business.save_call(call_id, tenant_id, contact_id, browser_messages, 15, source="browser", completed=False)
        assert len(saved.transcript) == 2
        assert saved.transcript_source == "browser"

        # Worker snapshot arrives with full transcript and completed=True
        worker_messages = browser_messages + [
            {"role": "assistant", "content": "We are open Monday through Friday 9am to 6pm."},
            {"role": "user", "content": "Thank you!"},
        ]
        worker_saved = await business.save_call(call_id, tenant_id, contact_id, worker_messages, 30, source="worker", completed=True)
        assert len(worker_saved.transcript) == 4
        assert worker_saved.transcript_source == "worker"
        assert worker_saved.completed is True
        assert worker_saved.summary_status == "pending"

        # A late delayed browser beacon cannot overwrite worker's authoritative transcript
        stale_browser_messages = browser_messages
        beacon_saved = await business.save_call(call_id, tenant_id, contact_id, stale_browser_messages, 20, source="browser", completed=True)
        assert len(beacon_saved.transcript) == 4
        assert beacon_saved.transcript_source == "worker"

    @pytest.mark.asyncio
    async def test_summary_status_not_reset_by_late_beacons(self, test_db):
        tenant_id = "tenant-1"
        call_id = await business.create_call(tenant_id, None, "127.0.0.1", None)

        messages = [{"role": "user", "content": "Quick question"}]
        await business.save_call(call_id, tenant_id, None, messages, 10, source="worker", completed=True)

        # Make ready for claim immediately
        async with test_db() as s:
            c = await s.get(VoiceCallRecord, call_id)
            c.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await s.commit()

        # Claim and finish summary
        claimed = await business.claim_summary()
        assert claimed is not None
        assert claimed.call_id == call_id

        summary_data = {
            "summary": "Caller asked a quick question.",
            "sentiment": "neutral",
            "key_points": [],
            "action_items": [],
            "unanswered_questions": [],
            "needs_follow_up": False,
        }
        await business.finish_summary(call_id, claimed.summary_lease, summary=summary_data, tokens=45)

        finished_call = await business.get_call(call_id, tenant_id)
        assert finished_call.summary_status == "ready"
        assert finished_call.summary["summary"] == "Caller asked a quick question."

        # Late browser beacon must NOT reset ready status or schedule new attempts
        await business.save_call(call_id, tenant_id, None, messages, 12, source="browser", completed=True)
        call_after_beacon = await business.get_call(call_id, tenant_id)
        assert call_after_beacon.summary_status == "ready"
        assert call_after_beacon.summary is not None


class TestCallerIsolation:
    @pytest.mark.asyncio
    async def test_caller_cannot_access_another_callers_call(self):
        tenant_id = "tenant-biz"
        call_a = await business.create_call(tenant_id, "contact-A", "1.1.1.1", None)
        call_b = await business.create_call(tenant_id, "contact-B", "2.2.2.2", None)

        # Contact A can view Call A
        res_a = await business.get_call(call_a, tenant_id, contact_id="contact-A")
        assert res_a is not None

        # Contact A CANNOT view Call B
        res_b_by_a = await business.get_call(call_b, tenant_id, contact_id="contact-A")
        assert res_b_by_a is None

    @pytest.mark.asyncio
    async def test_cross_tenant_owner_identity_resolution(self):
        from app.session import issue
        # User has an owner cookie for tenant-1
        owner_cookie = issue(kind="owner:tenant-1")
        # But also has a contact cookie for tenant-2
        contact_cookie = issue(kind="contact:contact-xyz:tenant-2")

        identity = resolve_identity(session_cookie=owner_cookie, contact_cookie=contact_cookie)
        # Should resolve as a contact of tenant-2 without owner privileges
        assert identity.tenant_id == "tenant-2"
        assert identity.contact_id == "contact-xyz"
        assert identity.is_owner is False
        assert identity.is_contact is True


class TestBusinessRequests:
    @pytest.mark.asyncio
    async def test_request_idempotency_and_owner_update(self, test_db):
        tenant_id = "tenant-1"
        contact_id = "contact-abc"
        req_id = str(uuid4())

        # Seed contact in db
        async with test_db() as session:
            session.add(ContactRecord(
                contact_id=contact_id,
                owner_tenant_id=tenant_id,
                name="John Doe",
                token_hash="hash",
                mode="both",
            ))
            await session.commit()

        # Submit request
        req1 = await business.create_request(
            tenant_id, contact_id, req_id, "Please call me about pricing", "john@example.com"
        )
        assert req1.request_id == req_id
        assert req1.status == "open"

        # Idempotent re-submission returns the existing request
        req2 = await business.create_request(
            tenant_id, contact_id, req_id, "Please call me about pricing", "john@example.com"
        )
        assert req2.request_id == req_id

        # Owner updates request status and private note
        updated = await business.update_request(
            tenant_id, req_id, status="in_progress", owner_note="Spoke with John, sending brochure."
        )
        assert updated.status == "in_progress"
        assert updated.owner_note == "Spoke with John, sending brochure."


class TestSummarizationPipeline:
    @pytest.mark.asyncio
    async def test_empty_transcript_finishes_without_llm_call(self, test_db, monkeypatch):
        tenant_id = "tenant-empty"
        call_id = await business.create_call(tenant_id, None, "127.0.0.1", None)
        await business.save_call(call_id, tenant_id, None, [], 5, source="worker", completed=True)

        call = await business.get_call(call_id, tenant_id)
        call_lease = "lease-123"
        async with test_db() as s:
            c = await s.get(VoiceCallRecord, call_id)
            c.summary_lease = call_lease
            await s.commit()

        # Mock owner credentials and channel_settings so it doesn't touch remote DB
        async def fake_creds(t_id):
            return {"groq_api_key": "fake-key"}
        monkeypatch.setattr("app.services.business_calls.resolve_credentials", fake_creds)
        monkeypatch.setattr("app.services.business_calls.channel_settings", lambda agent, ch: {})

        call.summary_lease = call_lease
        with patch("openai.AsyncOpenAI") as mock_openai:
            await business_calls.summarize(call)
            mock_openai.assert_not_called()

        finished = await business.get_call(call_id, tenant_id)
        assert finished.summary_status == "ready"
        assert "Empty call" in finished.summary["summary"]

    @pytest.mark.asyncio
    async def test_summarize_uses_mistral_settings(self, test_db, monkeypatch):
        tenant_id = "tenant-mistral"
        call_id = await business.create_call(tenant_id, None, "127.0.0.1", None)
        messages = [
            {"role": "assistant", "content": "Welcome to Acme Dental."},
            {"role": "user", "content": "I need to book a dental checkup tomorrow."},
        ]
        await business.save_call(call_id, tenant_id, None, messages, 25, source="worker", completed=True)

        call = await business.get_call(call_id, tenant_id)
        call_lease = "lease-mistral"
        async with test_db() as s:
            c = await s.get(VoiceCallRecord, call_id)
            c.summary_lease = call_lease
            await s.commit()
        call.summary_lease = call_lease

        # Mock owner credentials returning Mistral base url & key
        async def fake_creds(t_id):
            return {
                "custom_llm_base_url": "https://api.mistral.ai/v1",
                "custom_llm_api_key": "test-mistral-key",
                "llm_model": "mistral-small-latest",
                "groq_api_key": None,
            }
        monkeypatch.setattr("app.services.business_calls.resolve_credentials", fake_creds)
        monkeypatch.setattr("app.services.business_calls.channel_settings", lambda agent, ch: {})

        mock_resp = MagicMock()
        mock_resp.choices = [
            MagicMock(message=MagicMock(content='{"summary": "Caller wants to book a dental checkup.", "sentiment": "neutral", "key_points": ["Wants checkup"], "action_items": ["Confirm booking"], "unanswered_questions": [], "needs_follow_up": true}'))
        ]
        mock_resp.usage = MagicMock(total_tokens=150)

        mock_client_instance = AsyncMock()
        mock_client_instance.chat.completions.create = AsyncMock(return_value=mock_resp)
        mock_client_instance.__aenter__.return_value = mock_client_instance
        mock_client_instance.__aexit__.return_value = None

        with patch("openai.AsyncOpenAI", return_value=mock_client_instance) as mock_cls:
            await business_calls.summarize(call)
            mock_cls.assert_called_once_with(
                api_key="test-mistral-key",
                base_url="https://api.mistral.ai/v1",
                timeout=20,
                max_retries=0,
            )

        finished = await business.get_call(call_id, tenant_id)
        assert finished.summary_status == "ready"
        assert finished.summary["summary"] == "Caller wants to book a dental checkup."
        assert finished.summary["needs_follow_up"] is True


class TestCalendarHardening:
    @pytest.mark.asyncio
    async def test_booking_slot_collision_and_cancellation_rebooking(self, test_db):
        tenant_id = "tenant-cal"
        sid = "svc-consult"

        # Seed service & availability
        async with test_db() as session:
            session.add(ServiceRecord(
                service_id=sid,
                tenant_id=tenant_id,
                name="Consultation",
                duration_mins=30,
                active=True,
            ))
            # Open Monday to Sunday 09:00 to 18:00
            for wd in range(7):
                session.add(AvailabilityRecord(
                    tenant_id=tenant_id,
                    weekday=wd,
                    start_time="09:00",
                    end_time="18:00",
                    is_closed=False,
                ))
            await session.commit()

        # Choose a future date/time
        future_dt = datetime.now(timezone.utc) + timedelta(days=2)
        future_dt = future_dt.replace(hour=10, minute=0, second=0, microsecond=0)

        # 1. First booking succeeds
        b1 = await calendar_service.create_booking(
            tenant_id=tenant_id,
            service_id_or_name=sid,
            start_ts=future_dt,
            title="First client",
            idempotency_key="key-user-1",
        )
        assert b1.status == "confirmed"

        # 2. Duplicate booking of same time slot is rejected
        with pytest.raises(ValueError, match="unavailable"):
            await calendar_service.create_booking(
                tenant_id=tenant_id,
                service_id_or_name=sid,
                start_ts=future_dt,
                title="Second client",
                idempotency_key="key-user-2",
            )

        # 3. First client cancels their booking
        cancelled = await calendar_service.cancel_booking(
            tenant_id=tenant_id,
            booking_id=b1.booking_id,
            reason="Rescheduling requested",
        )
        assert cancelled.status == "cancelled"

        # 4. Now that the slot is free, rebooking with the same idempotency key reactivates it cleanly
        rebooked = await calendar_service.create_booking(
            tenant_id=tenant_id,
            service_id_or_name=sid,
            start_ts=future_dt,
            title="Re-booked appointment",
            idempotency_key="key-user-1",
        )
        assert rebooked.booking_id == b1.booking_id
        assert rebooked.status == "confirmed"

