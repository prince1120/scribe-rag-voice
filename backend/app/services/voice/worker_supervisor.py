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
import subprocess
import sys
import time
from pathlib import Path

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Guards against launching a second worker if several calls start within the
# same short window while the first spawn is still coming up (health checks
# won't go green until it finishes registering with LiveKit, ~1-2s).
_SPAWN_COOLDOWN_S = 15.0
_last_spawn_attempt: float = 0.0
_spawn_lock = asyncio.Lock()

_BACKEND_DIR = Path(__file__).resolve().parents[3]  # .../backend
_LOG_PATH = _BACKEND_DIR / "voice_worker.log"


async def _worker_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(settings.VOICE_WORKER_HEALTH_URL.rstrip("/") + "/")
        return resp.status_code == 200
    except Exception:
        return False


def _spawn_worker() -> None:
    """Launch `python -m app.services.voice.worker start` fully detached —
    not a child of this (possibly --reload-managed) process — so it keeps
    running across backend restarts/reloads instead of dying with them."""
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
    subprocess.Popen(
        [sys.executable, "-m", "app.services.voice.worker", "start"],
        cwd=str(_BACKEND_DIR),
        stdout=log_file,
        stderr=log_file,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
        start_new_session=(sys.platform != "win32"),
    )
    logger.info("Spawned voice worker (logs: %s)", _LOG_PATH)


async def ensure_worker_running(wait_for_ready_s: float = 8.0) -> None:
    """Best-effort: if the worker isn't answering its health check, start
    one and wait briefly for it to finish registering with LiveKit before
    returning — so the token this request is about to issue has an agent
    actually available to pick up the dispatched job, instead of racing it.

    Never raises — a call should still be attempted (and fail with the
    existing "assistant isn't responding" path) even if this can't launch
    the worker for some reason (e.g. permissions, missing venv)."""
    global _last_spawn_attempt

    if await _worker_alive():
        return

    just_spawned = False
    async with _spawn_lock:
        # Re-check inside the lock — another request may have just spawned it.
        if await _worker_alive():
            return
        now = time.monotonic()
        if now - _last_spawn_attempt < _SPAWN_COOLDOWN_S:
            # A spawn is already in flight from a near-simultaneous request —
            # fall through to the wait loop below instead of spawning again.
            pass
        else:
            _last_spawn_attempt = now
            try:
                _spawn_worker()
                just_spawned = True
            except Exception:
                logger.exception("Could not auto-start the voice worker")
                return

    if not just_spawned:
        return

    deadline = time.monotonic() + wait_for_ready_s
    while time.monotonic() < deadline:
        if await _worker_alive():
            logger.info("Voice worker is up and registered")
            return
        await asyncio.sleep(0.5)
    logger.warning("Voice worker still not ready after %.0fs — proceeding anyway", wait_for_ready_s)
