from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, MatchAny,
    PayloadSchemaType,
    SparseVectorParams, SparseIndexParams, SparseVector,
    Prefetch, FusionQuery, Fusion,
)
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Named vector keys used in the collection schema
DENSE_NAME = "dense"
SPARSE_NAME = "sparse"


class VectorStoreService:
    """Hybrid vector store: dense (semantic) + sparse (BM25) with RRF fusion."""

    def __init__(self, host: str = "localhost", port: int = 6333,
                 collection_name: str = "documents", vector_size: int = 384,
                 api_key: str = ""):
        if api_key:
            # An API key means Qdrant Cloud — those endpoints are TLS-only.
            # Plain HTTP against a cloud host returns a bare 404 (from the
            # front proxy, not Qdrant itself) and crashes startup.
            self.client = QdrantClient(host=host, port=port, api_key=api_key, https=True, timeout=60.0)
        else:
            self.client = QdrantClient(host=host, port=port, timeout=60.0)
        self.collection_name = collection_name
        self.vector_size = vector_size
        self._ready = False
        # A hybrid search submits two tasks (dense + sparse), so a pool of 2 was
        # saturated by a single concurrent query — the second user's dense and
        # sparse lookups queued behind the first user's instead of running in
        # parallel, which is the entire point of the pool. Sized for ~8
        # concurrent searches; the work is I/O-bound on Qdrant, so threads here
        # are cheap.
        self._search_executor = ThreadPoolExecutor(
            max_workers=16, thread_name_prefix="qdrant-search"
        )
        self._init_collection()

    def _ensure_ready(self):
        """Retry connecting if startup init failed (e.g. Qdrant was down or
        misconfigured when the app booted) instead of staying broken until
        the next full restart."""
        if not self._ready:
            self._init_collection()
        if not self._ready:
            raise RuntimeError(
                "Vector store is unavailable — check QDRANT_HOST/QDRANT_PORT/"
                "QDRANT_API_KEY and that the Qdrant instance is reachable."
            )

    def _init_collection(self):
        """Create or migrate collection to hybrid (dense + sparse) layout.

        Does NOT raise on connection failure — a Qdrant outage at boot
        shouldn't crash the entire API process (uploads/health/etc for other
        components would otherwise become unreachable too). Callers that
        actually need the vector store go through `_ensure_ready()`, which
        surfaces a clear error at the point of use instead.
        """
        try:
            collections = self.client.get_collections()
            existing = {c.name for c in collections.collections}

            if self.collection_name in existing:
                info = self.client.get_collection(self.collection_name)
                vectors_cfg = info.config.params.vectors
                sparse_cfg = info.config.params.sparse_vectors

                is_hybrid = (
                    isinstance(vectors_cfg, dict)
                    and DENSE_NAME in vectors_cfg
                    and sparse_cfg is not None
                    and SPARSE_NAME in sparse_cfg
                )
                if is_hybrid:
                    logger.info(f"Hybrid collection ready: {self.collection_name}")
                    self._ensure_payload_indexes()
                    self._ready = True
                    return

                # Legacy single-vector collection — recreate for hybrid.
                logger.warning(
                    f"Collection '{self.collection_name}' is not hybrid. "
                    f"Recreating with dense+sparse vectors. Existing data will be lost — "
                    f"please re-upload your documents."
                )
                self.client.delete_collection(self.collection_name)

            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config={
                    DENSE_NAME: VectorParams(
                        size=self.vector_size,
                        distance=Distance.COSINE,
                    )
                },
                sparse_vectors_config={
                    SPARSE_NAME: SparseVectorParams(
                        index=SparseIndexParams(on_disk=False)
                    )
                },
            )
            logger.info(f"Created hybrid collection: {self.collection_name}")
            self._ensure_payload_indexes()
            self._ready = True

        except Exception as e:
            self._ready = False
            logger.error(
                f"Could not reach Qdrant collection '{self.collection_name}': {e}. "
                "The API will still start, but search/upload will fail until this is fixed."
            )

    def _ensure_payload_indexes(self):
        """Create keyword payload indexes required for filtering."""
        for field in ("tenant_id", "document_id"):
            try:
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name=field,
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                logger.info(f"Created payload index on '{field}'")
            except Exception as e:
                logger.debug(f"Payload index on '{field}' not created (likely exists): {e}")

    def upsert_points(self, points: List[Dict[str, Any]]):
        """Insert or update points. Each point must provide:
            id, payload, dense_vector, sparse_vector={'indices': [...], 'values': [...]}
        """
        self._ensure_ready()
        try:
            point_structs = []
            for p in points:
                sparse = p["sparse_vector"]
                point_structs.append(
                    PointStruct(
                        id=p["id"],
                        vector={
                            DENSE_NAME: p["dense_vector"],
                            SPARSE_NAME: SparseVector(
                                indices=sparse["indices"],
                                values=sparse["values"],
                            ),
                        },
                        payload=p["payload"],
                    )
                )
            self.client.upsert(
                collection_name=self.collection_name,
                points=point_structs,
            )
            logger.info(f"Upserted {len(points)} points (hybrid)")
        except Exception as e:
            logger.error(f"Error upserting points: {e}")
            raise

    def search(self, query_vector: List[float],
               sparse_vector: Optional[Dict] = None,
               limit: int = 10,
               tenant_id: Optional[str] = None,
               filters: Optional[Dict] = None,
               document_ids: Optional[List[str]] = None,
               prefetch_limit: int = 50,
               rrf_k: int = 60) -> List[Dict]:
        """Hybrid search: run dense and sparse queries separately, then fuse
        the two ranked lists ourselves with Reciprocal Rank Fusion — rather
        than Qdrant's server-side Prefetch+FusionQuery. Falls back to
        dense-only if no sparse vector is supplied.
        """
        self._ensure_ready()
        try:
            import time as _time
            query_filter = self._build_filter(tenant_id, document_ids, filters)
            has_sparse = bool(sparse_vector and sparse_vector.get("indices"))

            def _dense():
                t0 = _time.time()
                pts = self.client.query_points(
                    collection_name=self.collection_name,
                    query=query_vector,
                    using=DENSE_NAME,
                    limit=prefetch_limit if has_sparse else limit,
                    query_filter=query_filter,
                    with_payload=True,
                ).points
                logger.info(f"[timing] qdrant dense query: {(_time.time()-t0)*1000:.0f}ms ({len(pts)} pts)")
                return pts

            if not has_sparse:
                dense_results = _dense()
                return [{"id": r.id, "score": r.score, "payload": r.payload} for r in dense_results[:limit]]

            def _sparse():
                t0 = _time.time()
                pts = self.client.query_points(
                    collection_name=self.collection_name,
                    query=SparseVector(
                        indices=sparse_vector["indices"],
                        values=sparse_vector["values"],
                    ),
                    using=SPARSE_NAME,
                    limit=prefetch_limit,
                    query_filter=query_filter,
                    with_payload=True,
                ).points
                logger.info(f"[timing] qdrant sparse query: {(_time.time()-t0)*1000:.0f}ms ({len(pts)} pts)")
                return pts

            # Dense and sparse queries are independent — run them concurrently
            # instead of paying two sequential round trips to Qdrant.
            t_wall = _time.time()
            dense_future = self._search_executor.submit(_dense)
            sparse_future = self._search_executor.submit(_sparse)
            dense_results = dense_future.result()
            sparse_results = sparse_future.result()
            logger.info(f"[timing] qdrant both queries wall time: {(_time.time()-t_wall)*1000:.0f}ms")

            return self._fuse_rrf(dense_results, sparse_results, limit, rrf_k)
        except Exception as e:
            logger.error(f"Error searching: {e}")
            raise

    @staticmethod
    def _fuse_rrf(dense_results, sparse_results, limit: int, k: int = 60) -> List[Dict]:
        """Reciprocal Rank Fusion: score = sum(1 / (k + rank)) across each
        ranked list a point appears in. Standard choice, k=60 per the
        original RRF paper — large enough that fusion isn't dominated by
        whichever list happens to rank something #1.
        """
        scores: Dict[Any, float] = {}
        payloads: Dict[Any, Any] = {}
        for result_list in (dense_results, sparse_results):
            for rank, point in enumerate(result_list, start=1):
                scores[point.id] = scores.get(point.id, 0.0) + 1.0 / (k + rank)
                payloads.setdefault(point.id, point.payload)

        ranked_ids = sorted(scores.keys(), key=lambda pid: scores[pid], reverse=True)[:limit]
        return [
            {"id": pid, "score": scores[pid], "payload": payloads[pid]}
            for pid in ranked_ids
        ]

    def _build_filter(self, tenant_id, document_ids, filters):
        conditions = []
        if tenant_id:
            conditions.append(
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
            )
        if document_ids:
            conditions.append(
                FieldCondition(
                    key="document_id",
                    match=MatchAny(any=list(document_ids)),
                )
            )
        if filters:
            for key, value in filters.items():
                conditions.append(
                    FieldCondition(key=key, match=MatchValue(value=value))
                )
        return Filter(must=conditions) if conditions else None

    def delete_by_document(self, document_id: str, tenant_id: str):
        """Delete all chunks for a specific document."""
        self._ensure_ready()
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="document_id",
                            match=MatchValue(value=document_id),
                        ),
                        FieldCondition(
                            key="tenant_id",
                            match=MatchValue(value=tenant_id),
                        ),
                    ]
                ),
            )
            logger.info(f"Deleted document: {document_id}")
        except Exception as e:
            logger.error(f"Error deleting document: {e}")
            raise

    def get_collection_info(self):
        return self.client.get_collection(self.collection_name)

    def get_document_chunks(self, document_id: str, tenant_id: str) -> List[Dict]:
        """Fetch all chunks for a document, ordered by chunk_index. Used to
        recover current content for documents with no editable source file
        on disk (e.g. images — only their OCR'd chunk text is editable)."""
        self._ensure_ready()
        points, _ = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=self._build_filter(tenant_id, [document_id], None),
            limit=1000,
            with_payload=True,
        )
        ordered = sorted(points, key=lambda p: (p.payload or {}).get("chunk_index", 0))
        return [
            {
                "chunk_index": (p.payload or {}).get("chunk_index", 0),
                "content": (p.payload or {}).get("content", ""),
            }
            for p in ordered
        ]