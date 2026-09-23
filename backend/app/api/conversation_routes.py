from typing import List

from fastapi import APIRouter, Depends

from app.api import routes
from app.auth import verify_api_key
from app.identity import Identity, get_identity
from app.models.schemas import Conversation, ConversationMessage

router = APIRouter(tags=["conversations"])


@router.get(
    "/conversations",
    response_model=List[Conversation],
    dependencies=[Depends(verify_api_key)],
)
async def list_conversations(
    identity: Identity = Depends(get_identity),
):
    """List conversations for a tenant."""
    tenant_id = identity.tenant_id
    records = await routes.repositories.list_conversations(tenant_id)
    return [
        Conversation(
            conversation_id=r.conversation_id,
            tenant_id=r.tenant_id,
            messages=[
                ConversationMessage(
                    role=m.role,
                    content=m.content,
                    timestamp=m.created_at.isoformat(),
                    citations=m.citations,
                )
                for m in sorted(r.messages, key=lambda m: m.created_at)
            ],
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in records
    ]


@router.post(
    "/conversations",
    response_model=dict,
    dependencies=[Depends(verify_api_key)],
)
async def create_conversation(
    identity: Identity = Depends(get_identity),
):
    """Create a new conversation."""
    tenant_id = identity.tenant_id
    conversation_id = routes.conversation_service.create_conversation(tenant_id)
    await routes.repositories.get_or_create_conversation(conversation_id, tenant_id)
    return {"conversation_id": conversation_id, "status": "created"}
