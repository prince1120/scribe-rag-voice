"""Observe httpcore without recording URLs, headers, payloads or errors."""
import time
import uuid

import httpx

from app.services.voice.latency import emit, milliseconds


class ObservedClient(httpx.AsyncClient):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.transport_id = uuid.uuid4().hex

    async def send(self, request, **kwargs):
        started = time.perf_counter()
        spans = {}
        timings = {}

        async def trace(event, info):
            name, _, state = event.rpartition(".")
            if state == "started":
                spans[name] = time.perf_counter()
            elif state in ("complete", "failed") and name in spans:
                timings[name] = milliseconds(time.perf_counter() - spans.pop(name))
            # Never serialize info: it may contain credentials and response text.

        request.extensions["trace"] = trace
        record = {"request_id": uuid.uuid4().hex, "transport_id": self.transport_id,
                  "http_version": None, "alpn": None}
        try:
            response = await super().send(request, **kwargs)
            record["http_version"] = response.http_version
            record["provider_request_id"] = response.headers.get("x-request-id")
            stream = response.extensions.get("network_stream")
            ssl = stream.get_extra_info("ssl_object") if stream else None
            record["alpn"] = ssl.selected_alpn_protocol() if ssl else None
            return response
        finally:
            emit("llm_transport", **record,
                 request_to_headers_ms=milliseconds(time.perf_counter() - started),
                 dns_tcp_ms=timings.get("connection.connect_tcp"),
                 tls_ms=timings.get("connection.start_tls"),
                 trace_ms=timings)


def observed_client(*, http2=False):
    # Match the installed LiveKit defaults exactly during Phase 1.
    return ObservedClient(
        http2=http2,
        timeout=httpx.Timeout(connect=15, read=5, write=5, pool=5),
        follow_redirects=True,
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=50, keepalive_expiry=120),
    )
