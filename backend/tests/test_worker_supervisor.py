"""The supervisor must not pile up workers it cannot start.

Reproduces a failure seen in development. Voice calls connected and then did
nothing at all — no transcription, no reply, no speech — with no error visible
anywhere in the app.

The cause was a feedback loop between two reasonable-looking decisions:

  - `_worker_alive` treats anything other than HTTP 200 as "no worker". A
    process that is running but not registered with LiveKit answers 503, which
    is therefore indistinguishable from nothing running.
  - the only response to "no worker" was to spawn one. That spawn could not
    bind the health port the unhealthy process still held, so it died on
    startup with WinError 10048.

Nothing observed the crash, so every voice request repeated it: ten dead
processes, one unregistered worker holding the port, and every call joining a
room no agent was ever dispatched to.

The fix is that an occupied port is now a distinct state from a missing worker,
and it stops the spawn instead of triggering it.
"""
import subprocess
from types import SimpleNamespace

import pytest

from app.services.voice import worker_supervisor as sup


@pytest.fixture(autouse=True)
def reset_supervisor_state(monkeypatch):
    """The module keeps process-wide state; each test needs its own."""
    monkeypatch.setattr(sup, "_last_spawn_attempt", 0.0)
    monkeypatch.setattr(sup, "_last_seen_alive", 0.0)
    monkeypatch.setattr(sup, "_spawned", None)
    yield


@pytest.fixture
def spawns(monkeypatch):
    """Record spawn attempts instead of launching anything."""
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


class TestTheCrashLoop:
    async def test_no_spawn_when_the_port_is_held_by_an_unhealthy_worker(
        self, monkeypatch, spawns
    ):
        """The regression. Spawning here can only produce a process that dies
        on startup, which is how ten of them accumulated."""
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)

        await sup.ensure_worker_running(wait_for_ready_s=0.1)

        assert spawns == [], (
            "a new worker cannot bind a port another process holds, so "
            "spawning is futile and must not be attempted"
        )

    async def test_repeated_calls_still_spawn_nothing(self, monkeypatch, spawns):
        """Each voice request calls this. The old code spawned on every one."""
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)

        for _ in range(5):
            await sup.ensure_worker_running(wait_for_ready_s=0.1)

        assert spawns == []

    async def test_the_failure_is_reported_not_silent(self, monkeypatch, spawns, caplog):
        """The original symptom was silence — the app said nothing while every
        call failed, so the log has to name the port and the remedy."""
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=True)

        with caplog.at_level("ERROR"):
            await sup.ensure_worker_running(wait_for_ready_s=0.1)

        assert caplog.records, "a broken voice path must not fail silently"
        message = caplog.text
        assert str(sup._health_port()) in message
        assert "no agent" in message.lower()


class TestNormalOperation:
    async def test_a_healthy_worker_is_left_alone(self, monkeypatch, spawns):
        _health(monkeypatch, healthy=True)
        _port(monkeypatch, occupied=True)

        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == []

    async def test_a_free_port_and_no_worker_does_spawn(self, monkeypatch, spawns):
        """The case the supervisor exists for must keep working."""
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)

        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == [1]

    async def test_a_spawn_already_running_is_not_stacked_on(
        self, monkeypatch, spawns
    ):
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)
        # Still starting: alive, no exit code.
        sup._spawned = SimpleNamespace(pid=1, poll=lambda: None, returncode=None)

        await sup.ensure_worker_running(wait_for_ready_s=0.1)
        assert spawns == []


class TestDetectingAnImmediateExit:
    async def test_a_worker_that_dies_on_startup_is_reported(
        self, monkeypatch, caplog
    ):
        """Waiting out the full deadline to say "still not ready" described the
        symptom and named nothing. The exit code and the log path are what
        actually lead to the cause."""
        _health(monkeypatch, healthy=False)
        _port(monkeypatch, occupied=False)

        def fake_spawn():
            # Exited immediately, the way a failed port bind does.
            sup._spawned = SimpleNamespace(pid=7, poll=lambda: 1, returncode=1)

        monkeypatch.setattr(sup, "_spawn_worker", fake_spawn)

        with caplog.at_level("ERROR"):
            await sup.ensure_worker_running(wait_for_ready_s=5.0)

        assert "exited immediately" in caplog.text
        assert str(sup._LOG_PATH) in caplog.text


class TestPortResolution:
    def test_the_port_comes_from_the_configured_health_url(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "VOICE_WORKER_HEALTH_URL", "http://localhost:9099")
        assert sup._health_port() == 9099

    def test_a_url_without_a_port_falls_back_to_the_default(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "VOICE_WORKER_HEALTH_URL", "http://voice-worker")
        assert sup._health_port() == 8081
