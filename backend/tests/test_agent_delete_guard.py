from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import repositories
from app.api.owner_routes import delete_snapshot
from app.database import async_session, init_db
from app.identity import Identity
from app.models.db_models import AgentSnapshotRecord
from app.repositories.agent_addresses import ensure_address, resolve_address


async def test_selected_agent_cannot_be_deleted_or_lose_its_public_address():
    await init_db()
    tenant, snapshot_id = "delete_guard_" + uuid4().hex, uuid4().hex
    await repositories.create_owner(tenant_id=tenant, mode="business", business_name="Clinic")
    async with async_session() as session:
        session.add(AgentSnapshotRecord(tenant_id=tenant, snapshot_id=snapshot_id, name="Asha", script="Clinic facts"))
        await session.commit()
    await repositories.upsert_agent(tenant_id=tenant, active_snapshot_id=snapshot_id, script="Clinic facts")
    address = await ensure_address(tenant, snapshot_id)
    await repositories.set_agent_status(tenant, "deployed")
    with pytest.raises(HTTPException) as denied:
        await delete_snapshot(snapshot_id, Identity(tenant_id=tenant, is_owner=True))
    assert denied.value.status_code == 409
    assert await resolve_address(address["code"]) is not None
    assert await ensure_address(tenant, snapshot_id) == address
    with pytest.raises(HTTPException) as other:
        await delete_snapshot(snapshot_id, Identity(tenant_id="someone_else", is_owner=True))
    assert other.value.status_code == 404
