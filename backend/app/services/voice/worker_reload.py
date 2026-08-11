"""The voice worker, restarted automatically when its source changes.

`uvicorn --reload` gives the API server this for free. The voice worker had no
equivalent, and its situation is worse than the API server's: it is spawned
*detached* on purpose (so it survives uvicorn's own reloads), which means it
also survives every edit you make. It keeps serving calls with the prompt and
turn-taking settings it booted with, changes appear to do nothing, and the only
remedy is remembering to kill it by hand.

livekit-agents' own `dev --reload` flag is a no-op in 1.6.6 — it logs
"in-process auto-reload has been removed from the Python CLI; use `lk agent
dev`" and starts normally. Rather than take on the Go CLI as a dependency just
for this, the same job is done here with watchfiles, which is already installed
as a uvicorn dependency and is what uvicorn itself uses.

Development only. Production runs `python -m app.services.voice.worker start`
as its own container (docker-compose's voice-worker service), where a deploy is
what restarts it and a file watcher would be pointless.

    python -m app.services.voice.worker_reload
"""
import logging
from pathlib import Path

from watchfiles import run_process

logger = logging.getLogger(__name__)

# Watch the voice package and the shared prompt rules — the two places whose
# contents a running worker has baked in. Deliberately not the whole app: the
# API server's routes and repositories are reloaded by uvicorn and restarting
# the worker for those would drop live calls for no reason.
_VOICE_DIR = Path(__file__).resolve().parent
_SERVICES_DIR = _VOICE_DIR.parent
_WATCH_PATHS = [str(_VOICE_DIR), str(_SERVICES_DIR / "prompt_rules.py")]


def _run_worker() -> None:
    """Entry point re-invoked in a fresh subprocess on every change.

    Imported inside the function rather than at module scope so each restart
    re-imports the worker and everything it depends on. A top-level import
    would be evaluated once in the parent and inherited unchanged, which is
    exactly the staleness this module exists to prevent.
    """
    import sys

    from app.services.voice.worker import main

    # livekit-agents' CLI parses argv. The parent process was invoked as
    # `-m app.services.voice.worker_reload` with no subcommand, so give the
    # child the one it expects.
    sys.argv = [sys.argv[0], "start"]
    main()


def main() -> None:
    print(f"Voice worker: watching {_VOICE_DIR} for changes (auto-restart on save)")
    run_process(*_WATCH_PATHS, target=_run_worker)


if __name__ == "__main__":
    main()
