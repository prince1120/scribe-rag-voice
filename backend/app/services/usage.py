"""What a workspace has spent today, and whether it may spend more.

Every call runs on the owner's own Groq and Sarvam keys, so an unbounded call
volume is an unbounded bill charged to them. The per-contact session cap does
not bound this: `/directory/connect` mints contacts, so a cap of three sessions
per link is three sessions multiplied by however many links an attacker cares to
create.

This is the ceiling that does bound it — counted per workspace, across every
contact it has, and enforced where a call is authorised rather than where a link
is created. A link is cheap; a call is what costs money.

Counted from `contact_sessions` rather than a separate meter, because that table
already records every session with the timestamp and duration needed. One fewer
thing to keep consistent.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.config import settings
from app.database import async_session
from app.models.db_models import ContactRecord, ContactSessionRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Usage:
    calls: int
    minutes: int
    call_budget: int
    minute_budget: int

    @property
    def over_budget(self) -> bool:
        return (
            (self.call_budget > 0 and self.calls >= self.call_budget)
            or (self.minute_budget > 0 and self.minutes >= self.minute_budget)
        )

    def to_dict(self) -> dict:
        return {
            "calls_today": self.calls,
            "minutes_today": self.minutes,
            "call_budget": self.call_budget or None,
            "minute_budget": self.minute_budget or None,
            "over_budget": self.over_budget,
        }


async def usage_today(tenant_id: str) -> Usage:
    """Calls and minutes this workspace has used since midnight UTC.

    A rolling 24h window rather than a calendar day would be fairer but makes
    "your budget resets at midnight" impossible to state simply, and an owner
    needs to be able to predict when service returns.
    """
    since = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    async with async_session() as session:
        result = await session.execute(
            select(
                func.count(),
                func.coalesce(func.sum(ContactSessionRecord.duration_seconds), 0),
            )
            .select_from(ContactSessionRecord)
            .join(
                ContactRecord,
                ContactRecord.contact_id == ContactSessionRecord.contact_id,
            )
            .where(
                ContactRecord.owner_tenant_id == tenant_id,
                ContactSessionRecord.channel == "voice",
                ContactSessionRecord.started_at >= since,
            )
        )
        calls, seconds = result.one()

    return Usage(
        calls=int(calls or 0),
        minutes=int((seconds or 0) // 60),
        call_budget=settings.DAILY_CALL_BUDGET,
        minute_budget=settings.DAILY_MINUTE_BUDGET,
    )


async def distinct_businesses_contacted(
    device_id: str | None, ip_address: str | None, minutes: int = 10
) -> int:
    """How many different workspaces one caller has reached recently.

    A person calls one business. Someone working through the directory calls
    twenty, and that pattern is invisible to any per-workspace limit — each
    owner sees a single caller behaving normally, while the aggregate is an
    attack. This is the only check that looks across tenants.
    """
    if not device_id and not ip_address:
        return 0

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    async with async_session() as session:
        query = (
            select(func.count(func.distinct(ContactRecord.owner_tenant_id)))
            .select_from(ContactSessionRecord)
            .join(
                ContactRecord,
                ContactRecord.contact_id == ContactSessionRecord.contact_id,
            )
            .where(ContactSessionRecord.started_at >= since)
        )
        # Device first: it survives a changing IP, and an IP can be shared by a
        # whole office behind one NAT. IP is the fallback for a first visit,
        # before any device id exists.
        if device_id:
            query = query.where(ContactSessionRecord.device_id == device_id)
        else:
            query = query.where(ContactSessionRecord.ip_address == ip_address)

        result = await session.execute(query)
        return int(result.scalar() or 0)
