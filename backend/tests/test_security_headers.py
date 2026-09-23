import asyncio

from starlette.requests import Request
from starlette.responses import Response

from app.api.middleware.security_headers import SecurityHeadersMiddleware
from app.api.routes import _INLINE_MEDIA_TYPES


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )


def test_uploaded_active_document_formats_are_not_served_as_executable_content():
    assert _INLINE_MEDIA_TYPES[".html"].startswith("text/plain")
    assert _INLINE_MEDIA_TYPES[".svg"].startswith("text/plain")


def test_api_responses_receive_a_restrictive_content_security_policy():
    middleware = SecurityHeadersMiddleware(app=lambda scope, receive, send: None)

    async def next_response(_: Request) -> Response:
        return Response("{}", media_type="application/json")

    response = asyncio.run(middleware.dispatch(_request("/api/v1/documents/a/file"), next_response))

    assert response.headers["content-security-policy"] == (
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )


def test_non_api_pages_do_not_receive_the_api_only_content_security_policy():
    middleware = SecurityHeadersMiddleware(app=lambda scope, receive, send: None)

    async def next_response(_: Request) -> Response:
        return Response("ok")

    response = asyncio.run(middleware.dispatch(_request("/docs"), next_response))

    assert "content-security-policy" not in response.headers
