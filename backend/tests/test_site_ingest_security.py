"""Regression tests for the website-import SSRF boundary."""
import httpx
import pytest

from app.services import site_ingest


@pytest.mark.asyncio
async def test_website_import_rejects_private_resolved_addresses(monkeypatch):
    async def resolve_private(_host, _port):
        return {"127.0.0.1"}

    monkeypatch.setattr(site_ingest, "_resolve_host", resolve_private)
    with pytest.raises(ValueError, match="not crawlable"):
        await site_ingest._validate_public_url("https://example.test/manuals")


@pytest.mark.asyncio
async def test_website_import_validates_redirect_before_following_it(monkeypatch):
    async def resolve_public(host, _port):
        return {"127.0.0.1"} if host == "127.0.0.1" else {"93.184.216.34"}

    async def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"})

    monkeypatch.setattr(site_ingest, "_resolve_host", resolve_public)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="not crawlable"):
            await site_ingest._fetch_public(
                client, "https://example.test/", origin="https://example.test"
            )


def test_sitemap_urls_must_match_the_exact_origin():
    assert site_ingest._same_origin("https://example.com/manual", "https://example.com")
    assert not site_ingest._same_origin("https://example.com.evil.test/manual", "https://example.com")
    assert not site_ingest._same_origin("https://example.com/manual", "http://example.com")
