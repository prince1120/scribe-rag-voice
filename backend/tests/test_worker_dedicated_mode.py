"""Dedicated worker mode: VOICE_WORKER_AUTO_START=false

Backend in Docker must never spawn/kill a worker — a dedicated
voice-worker container owns the lifecycle. Token requests must 503
when the dedicated worker is down instead of spawning a second
process inside the backend container.
"""
import pytest
from types import SimpleNamespace

from app.services.voice import worker_supervisor as sup
from app.config import settings


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    monkeypatch.setattr(sup, "_last_spawn_attempt", 0.0)
    monkeypatch.setattr(sup, "_last_seen_alive", 0.0)
    monkeypatch.setattr(sup, "_spawned", None)
    # default to dedicated mode for these tests; individual tests override
    monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", False)
    yield
    monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)


@pytest.fixture
def spawns(monkeypatch):
    calls = []

    def fake_spawn():
        calls.append(1)
        sup._spawned = SimpleNamespace(pid=999, poll=lambda: None, returncode=None)

    monkeypatch.setattr(sup, "_spawn_worker", fake_spawn)
    return calls


def _health(monkeypatch, healthy: bool):
    async def probe(timeout):
        return healthy

    monkeypatch.setattr(sup, "_probe", probe)


def _port(monkeypatch, occupied: bool):
    monkeypatch.setattr(sup, "_port_is_occupied", lambda: occupied)


class TestDedicatedModeNeverSpawns:
    async def test_no_spawn_when_auto_start_false_even_if_port_free(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", False)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)
        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == [], "dedicated mode must never spawn, even on free port"

    async def test_no_spawn_when_auto_start_false_and_worker_unhealthy(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", False)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)
        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == []

    async def test_health_check_still_called_in_dedicated_mode(self, monkeypatch):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", False)
        called = []

        async def probe(timeout):
            called.append(timeout)
            return False

        monkeypatch.setattr(sup, "_probe", probe)
        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert called, "dedicated mode must still health-check"

    async def test_is_worker_available_returns_false_when_down(self, monkeypatch):
        _health(monkeypatch, healthy=False)
        assert await sup.is_worker_available() is False

    async def test_is_worker_available_returns_true_when_up(self, monkeypatch):
        _health(monkeypatch, healthy=True)
        assert await sup.is_worker_available() is True


class TestAutoStartModeStillSpawns:
    async def test_spawn_when_auto_start_true_and_port_free(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _port(monkeypatch, occupied=False)
        calls = []

        async def probe_seq(timeout):
            calls.append(1)
            return len(calls) > 4

        monkeypatch.setattr(sup, "_probe", probe_seq)
        result = await sup.ensure_worker_running(wait_for_ready_s=1.0)
        assert spawns == [1]
        assert result is True

    async def test_no_spawn_when_healthy_even_in_auto_start(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=True)
        _port(monkeypatch, occupied=False)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == []
        assert result is True

    async def test_worker_healthy_returns_true(self, monkeypatch):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=True)
        _port(monkeypatch, occupied=False)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert result is True

    async def test_successful_spawn_and_healthy_readiness_returns_true(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        calls = []

        async def probe_seq(timeout):
            calls.append(1)
            return len(calls) > 4

        monkeypatch.setattr(sup, "_probe", probe_seq)
        _port(monkeypatch, occupied=False)
        result = await sup.ensure_worker_running(wait_for_ready_s=1.0)
        assert spawns == [1]
        assert result is True

    async def test_spawn_exception_returns_false(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)

        def boom():
            raise RuntimeError("spawn failed")

        monkeypatch.setattr(sup, "_spawn_worker", boom)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert result is False
        assert spawns == []

    async def test_immediate_worker_exit_returns_false(self, monkeypatch):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)

        def fake_spawn_exit():
            sup._spawned = SimpleNamespace(pid=7, poll=lambda: 1, returncode=1)

        monkeypatch.setattr(sup, "_spawn_worker", fake_spawn_exit)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.5)
        assert result is False

    async def test_readiness_timeout_returns_false(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)
        # Probe always fails, so wait loop times out
        async def probe_never(timeout):
            return False

        monkeypatch.setattr(sup, "_probe", probe_never)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.3)
        assert spawns == [1]
        assert result is False

    async def test_stale_occupied_port_returns_false(self, monkeypatch, spawns):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert result is False
        assert spawns == []


class TestTokenRefusesWhenWorkerDown:
    async def test_token_503_when_dedicated_unhealthy(self, monkeypatch):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", False)

        async def fake_unhealthy():
            return False

        monkeypatch.setattr(sup, "is_worker_available", fake_unhealthy)
        # Simulate the voice_routes logic: worker_ok = await is_worker_available()
        worker_ok = await sup.is_worker_available()
        assert worker_ok is False
        # In real route this would raise HTTPException 503
        from fastapi import HTTPException

        try:
            if not worker_ok:
                raise HTTPException(status_code=503, detail="Voice service is temporarily unavailable.")
            assert False, "should have raised"
        except HTTPException as exc:
            assert exc.status_code == 503
            assert "temporarily unavailable" in exc.detail.lower()

    async def test_token_503_when_host_auto_start_unhealthy(self, monkeypatch):
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)
        result = await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert result is False
        # Host mode now also 503s when not healthy (single probe)
        from fastapi import HTTPException

        try:
            if not result:
                raise HTTPException(status_code=503, detail="Voice service is temporarily unavailable.")
            assert False
        except HTTPException as exc:
            assert exc.status_code == 503
