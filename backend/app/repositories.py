"""Async data-access helpers for the documents/conversations tables.

Kept as plain functions (not a class) — this app has no ORM-heavy domain
logic, just a handful of CRUD-shaped queries.
"""
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.db_models import ConversationRecord, DocumentRecord, MessageRecord


async def save_document(
    document_id: str, tenant_id: str, filename: str, file_size: int, chunk_count: int,
    status: str = "processed",
) -> None:
    async with async_session() as session:
        session.add(DocumentRecord(
            document_id=document_id, tenant_id=tenant_id, filename=filename,
            file_size=file_size, chunk_count=chunk_count, status=status,
        ))
        await session.commit()


async def list_documents(tenant_id: str) -> List[DocumentRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord)
            .where(DocumentRecord.tenant_id == tenant_id)
            .order_by(DocumentRecord.created_at.desc())
        )
        return list(result.scalars().all())


async def get_document_record(document_id: str, tenant_id: str) -> Optional[DocumentRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        return result.scalar_one_or_none()



async def update_document(document_id: str, tenant_id: str, chunk_count: int, file_size: int) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            record.chunk_count = chunk_count
            record.file_size = file_size
            await session.commit()


async def delete_document_record(document_id: str, tenant_id: str) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(DocumentRecord).where(
                DocumentRecord.document_id == document_id,
                DocumentRecord.tenant_id == tenant_id,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            await session.delete(record)
            await session.commit()


async def get_or_create_conversation(conversation_id: str, tenant_id: str) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord).where(ConversationRecord.conversation_id == conversation_id)
        )
        if result.scalar_one_or_none() is None:
            session.add(ConversationRecord(conversation_id=conversation_id, tenant_id=tenant_id))
            await session.commit()


async def append_message(
    conversation_id: str, tenant_id: str, role: str, content: str,
    citations: Optional[list] = None,
) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord).where(ConversationRecord.conversation_id == conversation_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation is None:
            conversation = ConversationRecord(conversation_id=conversation_id, tenant_id=tenant_id)
            session.add(conversation)
            await session.flush()

        session.add(MessageRecord(
            conversation_id=conversation_id, role=role, content=content, citations=citations,
        ))
        conversation.updated_at = datetime.now(timezone.utc)
        await session.commit()


async def list_conversations(tenant_id: str) -> List[ConversationRecord]:
    async with async_session() as session:
        result = await session.execute(
            select(ConversationRecord)
            .where(ConversationRecord.tenant_id == tenant_id)
            .options(selectinload(ConversationRecord.messages))
            .order_by(ConversationRecord.updated_at.desc())
        )
        return list(result.scalars().all())
