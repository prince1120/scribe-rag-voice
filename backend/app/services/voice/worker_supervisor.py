"""On-demand voice worker launcher.

The worker is normally meant to be started once and left running (see
worker.py's docstring, and the docker-compose `voice-worker` service for
production). For local dev, though, remembering to open a second terminal
for it is friction — this lets `POST /voice/token` (fired the moment someone
clicks "Start conversation") make sure a worker is actually up first,
spawning one in the background if it isn't.

Every call goes through a real health check against the worker's HTTP port
rather than trusting in-process state, so this stays correct across
uvicorn --reload restarts (which would otherwise wipe any "already
spawned" flag and cause a duplicate worker on the next reload).
"""
import asyncio
import logging
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Guards against launching a second worker if several calls start within the
# same short window while the first spawn is still coming up (health checks
# won't go green until it finishes registering with LiveKit, ~1-2s).
_SPAWN_COOLDOWN_S = 15.0
_last_spawn_attempt: float = 0.0
_spawn_lock = asyncio.Lock()

# How long a successful health check is trusted for. Within this window a
# token request skips the check entirely.
#
# This exists because the check is not free and, worse, is not reliable while a
# call is in progress: the worker serves its health endpoint from the same
# asyncio loop that is streaming STT, LLM and TTS for a live session, so under
# load it can miss a 1.5s deadline while being perfectly healthy. The old code
# read that timeout as "worker is dead", spawned a second one, and then blocked
# the token response for up to 8s waiting for the spawn — turning a busy worker
# into a ten-second wait before the caller heard anything.
_ALIVE_TRUST_S = 30.0
_last_seen_alive: float = 0.0

_BACKEND_DIR = Path(__file__).resolve().parents[3]  # .../backend
_LOG_PATH = _BACKEND_DIR / "voice_worker.log"

# The last process we launched. Kept so a spawn that died on startup can be
# reported, and so we never stack a second spawn on top of one still running.
_spawned: "subprocess.Popen | None" = None


def _health_port() -> int:
    """The port the worker's health server binds."""
    parsed = urlparse(settings.VOICE_WORKER_HEALTH_URL)
    return parsed.port or 8081


def _port_is_occupied() -> bool:
    """Whether anything at all holds the worker's health port.

    This is the signal the supervisor was missing. `_worker_alive` asks "does
    the health endpoint return 200", so a worker that is running but *not
    registered with LiveKit* — which answers 503 — is indistinguishable from no
    worker at all. The supervisor concluded "dead" and spawned a replacement,
    which could not bind the port the old one still held, so it crashed on
    startup with WinError 10048 and left nothing behind but a log line.

    Nothing noticed, so every voice request repeated it. The observed result was
    ten crash-looping processes, one unregistered worker squatting the port, and
    calls that connected to a room no agent ever joined: no STT, no TTS, no LLM,
    and no error anywhere the caller could see.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        # A successful connect means something is listening. Checked against
        # loopback rather than 0.0.0.0 because that is where the worker's health
        # server is reached, and where a stale one would still answer.
        return probe.connect_ex(("127.0.0.1", _health_port())) == 0


async def _probe(timeout: float) -> bool:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(settings.VOICE_WORKER_HEALTH_URL.rstrip("/") + "/")
        return resp.status_code == 200
    except Exception:
        return False


async def _worker_alive(*, trust_cache: bool = True) -> bool:
    """Whether a worker is up, biased against false negatives.

    A false negative here is expensive — it spawns a redundant process and
    makes the caller wait out the readiness loop before their call can start —
    while a false positive costs nothing: the call proceeds and fails through
    the existing "assistant isn't responding" path if there really is no
    worker. So this trusts a recent success, and retries once before concluding
    the worker is gone.
    """
    global _last_seen_alive

    now = time.monotonic()
    if trust_cache and now - _last_seen_alive < _ALIVE_TRUST_S:
        return True

    if await _probe(1.5):
        _last_seen_alive = time.monotonic()
        return True

    # One retry. The first miss is usually a busy event loop mid-call, not a
    # dead process, and the retry costs nothing when the worker really is gone.
    await asyncio.sleep(0.25)
    if await _probe(2.5):
        _last_seen_alive = time.monotonic()
        return True
    return False


def _spawn_worker() -> None:
    """Launch the voice worker fully detached — not a child of this (possibly
    --reload-managed) process — so it keeps running across backend
    restarts/reloads instead of dying with them.

    Spawned via `worker_reload`, which watches the voice package and restarts
    the worker when a file changes — the same thing `uvicorn --reload` does for
    the API server. That matters more here than it looks: being detached is
    what makes the worker outlive every edit, so without this it keeps serving
    calls with the settings it booted with and changes appear to do nothing.

    Production does not use this path at all. There the worker is its own
    container running `start` (see docker-compose.yml's voice-worker service),
    and a deploy is what restarts it. The watcher is only ever reached through
    this auto-spawn, which exists so local development doesn't need a second
    terminal.
    """
    log_file = open(_LOG_PATH, "a", encoding="utf-8")
    creationflags = 0
    if sys.platform == "win32":
        # CREATE_NO_WINDOW (not DETACHED_PROCESS): on Windows 11 with Windows
        # Terminal set as the default terminal app, DETACHED_PROCESS alone no
        # longer suppresses the console — a visible (blank) window still gets
        # allocated for this console-subsystem python.exe. CREATE_NO_WINDOW is
        # the flag that actually guarantees no window, while
        # CREATE_NEW_PROCESS_GROUP still keeps it surviving the parent
        # exiting/reloading and not being killed by Ctrl+C in this console.
        creationflags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    global _spawned
    _spawned = subprocess.Popen(
        [sys.executable, "-m", "app.services.voice.worker_reload"],
        cwd=str(_BACKEND_DIR),
        stdout=log_file,
        stderr=log_file,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
        start_new_session=(sys.platform != "win32"),
    )
    logger.info("Spawned voice worker pid=%s (logs: %s)", _spawned.pid, _LOG_PATH)


async def is_worker_available() -> bool:
    """Pure health-check — never spawns. Used in dedicated-worker mode."""
    return await _worker_alive()


async def ensure_worker_running(wait_for_ready_s: float = 8.0) -> bool:
    """If the worker isn't answering its health check, start
    one and wait briefly for it to finish registering with LiveKit before
    returning — so the token this request is about to issue has an agent
    actually available to pick up the dispatched job, instead of racing it.

    In dedicated-worker mode (VOICE_WORKER_AUTO_START=false) this function
    MUST NOT spawn, kill or replace any process. It may only health-check
    and return True/False — token issuance will 503 on False.

    Never raises. Returns True only after a worker actually reports healthy;
    callers must refuse to create a session when False is returned. This keeps
    a missing worker from becoming a connected room with a silent assistant.
    """
    if not settings.VOICE_WORKER_AUTO_START:
        # Dedicated mode: never spawn. One probe only.
        return await _worker_alive()

    global _last_spawn_attempt, _last_seen_alive

    started = time.monotonic()
    if await _worker_alive():
        return True

    just_spawned = False
    async with _spawn_lock:
        # Re-check inside the lock — another request may have just spawned it.
        # Ignore the cache here: we already failed two probes to get this far,
        # so the question is whether the *other* request's spawn has come up.
        if await _worker_alive(trust_cache=False):
            return True

        # Never terminate a process based only on its port. It may be unrelated
        # to this repository, and even a stale repo worker is safer to diagnose
        # explicitly than to kill from an HTTP request handler.
        if await asyncio.to_thread(_port_is_occupied):
            logger.error(
                "Voice worker health port %d is occupied but not healthy; "
                "no agent is available. Stop the owning process manually or "
                "configure a different VOICE_WORKER_HEALTH_URL.",
                _health_port(),
            )
            return False

        # A previous spawn is still running — do not stack, but wait for it
        # to become healthy instead of assuming it is.
        waiting_for_existing = False
        if _spawned is not None and _spawned.poll() is None:
            logger.info("A voice worker spawn is still starting; waiting for it.")
            waiting_for_existing = True

        now = time.monotonic()
        if waiting_for_existing:
            just_spawned = True
        elif now - _last_spawn_attempt < _SPAWN_COOLDOWN_S:
            # Cool-down: a spawn was just attempted from another request.
            # Do not spawn again; report not yet healthy.
            logger.info("Voice worker spawn cool-down active; not spawning another.")
            return False
        else:
            _last_spawn_attempt = now
            try:
                _spawn_worker()
                just_spawned = True
            except Exception:
                logger.exception("Could not auto-start the voice worker")
                return False

        if not just_spawned and not waiting_for_existing:
            return False

        deadline = time.monotonic() + wait_for_ready_s
        while time.monotonic() < deadline:
            if await _probe(1.0):
                _last_seen_alive = time.monotonic()
                logger.info(
                    "Voice worker is up and registered (%.1fs)", time.monotonic() - started
                )
                return True

            if _spawned is not None and _spawned.poll() is not None:
                logger.error(
                    "The voice worker exited immediately (code %s). Calls will "
                    "connect to a room with no agent in it — no speech, no reply. "
                    "The reason is at the end of %s.",
                    _spawned.returncode, _LOG_PATH,
                )
                return False
            await asyncio.sleep(0.2)
        logger.warning("Voice worker still not ready after %.0fs — not healthy", wait_for_ready_s)
        return False
