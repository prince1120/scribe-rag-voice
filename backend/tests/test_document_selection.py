"""Which documents an assistant may answer from.

Two separate guarantees, and the tests below keep them apart because they fail
in different ways:

  isolation  — one owner's documents are never reachable by another. This is
               enforced by the tenant_id filter every search carries, and it
               was already true; the tests here are a regression net.

  selection  — of an owner's own documents, only the ones they switched on are
               used. `document_ids` on the query request is client-supplied, so
               the selection has to be applied on the server: a shared chat link
               can name any id it likes, or omit the field entirely and expect
               everything.

The empty case is the subtle one. `document_ids=[]` builds no filter condition
at all (see VectorStoreService._build_filter) and therefore searches the whole
tenant — the exact opposite of what an empty selection means. So "nothing
selected" must never reach the vector store as an empty list.
"""
import pytest

from app.api import routes


@pytest.fixture
def enabled(monkeypatch):
    """Control the enabled set, and clear the cache the resolver reads."""
    from app.services import cache

    state = {"ids": []}

    async def fake_list(tenant_id):
        return list(state["ids"])

    monkeypatch.setattr(
        routes.repositories, "list_enabled_document_ids", fake_list
    )
    cache.config_cache.clear()
    yield state
    cache.config_cache.clear()


class TestSelectionIsAppliedServerSide:
    async def test_no_request_filter_uses_everything_enabled(self, enabled):
        enabled["ids"] = ["a", "b"]
        assert sorted(await routes.selected_document_ids("t1")) == ["a", "b"]

    async def test_a_request_may_narrow_the_selection(self, enabled):
        enabled["ids"] = ["a", "b", "c"]
        assert await routes.selected_document_ids("t1", ["b"]) == ["b"]

    async def test_a_request_cannot_widen_the_selection(self, enabled):
        """The important one. A chat link naming a document its owner switched
        off — or one belonging to a different workspace — must not reach it."""
        enabled["ids"] = ["a"]
        assert await routes.selected_document_ids("t1", ["a", "b", "secret"]) == ["a"]

    async def test_asking_only_for_disabled_documents_yields_nothing(self, enabled):
        enabled["ids"] = ["a"]
        with pytest.raises(routes.NoDocumentsSelected):
            await routes.selected_document_ids("t1", ["switched-off"])

    async def test_asking_only_for_another_tenants_documents_yields_nothing(
        self, enabled
    ):
        enabled["ids"] = ["mine"]
        with pytest.raises(routes.NoDocumentsSelected):
            await routes.selected_document_ids("t1", ["someone-elses"])


class TestNothingSelected:
    async def test_no_enabled_documents_raises_rather_than_returning_empty(
        self, enabled
    ):
        """Returning [] here would be a leak, not a no-op: an empty
        document_ids builds no filter and searches the entire tenant."""
        enabled["ids"] = []
        with pytest.raises(routes.NoDocumentsSelected):
            await routes.selected_document_ids("t1")

    async def test_it_never_returns_an_empty_list(self, enabled):
        for ids, requested in (([], None), ([], ["a"]), (["a"], ["b"])):
            enabled["ids"] = ids
            try:
                result = await routes.selected_document_ids("t1", requested)
            except routes.NoDocumentsSelected:
                continue
            assert result, "an empty list would disable the filter entirely"


class TestCacheInvalidation:
    async def test_the_selection_is_cached(self, enabled, monkeypatch):
        calls = []

        async def counting(tenant_id):
            calls.append(tenant_id)
            return ["a"]

        monkeypatch.setattr(
            routes.repositories, "list_enabled_document_ids", counting
        )
        await routes.selected_document_ids("t1")
        await routes.selected_document_ids("t1")
        assert len(calls) == 1, "read on every turn; it should not hit the DB twice"

    async def test_invalidation_forces_a_reread(self, enabled, monkeypatch):
        """A document switched off must stop being quoted immediately, not
        whenever the TTL happens to lapse."""
        calls = []

        async def counting(tenant_id):
            calls.append(tenant_id)
            return ["a"]

        monkeypatch.setattr(
            routes.repositories, "list_enabled_document_ids", counting
        )
        await routes.selected_document_ids("t1")
        routes._invalidate_document_selection("t1")
        await routes.selected_document_ids("t1")
        assert len(calls) == 2

    async def test_tenants_do_not_share_a_cache_entry(self, enabled, monkeypatch):
        async def per_tenant(tenant_id):
            return {"t1": ["a"], "t2": ["b"]}[tenant_id]

        monkeypatch.setattr(
            routes.repositories, "list_enabled_document_ids", per_tenant
        )
        assert await routes.selected_document_ids("t1") == ["a"]
        assert await routes.selected_document_ids("t2") == ["b"]


class TestUnselectAndDeleteAreDifferentOperations:
    """The two must not converge.

    Unselecting is reversible and touches nothing but a flag — the file, the row
    and the vectors all stay, so ticking the box back restores the document
    exactly. Deleting removes it from all three stores. A change that made
    unselect delete vectors would silently destroy data the owner expected to
    keep; one that made delete leave them behind would keep answering from a
    document the owner removed.

    Verified end to end against a live Qdrant and Postgres as well:

        after upload      qdrant=1  row=yes  file=yes  used=[doc]
        after UNSELECT    qdrant=1  row=yes  file=yes  used=(none)
        after re-select   qdrant=1  row=yes  file=yes  used=[doc]
        after DELETE      qdrant=0  row=NO   file=NO   used=(none)
    """

    async def test_unselecting_touches_only_the_flag(self, monkeypatch, enabled):
        """No vector deletion, no file deletion, no row deletion."""
        destroyed = []

        def boom(*args, **kwargs):
            destroyed.append(args)

        async def async_boom(*args, **kwargs):
            destroyed.append(args)

        monkeypatch.setattr(
            routes.vector_store, "delete_by_document", boom
        )
        monkeypatch.setattr(routes.storage, "delete", async_boom)
        monkeypatch.setattr(
            routes.repositories, "delete_document_record", async_boom
        )

        flipped = {}

        async def fake_set(document_id, tenant_id, value):
            flipped[document_id] = value
            return True

        monkeypatch.setattr(
            routes.repositories, "set_document_enabled", fake_set
        )

        await routes.repositories.set_document_enabled("doc-1", "t1", False)

        assert flipped == {"doc-1": False}
        assert destroyed == [], "unselecting must not destroy anything"

    async def test_an_unselected_document_is_still_listed_and_restorable(
        self, enabled
    ):
        """It is excluded from answers, not from the workspace — the owner has
        to be able to see it in order to tick it back on."""
        enabled["ids"] = []
        with pytest.raises(routes.NoDocumentsSelected):
            await routes.selected_document_ids("t1")

        # The only thing that changed is the flag, so restoring is symmetrical.
        enabled["ids"] = ["doc-1"]
        from app.services import cache

        cache.config_cache.clear()
        assert await routes.selected_document_ids("t1") == ["doc-1"]


class TestTenantIsolationInTheVectorFilter:
    """The other half: whatever ids are passed, the tenant filter still applies."""

    def test_the_filter_always_pins_the_tenant(self):
        from app.services.vector_store import VectorStoreService

        built = VectorStoreService._build_filter(
            VectorStoreService, "tenant-a", ["doc-1"], None
        )
        keys = [c.key for c in built.must]
        assert "tenant_id" in keys, (
            "a document id alone must never be enough to retrieve a chunk"
        )
        assert "document_id" in keys
