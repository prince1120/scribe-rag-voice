#!/usr/bin/env python3
"""Unified One-Command Startup for Production Backend and Voice Worker.

Usage from project root:
    python run_backend.py

This script:
1. Re-executes inside the virtual environment if found (./venv).
2. Verifies backend/.env configuration.
3. Checks / starts dependencies (Redis, Qdrant) if Docker Desktop is running.
4. Auto-clears any stale voice worker processes holding port 8081.
5. Boots FastAPI (Uvicorn) with auto-reload, which automatically supervises
   and reloads the LiveKit Voice Worker process on startup.
"""
import os
import socket
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"


def ensure_venv() -> None:
    """If not running in venv, re-exec with venv python if available."""
    in_venv = (
        sys.prefix != sys.base_prefix
        or "VIRTUAL_ENV" in os.environ
    )
    if in_venv:
        return

    # Look for venv in ROOT_DIR / venv or BACKEND_DIR / venv
    candidates = [
        ROOT_DIR / "venv" / "Scripts" / "python.exe",
        ROOT_DIR / "venv" / "bin" / "python",
        BACKEND_DIR / "venv" / "Scripts" / "python.exe",
        BACKEND_DIR / "venv" / "bin" / "python",
    ]
    for cand in candidates:
        if cand.exists():
            print(f"[run_backend] Switching to virtualenv interpreter: {cand}")
            os.execv(str(cand), [str(cand)] + sys.argv)


def check_port(host: str, port: int, timeout: float = 1.0) -> bool:
    """Check if a network port is accepting connections."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            return s.connect_ex((host, port)) == 0
    except Exception:
        return False


def free_port(port: int) -> None:
    """Auto-terminate any stale process holding the specified port."""
    if not check_port("127.0.0.1", port, timeout=0.3):
        return
    print(f"[run_backend] Port {port} is occupied. Clearing stale process...")
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"], text=True, errors="replace"
            )
            pids = set()
            for line in out.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[3] == "LISTENING" and parts[1].endswith(f":{port}"):
                    try:
                        pid = int(parts[4])
                        if pid > 0 and pid != os.getpid():
                            pids.add(pid)
                    except ValueError:
                        pass
            for pid in pids:
                print(f"[run_backend] Killing PID {pid} on port {port}...")
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
        except Exception as exc:
            print(f"[run_backend] Warning: could not free port {port}: {exc}")
    else:
        try:
            out = subprocess.check_output(
                ["lsof", "-t", f"-i:{port}"], text=True, errors="replace"
            )
            for line in out.split():
                pid = int(line.strip())
                if pid > 0 and pid != os.getpid():
                    os.kill(pid, 9)
        except Exception:
            pass


def main() -> None:
    ensure_venv()

    print("=========================================================")
    print("  Production RAG & Voice Agent - One-Command Launcher    ")
    print("=========================================================")

    # 1. Check environment file
    env_file = BACKEND_DIR / ".env"
    env_example = BACKEND_DIR / ".env.example"
    if not env_file.exists() and env_example.exists():
        print("[run_backend] Creating backend/.env from .env.example...")
        env_file.write_text(env_example.read_text(encoding="utf-8"), encoding="utf-8")
        print("[run_backend] IMPORTANT: Update backend/.env with your API keys!")

    # 2. Check dependencies (Redis & Qdrant)
    redis_ok = check_port("127.0.0.1", 6379)
    qdrant_ok = check_port("127.0.0.1", 6333)

    if not redis_ok or not qdrant_ok:
        print("[run_backend] Checking Docker for Redis/Qdrant services...")
        try:
            subprocess.run(
                ["docker", "compose", "up", "-d", "redis", "qdrant"],
                cwd=str(ROOT_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except Exception:
            pass

    # 3. Clear any stale voice worker port (8081)
    free_port(8081)

    # 4. Start Uvicorn backend in backend directory
    os.chdir(str(BACKEND_DIR))
    sys.path.insert(0, str(BACKEND_DIR))

    print("\n[run_backend] Starting FastAPI Backend + LiveKit Voice Worker...")
    print("[run_backend] API: http://localhost:8000")
    print("[run_backend] Docs: http://localhost:8000/docs")
    print("[run_backend] Press Ctrl+C to stop.\n")

    try:
        import uvicorn
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            reload_dirs=[str(BACKEND_DIR / "app")],
        )
    except KeyboardInterrupt:
        print("\n[run_backend] Shutting down backend cleanly...")
    finally:
        free_port(8081)


if __name__ == "__main__":
    main()
