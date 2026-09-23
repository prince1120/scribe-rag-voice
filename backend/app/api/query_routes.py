import asyncio
import hashlib as _hl
import json
import logging
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.api import routes
from app.auth import verify_api_key
from app.config import settings
from app.identity import Identity, get_identity
from app.logging_config import request_id_ctx
from app.models.schemas import QueryRequest, QueryResponse, SourceCitation
from app.rate_limit import limiter
from app.services.guardrails import is_prompt_injection
from app.utils import assign_display_numbers

logger = logging.getLogger(__name__)

router = APIRouter(tags=["query"])


@router.post(
    "/query",
    response_model=QueryResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def query_documents(
    request: Request,
    body: QueryRequest,
    identity: Identity = Depends(get_identity),
    x_custom_llm_base_url: Optional[str] = Header(default=None, alias="X-Custom-LLM-Base-URL"),
    x_custom_llm_key: Optional[str] = Header(default=None, alias="X-Custom-LLM-Key"),
):
    """Query documents with RAG."""
    try:
        start_time = time.time()

        tenant_id = identity.tenant_id
        x_user_groq_key = identity.groq_key

        # Guardrail: direct injection in query — block before retrieval/LLM
        inj = is_prompt_injection(body.query)
        if inj.is_injection:
            logger.warning("blocked injection tenant=%s reason=%s", tenant_id, inj.reason)
            return QueryResponse(
                answer="I can help with your documents, but I can't follow instructions to ignore my guidelines. Try rephrasing your question about the documents.",
                citations=[],
                conversation_id=body.conversation_id or "",
                processing_time_ms=int((time.time() - start_time) * 1000),
                retrieval_ms=0,
            )

        # Get conversation history if available
        conversation_history = None
        if body.conversation_id:
            conversation_history = await run_in_threadpool(
                routes.conversation_service.get_conversation_history, body.conversation_id
            )

        overrides = await routes._chat_overrides(
            identity, x_user_groq_key, x_custom_llm_base_url, x_custom_llm_key
        )

        results = []
        retrieval_ms = 0
        allowed_documents: List[str] = []
        final_top_k = routes._query_aware_top_k(
            body.query, body.top_k, bool(x_user_groq_key), bool(body.attached_images)
        )

        # RAG Fallback: only execute retrieval if chat_rag_enabled is ON
        if overrides.get("chat_rag_enabled"):
            _t = time.time()
            try:
                query_embedding, sparse_query = await asyncio.wait_for(
                    asyncio.gather(
                        run_in_threadpool(routes.embedding_service.encode_query, body.query),
                        run_in_threadpool(routes.sparse_encoder.encode_query, body.query),
                    ),
                    timeout=routes._RAG_TIMEOUT_S,
                )
                has_images_q = bool(body.attached_images)
                final_top_k = routes._query_aware_top_k(
                    body.query, body.top_k, bool(x_user_groq_key), has_images_q
                )

                try:
                    allowed_documents = await routes.selected_document_ids(
                        tenant_id, body.document_ids
                    )
                    raw_results = await asyncio.wait_for(
                        run_in_threadpool(
                            routes.vector_store.search,
                            query_vector=query_embedding,
                            sparse_vector=sparse_query,
                            limit=final_top_k,
                            tenant_id=tenant_id,
                            filters=body.filters,
                            document_ids=allowed_documents,
                        ),
                        timeout=routes._RAG_TIMEOUT_S,
                    )
                    results = assign_display_numbers(raw_results)
                    await routes._resolve_image_paths(results)
                except routes.NoDocumentsSelected:
                    results = []
                    allowed_documents = []
            except (asyncio.TimeoutError, Exception) as exc:
                logger.warning(
                    "Chat retrieval timed out or failed (%s); continuing prompt-only",
                    type(exc).__name__,
                )
                results = []
                allowed_documents = []

            retrieval_ms = int((time.time() - _t) * 1000)

        # Answer cache: repeat FAQs (exact normalized) save full retrieval+LLM cost, 5m TTL
        _norm_q = " ".join((body.query or "").lower().split())
        _model_hash = _hl.sha1((overrides.get("model") or body.model or "").encode()).hexdigest()[:6]
        _temp_hash = str(
            overrides.get("temperature")
            if overrides.get("temperature") is not None
            else (body.temperature if body.temperature is not None else 0.1)
        )
        _agent_hash = _hl.sha1((overrides.get("agent_prompt") or "").encode()).hexdigest()[:12]
        _doc_hash = _hl.sha1(",".join(sorted(allowed_documents or [])).encode()).hexdigest()[:8]
        _cache_key = f"{tenant_id}:{_norm_q}:{final_top_k}:{_model_hash}:{_temp_hash}:{_agent_hash}:{_doc_hash}:{body.conversation_id or ''}"
        _cached = routes._answer_cache_get(tenant_id, _cache_key)
        if _cached and not body.attached_images and not conversation_history:
            answer, citations_cached = _cached
            citations = citations_cached
            llm_ms = 0
        else:
            llm_start = time.time()
            answer = await run_in_threadpool(
                routes.rag_pipeline.generate_response,
                query=body.query,
                context_chunks=results,
                conversation_history=conversation_history,
                attached_images=body.attached_images,
                temperature=(
                    overrides["temperature"]
                    if overrides["temperature"] is not None
                    else (body.temperature if body.temperature is not None else 0.1)
                ),
                max_tokens=overrides["max_tokens"] or body.max_tokens or 800,
                groq_api_key=overrides["groq_api_key"],
                override_model=body.model or overrides["model"],
                custom_base_url=overrides["custom_base_url"],
                custom_api_key=overrides["custom_api_key"],
                agent_prompt=overrides["agent_prompt"],
            )
            llm_ms = int((time.time() - llm_start) * 1000)
            citations = [
                SourceCitation(
                    document_id=r["payload"].get("document_id", ""),
                    filename=r["payload"].get("filename", "Unknown"),
                    chunk_id=r["payload"].get("chunk_id", ""),
                    page_number=r["payload"].get("page_number"),
                    score=r["score"],
                    snippet=r["payload"].get("content", "")[:200] + "..."
                )
                for r in results[:5]
            ]
            if not body.attached_images and not conversation_history:
                routes._answer_cache_set(tenant_id, _cache_key, answer, citations)

        if body.conversation_id:
            await asyncio.gather(
                run_in_threadpool(
                    routes.conversation_service.add_message,
                    body.conversation_id, "user", body.query
                ),
                run_in_threadpool(
                    routes.conversation_service.add_message,
                    body.conversation_id, "assistant", answer,
                    citations=[c.dict() for c in citations]
                ),
                routes.repositories.append_message(
                    body.conversation_id, tenant_id, "user", body.query
                ),
                routes.repositories.append_message(
                    body.conversation_id, tenant_id, "assistant", answer,
                    citations=[c.dict() for c in citations],
                )
            )

        processing_time = int((time.time() - start_time) * 1000)

        return QueryResponse(
            answer=answer,
            citations=citations,
            conversation_id=body.conversation_id or "",
            processing_time_ms=processing_time,
            retrieval_ms=retrieval_ms,
            llm_ms=llm_ms,
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error querying")
        raise HTTPException(status_code=500, detail="Failed to answer the query")


@router.post("/query/stream", dependencies=[Depends(verify_api_key)])
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def query_stream(
    request: Request,
    body: QueryRequest,
    identity: Identity = Depends(get_identity),
    x_custom_llm_base_url: Optional[str] = Header(default=None, alias="X-Custom-LLM-Base-URL"),
    x_custom_llm_key: Optional[str] = Header(default=None, alias="X-Custom-LLM-Key"),
):
    """Stream query response compatible with Vercel AI SDK useChat."""
    try:
        request_start = time.time()

        tenant_id = identity.tenant_id
        x_user_groq_key = identity.groq_key

        inj_s = is_prompt_injection(body.query)
        if inj_s.is_injection:
            logger.warning("blocked injection stream tenant=%s reason=%s", tenant_id, inj_s.reason)
            msg = json.dumps({
                "text": "I can help with your documents, but I can't follow instructions to ignore my guidelines."
            })
            return StreamingResponse(
                iter([f"data: {msg}\n\n", "data: [DONE]\n\n"]),
                media_type="text/event-stream",
            )

        _t = time.time()
        conversation_history = None
        if body.conversation_id:
            conversation_history = await run_in_threadpool(
                routes.conversation_service.get_conversation_history, body.conversation_id
            )
        logger.info(f"[timing] conversation history fetch: {(time.time()-_t)*1000:.0f}ms")

        overrides = await routes._chat_overrides(
            identity, x_user_groq_key, x_custom_llm_base_url, x_custom_llm_key
        )

        results = []
        citations = []
        retrieval_ms = 0

        if overrides.get("chat_rag_enabled"):
            _t = time.time()
            try:
                query_embedding, sparse_query = await asyncio.wait_for(
                    asyncio.gather(
                        run_in_threadpool(routes.embedding_service.encode_query, body.query),
                        run_in_threadpool(routes.sparse_encoder.encode_query, body.query),
                    ),
                    timeout=routes._RAG_TIMEOUT_S,
                )
                has_images_s = bool(body.attached_images)
                final_top_k = routes._query_aware_top_k(
                    body.query, body.top_k, bool(x_user_groq_key), has_images_s
                )

                try:
                    allowed_documents = await routes.selected_document_ids(
                        tenant_id, body.document_ids
                    )
                    raw_results = await asyncio.wait_for(
                        run_in_threadpool(
                            routes.vector_store.search,
                            query_vector=query_embedding,
                            sparse_vector=sparse_query,
                            limit=final_top_k,
                            tenant_id=tenant_id,
                            filters=body.filters,
                            document_ids=allowed_documents,
                        ),
                        timeout=routes._RAG_TIMEOUT_S,
                    )
                    results = assign_display_numbers(raw_results)
                    await routes._resolve_image_paths(results)
                except routes.NoDocumentsSelected:
                    results = []
            except (asyncio.TimeoutError, Exception) as exc:
                logger.warning(
                    "Chat stream retrieval timed out or failed (%s); continuing prompt-only",
                    type(exc).__name__,
                )
                results = []

            retrieval_ms = int((time.time() - _t) * 1000)

        def _build_citation(r):
            payload = r.get("payload") or {}
            full = payload.get("content", "") or ""
            short = (full[:240] + "…") if len(full) > 240 else full
            return {
                "document_id": payload.get("document_id", ""),
                "filename": payload.get("filename", "Unknown"),
                "chunk_id": payload.get("chunk_id", ""),
                "page_number": payload.get("page_number"),
                "chunk_index": payload.get("chunk_index"),
                "score": r.get("score", 0.0),
                "snippet": short,
                "content": full,
                "display_number": r.get("display_number"),
            }

        if results:
            citations = [_build_citation(r) for r in results[:5]]
        else:
            citations = []

        loop = asyncio.get_running_loop()

        def _persist(role: str, content: str, msg_citations: Optional[list] = None):
            if not body.conversation_id:
                return
            loop.run_in_executor(
                None,
                lambda: routes.conversation_service.add_message(
                    body.conversation_id, role, content, citations=msg_citations
                )
            )
            try:
                fut = asyncio.run_coroutine_threadsafe(
                    routes.repositories.append_message(
                        body.conversation_id, tenant_id, role, content,
                        citations=msg_citations,
                    ),
                    loop,
                )

                def _on_done(f: "asyncio.Future[None]") -> None:  # type: ignore[name-defined]
                    try:
                        f.result()
                    except Exception as e:
                        logger.error(f"Failed to persist {role} message: {e}")

                fut.add_done_callback(_on_done)
            except Exception as e:
                logger.error(f"Failed to schedule persist for {role} message: {e}")

        def generate():
            full_response = ""
            first_token_at: Optional[float] = None
            if body.conversation_id:
                _persist("user", body.query)

            try:
                for token in routes.rag_pipeline.generate_streaming_response(
                    query=body.query,
                    context_chunks=results,
                    conversation_history=conversation_history,
                    attached_images=body.attached_images,
                    temperature=(
                        overrides["temperature"]
                        if overrides["temperature"] is not None
                        else (body.temperature if body.temperature is not None else 0.1)
                    ),
                    max_tokens=overrides["max_tokens"] or body.max_tokens or 800,
                    groq_api_key=overrides["groq_api_key"],
                    override_model=body.model or overrides["model"],
                    custom_base_url=overrides["custom_base_url"],
                    custom_api_key=overrides["custom_api_key"],
                    agent_prompt=overrides["agent_prompt"],
                ):
                    if first_token_at is None:
                        first_token_at = time.time()
                    full_response += token
                    data = json.dumps({"text": token})
                    yield f"data: {data}\n\n"
            except Exception:
                logger.exception("Streaming generation failed mid-response")
                error = json.dumps({
                    "error": (
                        "The answer was interrupted. This is usually a rate "
                        "limit or a model timeout — please try again."
                    ),
                    "request_id": request_id_ctx.get(),
                })
                yield f"data: {error}\n\n"
                if body.conversation_id and full_response:
                    _persist("assistant", full_response, citations)
                yield "data: [DONE]\n\n"
                return

            if body.conversation_id:
                _persist("assistant", full_response, citations)

            ttft_ms = int(((first_token_at or time.time()) - request_start) * 1000)
            total_ms = int((time.time() - request_start) * 1000)
            metrics_data = json.dumps({
                "metrics": {"retrieval_ms": retrieval_ms, "ttft_ms": ttft_ms, "total_ms": total_ms}
            })
            yield f"data: {metrics_data}\n\n"

            if citations:
                citation_data = json.dumps({"annotations": citations})
                yield f"data: {citation_data}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error in stream query")
        raise HTTPException(status_code=500, detail="Failed to answer the query")
