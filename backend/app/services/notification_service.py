"""Owner notifications (owner only, not caller)."""
from uuid import uuid4
from sqlalchemy import select, update
from app.database import async_session
from app.models.db_models import NotificationRecord

async def notify(tenant_id: str, type: str, title: str, body: str | None = None, link_id: str | None = None):
    async with async_session() as session:
        session.add(NotificationRecord(notification_id=uuid4().hex[:12], tenant_id=tenant_id, type=type, title=title, body=body, link_id=link_id))
        await session.commit()

async def list_notifications(tenant_id: str, limit: int = 20):
    async with async_session() as session:
        r = await session.execute(select(NotificationRecord).where(NotificationRecord.tenant_id == tenant_id).order_by(NotificationRecord.created_at.desc()).limit(limit))
        return list(r.scalars().all())

async def mark_read(tenant_id: str, notification_id: str):
    async with async_session() as session:
        await session.execute(update(NotificationRecord).where(NotificationRecord.notification_id == notification_id, NotificationRecord.tenant_id == tenant_id).values(read=True))
        await session.commit()
