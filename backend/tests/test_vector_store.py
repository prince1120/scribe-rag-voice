from types import SimpleNamespace
from unittest.mock import patch

from app.services.vector_store import VectorStoreService


def _point(id_, payload=None):
    return SimpleNamespace(id=id_, payload=payload or {})


class TestFuseRRF:
    def test_point_in_both_lists_ranks_above_single_list_points(self):
        dense = [_point("a"), _point("b"), _point("c")]
        sparse = [_point("b"), _point("d"), _point("a")]

        fused = VectorStoreService._fuse_rrf(dense, sparse, limit=10)
        ids = [r["id"] for r in fused]

        # "a" and "b" appear in both lists at good ranks — should beat
        # "c"/"d" which only appear once.
        assert set(ids[:2]) == {"a", "b"}

    def test_respects_limit(self):
        dense = [_point(str(i)) for i in range(10)]
        sparse = []
        fused = VectorStoreService._fuse_rrf(dense, sparse, limit=3)
        assert len(fused) == 3

    def test_empty_lists_return_empty(self):
        assert VectorStoreService._fuse_rrf([], [], limit=10) == []

    def test_payload_preserved(self):
        dense = [_point("a", {"content": "hello"})]
        fused = VectorStoreService._fuse_rrf(dense, [], limit=10)
        assert fused[0]["payload"] == {"content": "hello"}

    def test_scores_are_higher_for_better_average_rank(self):
        # "a" is rank 1 in both lists; "z" is rank 1 in only one list.
        dense = [_point("a"), _point("z")]
        sparse = [_point("a")]
        fused = VectorStoreService._fuse_rrf(dense, sparse, limit=10)
        scores = {r["id"]: r["score"] for r in fused}
        assert scores["a"] > scores["z"]


class TestQdrantTransport:
    @patch.object(VectorStoreService, "_init_collection")
    @patch("app.services.vector_store.QdrantClient")
    def test_local_host_is_http_even_when_cloud_key_is_stale(self, client, _init):
        VectorStoreService(
            host="127.0.0.1",
            port=6433,
            api_key="stale-cloud-key",
        )

        client.assert_called_once_with(
            host="127.0.0.1",
            port=6433,
            https=False,
            timeout=60.0,
        )

    @patch.object(VectorStoreService, "_init_collection")
    @patch("app.services.vector_store.QdrantClient")
    def test_explicit_local_http_overrides_stale_cloud_key(self, client, _init):
        VectorStoreService(
            host="127.0.0.1",
            port=6433,
            api_key="stale-cloud-key",
            https=False,
        )

        client.assert_called_once_with(
            host="127.0.0.1",
            port=6433,
            https=False,
            timeout=60.0,
        )

    @patch.object(VectorStoreService, "_init_collection")
    @patch("app.services.vector_store.QdrantClient")
    def test_cloud_key_still_enables_tls_by_default(self, client, _init):
        VectorStoreService(
            host="cloud.qdrant.io",
            port=6333,
            api_key="cloud-key",
        )

        client.assert_called_once_with(
            host="cloud.qdrant.io",
            port=6333,
            https=True,
            timeout=60.0,
            api_key="cloud-key",
        )
