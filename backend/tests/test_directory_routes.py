"""Tests for public directory endpoints."""
from uuid import uuid4
import pytest
from httpx import ASGITransport, AsyncClient

from app.database import engine, init_db
from app.main import app
from app import repositories


@pytest.fixture(autouse=True)
async def ensure_db():
    await init_db()
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_directory_workflow():
    tenant_live = f"dir_live_{uuid4().hex[:8]}"
    tenant_draft = f"dir_draft_{uuid4().hex[:8]}"

    await repositories.create_owner(
        tenant_id=tenant_live,
        mode="business",
        business_name="Dr. Rao Dental Clinic",
        business_category="Healthcare",
    )
    await repositories.upsert_agent(
        tenant_id=tenant_live,
        name="Asha",
        script="You answer dental questions warmly and concisely.",
        greeting="Hello, welcome to Dr. Rao Dental Clinic!",
    )
    await repositories.set_agent_status(tenant_live, "deployed")

    await repositories.create_owner(
        tenant_id=tenant_draft,
        mode="business",
        business_name="Draft Business",
        business_category="Retail",
    )
    await repositories.upsert_agent(
        tenant_id=tenant_draft,
        name="DraftBot",
        script="Draft prompt",
    )
    await repositories.set_agent_status(tenant_draft, "draft")

    # Handles are minted for workspaces that appear in the directory; resolve
    # them up front so the assertions below can key on them.
    live_handle = await repositories.ensure_public_handle(tenant_live)
    draft_handle = await repositories.ensure_public_handle(tenant_draft)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. List active deployed agents
            res = await client.get("/api/v1/directory/agents")
            assert res.status_code == 200
            data = res.json()
            assert "agents" in data

            # The listing publishes an opaque handle, never the tenant id —
            # the tenant id is the key every other table joins on, so
            # publishing it handed out a permanent targeting parameter an owner
            # could not change.
            for entry in data["agents"]:
                assert "owner_tenant_id" not in entry, (
                    "the public directory must not publish tenant ids"
                )
                assert entry.get("handle"), "every listed agent needs a handle"

            live_agent = next(
                (a for a in data["agents"] if a.get("handle") == live_handle), None
            )
            assert live_agent is not None
            assert live_agent["business_name"] == "Dr. Rao Dental Clinic"
            assert live_agent["agent_name"] == "Asha"
            assert live_agent["business_category"] == "Healthcare"
            assert live_agent["has_voice"] is True

            draft_agent = next(
                (a for a in data["agents"] if a.get("handle") == draft_handle), None
            )
            assert draft_agent is None

            # 2. Connect to live agent
            connect_res = await client.post(
                "/api/v1/directory/connect",
                json={
                    "handle": live_handle,
                    "name": "Sunil Kumar",
                    "mode": "voice",
                },
            )
            assert connect_res.status_code == 200
            connect_data = connect_res.json()
            assert "token" in connect_data
            assert connect_data["redirect_url"] == f"/t/{connect_data['token']}"
            assert connect_data["business_name"] == "Dr. Rao Dental Clinic"

            # 3. Refuse connecting to draft / non-existent agent
            fail_res = await client.post(
                "/api/v1/directory/connect",
                json={
                    "handle": draft_handle,
                    "name": "Guest",
                    "mode": "voice",
                },
            )
            assert fail_res.status_code == 404
    finally:
        from sqlalchemy import delete
        from app.database import async_session
        from app.models.db_models import AgentRecord, OwnerRecord, ContactRecord
        async with async_session() as session:
            await session.execute(delete(AgentRecord).where(AgentRecord.tenant_id.in_([tenant_live, tenant_draft])))
            await session.execute(delete(OwnerRecord).where(OwnerRecord.tenant_id.in_([tenant_live, tenant_draft])))
            await session.execute(delete(ContactRecord).where(ContactRecord.owner_tenant_id.in_([tenant_live, tenant_draft])))
            await session.commit()
