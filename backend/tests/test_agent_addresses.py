from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app import repositories
from app.database import async_session, init_db
from app.main import app
from app.models.db_models import AgentSnapshotRecord
from app.repositories.agent_addresses import ensure_address, resolve_address


async def test_stable_codes_route_to_published_agent_without_documents():
    await init_db()
    tenant = "address_" + uuid4().hex
    await repositories.create_owner(tenant_id=tenant, mode="business", business_name="Clinic")
    first, second = uuid4().hex, uuid4().hex
    async with async_session() as session:
        session.add_all([AgentSnapshotRecord(tenant_id=tenant, snapshot_id=value, name="Asha", script="Verified prices") for value in (first, second)])
        await session.commit()
    await repositories.upsert_agent(tenant_id=tenant, name="Asha", script="Old facts", active_snapshot_id=first, rag_enabled=False)
    address = await ensure_address(tenant, first)
    other = await ensure_address(tenant, second)
    assert len(address["code"]) == 8 and address["code"].isdigit()
    assert address != other
    assert await resolve_address(address["code"]) is None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        offline = await client.get(f"/api/v1/directory/agents/{address['code']}")
        assert offline.status_code == 200
        assert offline.json()["online"] is False
        assert offline.json()["agent_name"] == "Asha"
        body = {"request_id": str(uuid4()), "name": "Ravi", "message": "Need help with an earlier appointment", "reply_to": "ravi@example.com"}
        sent = await client.post(f"/api/v1/directory/agents/{address['code']}/messages", json=body)
        assert sent.status_code == 200
        retried = await client.post(f"/api/v1/directory/agents/{address['code']}/messages", json=body)
        assert retried.json() == sent.json()
        from app.repositories.business import list_requests
        requests, total = await list_requests(tenant)
        assert total == 1
        record, caller = requests[0]
        assert caller == "Ravi" and record.reply_to == "ravi@example.com"
        assert address["code"] in record.message and "earlier appointment" in record.message
        assert (await list_requests("someone_else"))[1] == 0
    await repositories.set_agent_status(tenant, "deployed")
    await repositories.upsert_agent(tenant_id=tenant, script="Unpublished edits")
    assert (await resolve_address(address["handle"]))[1].script == "Old facts"
    assert await ensure_address(tenant, first) == address
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/v1/directory/agents/{address['code']}")
        assert response.status_code == 200
        assert response.json()["has_chat"] is True
        assert "tenant_id" not in response.json()
        connected = await client.post("/api/v1/directory/connect", json={"handle": address["code"], "name": "Guest", "mode": "chat"})
        assert connected.status_code == 200
        assert connected.json()["redirect_url"].startswith("/t/")
        from app import contacts
        guest = await repositories.get_contact_by_token_hash(contacts.hash_token(connected.json()["token"]))
        assert guest.agent_snapshot_id == first
        contacts.check_agent_available(guest, await repositories.get_agent(tenant))
    await repositories.activate_agent_snapshot(tenant, second)
    await repositories.set_agent_status(tenant, "deployed")
    assert await resolve_address(address["code"]) is None
    with pytest.raises(contacts.ContactError, match="offline"):
        contacts.check_agent_available(guest, await repositories.get_agent(tenant))
    await repositories.activate_agent_snapshot(tenant, first)
    await repositories.set_agent_status(tenant, "deployed")
    assert await ensure_address(tenant, first) == address
    assert await resolve_address(address["code"]) is not None
    with pytest.raises(LookupError):
        await ensure_address("someone_else", first)


async def test_manual_agent_is_archived_before_new_agent_replaces_it():
    from app.repositories.agent_addresses import find_address
    await init_db()
    tenant = "manual_address_" + uuid4().hex
    await repositories.create_owner(tenant_id=tenant, mode="business", business_name="Clinic")
    await repositories.upsert_agent(tenant_id=tenant, name="Original", script="Original facts")
    old = await ensure_address(tenant)
    original = await repositories.get_agent(tenant)
    assert original.active_snapshot_id
    assert await ensure_address(tenant, original.active_snapshot_id) == old
    new_id = uuid4().hex
    async with async_session() as session:
        session.add(AgentSnapshotRecord(snapshot_id=new_id, tenant_id=tenant, name="New agent", script="New facts"))
        await session.commit()
    await repositories.activate_agent_snapshot(tenant, new_id)
    new = await ensure_address(tenant, new_id)
    assert old != new
    found = await find_address(old["code"])
    assert found[1].name == "Original" and found[3] is False
    await repositories.activate_agent_snapshot(tenant, original.active_snapshot_id)
    await repositories.set_agent_status(tenant, "deployed")
    assert (await resolve_address(old["code"]))[1].script == "Original facts"
