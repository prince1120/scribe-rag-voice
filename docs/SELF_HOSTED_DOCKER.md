# Hybrid Local Infrastructure — Scribe (port-safe, M0.2)

> **Goal:** run PostgreSQL 16, Redis 7, Qdrant **v1.15.1**, and self-hosted LiveKit **v1.9.1** in Docker while FastAPI, the voice worker, and Next.js run directly on Windows. This stage supports browser voice sessions on the same computer only.

Pinned versions (tested 2026-09-08, recorded here):
- `postgres:16-alpine`, `redis:7-alpine`, `qdrant/qdrant:v1.15.1`, `livekit/livekit-server:v1.9.1`, `python:3.11-slim` (backend), `node:20-alpine` (frontend)

## Current founder architecture: hybrid Windows + Docker infrastructure

> **Founder decision (M0.2):** Docker runs **only** `postgres, redis, qdrant, livekit` (4 services). **Frontend (Next.js) and FastAPI backend + voice worker run directly on Windows** (`127.0.0.1:3100` and `127.0.0.1:8000`). No backend/frontend image is built or started in Docker. Another agent owns frontend work; Product QR M1 not authorized.

- `docker compose up -d` **without** `--profile docker-app` now starts **only** the 4 infra services (verified `docker compose --project-name scribe ps` shows 4, no `scribe-backend-1`). The `docker-app` profile (`backend, voice-worker, frontend` have `profiles: ["docker-app"]`) is **not used** by the founder — documented here for future `docker compose --profile docker-app up -d --build`.
- Hybrid loopback ports (non-conflicting, `127.0.0.1`): `55432→postgres:5432`, `6479→redis:6379`, `6433→qdrant:6333`, `6434→qdrant:6334`, `7880/7881/tcp` + `7882/udp` LiveKit. Main `docker-compose.yml` keeps postgres/redis/qdrant **private**; `docker-compose.dev.yml` (used as hybrid override) exposes them on those loopback ports.
- Windows host connects to infra via `127.0.0.1:55432` etc (`backend/.env.hybrid.example`: `DATABASE_URL=postgresql+asyncpg://scribe:CHANGE_ME@127.0.0.1:55432/scribe`, `REDIS_HOST=127.0.0.1`, `QDRANT_HOST=127.0.0.1`, `LIVEKIT_URL=ws://127.0.0.1:7880`, `LIVEKIT_PUBLIC_URL=ws://127.0.0.1:7880`). These addresses intentionally remain localhost-only.

---

## 1. Local vs production — choose one

### Local (Windows/macOS laptop, Docker Desktop)

- **Bind:** all host-exposed ports on `127.0.0.1` (see `docker-compose.yml` `127.0.0.1:${PORT}:…`) where Docker Desktop supports it. UDP 7882 still needs host firewall allow.
- **Credentials:** `DEBUG=true` is allowed; `SESSION_SECRET`, `GROQ_API_KEY` may be dummy for infra-only bring-up. Placeholders like `scribe_secret_change_me` are **clearly marked** in `.env.selfhost.example`.
- **Network:** `ws://localhost:7880` for browser, `ws://livekit:7880` inside Compose.

### Production (public)

- **Do NOT use this Windows Compose stack as a production host.** Recommended: Linux VM (Hetzner/DigitalOcean/GCP) with Docker + Compose, Caddy/Traefik for TLS.
- `DEBUG=false`, `SESSION_SECRET` must be a real `secrets.token_urlsafe(48)` value — backend refuses to boot with placeholder or empty when `DEBUG=false` (`backend/app/config.py:225`).
- `.env` **required**, no fallback `DATABASE_URL`; secure cookies (`Secure`, `HttpOnly` already in `session.py:108` when `DEBUG=false`).
- **TLS/WSS:** browser must receive `wss://voice.yourdomain.com`, never `ws://`. Terminate TLS at Caddy/Traefik/Cloudflare Tunnel with valid cert, proxy to `livekit:7880`.
- **Firewall:** open `7880/tcp` (signaling), `7881/tcp` (ICE TCP), `7882/udp` (media), `443/tcp` for frontend/backend. `Test-NetConnection` **does not prove UDP** (see §9).
- **Costs:** self-hosted software is free (LiveKit/Qdrant/Postgres), but a future public web deployment still has infrastructure, bandwidth, domain, and TLS costs.

---

## 2. Required environment file

```bash
cp .env.selfhost.example .env
# Fill every *_CHANGE_ME / devkey. Never commit .env (git check-ignore proves it).
# Generate:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"  # SESSION_SECRET, 64 chars
#   openssl rand -hex 32                                           # LIVEKIT_API_SECRET (≥32 chars)
#   openssl rand -hex 16                                           # POSTGRES_PASSWORD  (encode if contains @:/?#)
```

**Critical sync:**
- `POSTGRES_PASSWORD` and `DATABASE_URL` must match. Compose defaults `DATABASE_URL` from `POSTGRES_*`, but if you set `DATABASE_URL` explicitly, URL-encode special chars: `@→%40` `:→%3A` `/→%2F`. Already documented in `.env.selfhost.example:5`.
- `BACKEND_API_KEY` **must equal** `API_KEY` — Next.js proxy forwards `BACKEND_API_KEY` as `X-API-Key` (`frontend/app/api/v1/[...path]/route.ts:58`). Mismatch → every frontend request `401`.
- `LIVEKIT_API_KEY/SECRET` must match `LIVEKIT_KEYS` seen by `livekit` service (`LIVEKIT_KEYS="API_KEY: SECRET"` with space).

---

## 3. Hybrid startup — Windows host + Docker infra (current founder architecture)

> **Do NOT run `docker compose up -d --build` for the full app.** That would build/start `backend/voice-worker/frontend` inside Docker. Founder runs those on Windows directly.

`start_hybrid.ps1` and `start_backend.ps1` load provider credentials from the existing ignored `backend/.env`, but override database, Redis, Qdrant, and LiveKit endpoints in the launched process so they always use the local Docker infrastructure. They do not rewrite or expose the real `.env` files.

### Windows — PowerShell (copy-paste, primary)

```powershell
# 0. Env — copy hybrid template (preserves real keys: never overwrite existing .env)
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.hybrid.example backend\.env }
# Edit backend\.env and .env: replace every CHANGE_ME, set POSTGRES_PASSWORD, SESSION_SECRET, LIVEKIT_API_SECRET
# Generate (PowerShell):
python -c "import secrets; print(secrets.token_urlsafe(48))"  # SESSION_SECRET
# Verify .env is ignored:
git check-ignore -v backend\.env  # → backend/.env  (ignored ✓)
git check-ignore -v .env          # → .env

# 1. Ports — fail if occupied (never kill unknown)
Get-NetTCPConnection -LocalPort 55432,6479,6433,7880,7881,3100,8000,8081 -ErrorAction SilentlyContinue | Format-Table LocalAddress,LocalPort,OwningProcess
# Must be free (or already held by scribe-* after start). If occupied, free it or set SCRIBE_*_PORT.

# 2. Validate compose (no start, no build)
docker compose --project-name scribe config --quiet; if ($LASTEXITCODE -eq 0) { Write-Host "compose valid ✓" }

# 3. Infra only — 4 containers, loopback ports via dev override
docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis qdrant livekit
docker compose --project-name scribe ps  # expect 4 scribe-* healthy, no scribe-backend/frontend

# 4. Health (max 90s)
docker inspect --format '{{.State.Health.Status}}' scribe-postgres-1
docker inspect --format '{{.State.Health.Status}}' scribe-livekit-1  # → healthy
Invoke-RestMethod http://127.0.0.1:6433/healthz | Out-Null; Write-Host "Qdrant OK"

# 5. Backend on Windows (uses backend\.env hybrid — VOICE_WORKER_AUTO_START=true)
.\start_backend.ps1        # → http://127.0.0.1:8000/docs  (checks 55432/6479/6433/7880)

# 6. Frontend on Windows
.\start_frontend.ps1       # → http://127.0.0.1:3100  (checks 3100 free, BACKEND_ORIGIN http://127.0.0.1:8000)

# Or one command for both:
.\start_hybrid.ps1         # does 1-6, prints URLs, never starts Docker app containers
```

### Linux — bash (same hybrid, if you run host backend on Linux)

```bash
# Env
cp backend/.env.hybrid.example backend/.env  # then edit CHANGE_ME
# Ports
ss -tulpn | grep -E '55432|6479|6433|7880|3100|8000' || echo "free"
docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml config --quiet && echo "compose valid"
docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis qdrant livekit
docker compose --project-name scribe ps  # 4 healthy, no backend/frontend
# Backend/frontend on host (Linux):
# python -m venv venv && source venv/bin/activate && pip install -r backend/requirements.txt
# uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload  &  (from backend/)
# cd frontend && npm install && npm run dev -- --port 3100 --hostname 127.0.0.1
```

### Startup — Windows (PowerShell, copy-paste) — localhost web-only

```powershell
# 0. Docker + ports (localhost web only)
docker --version; docker compose version
docker ps --format "table {{.Names}}\t{{.Ports}}"
Get-NetTCPConnection -LocalPort 7880,7881,3100,8000 -ErrorAction SilentlyContinue | Format-Table LocalAddress,LocalPort,State
if (-not (Get-NetTCPConnection -LocalPort 7880 -ErrorAction SilentlyContinue)) { Write-Host "7880 free ✓" }
# UDP 7882: no Test-NetConnection UDP proof needed for localhost web — browser call is the proof

# 1. Env template (hybrid)
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.hybrid.example backend\.env }
# Edit backend\.env and .env: replace CHANGE_ME
# Generate (PowerShell):
python -c "import secrets; print(secrets.token_urlsafe(48))"
# Validate compose (infra only — no app containers)
docker compose --project-name scribe config --quiet; if ($LASTEXITCODE -eq 0) { Write-Host "compose valid ✓" }
docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml config --quiet

# 2. Infra only — 4 containers, no backend/frontend in Docker
docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis qdrant livekit
Start-Sleep -Seconds 20; docker compose --project-name scribe ps  # expect 4 healthy, no scribe-backend-1
```

Compose project `scribe` → volumes `scribe_postgres_data` etc, network `scribe_net`, no `container_name` → `scribe-postgres-1` namespaced, never touches `langfuse-*`.

---

## 4. Service URLs — localhost web-only (LiveKit 127.0.0.1 is correct)

| Service | Inside Compose | From host (hybrid) |
|---|---|---|
| frontend (Windows) | — | `http://127.0.0.1:3100` |
| backend (Windows) | — | `http://127.0.0.1:8000` (`/docs`, `/api/v1/health`) |
| postgres | `postgres:5432` | `127.0.0.1:55432` via dev override (private `scribed_net`) |
| redis | `redis:6379` | `127.0.0.1:6479` |
| qdrant | `http://qdrant:6333` | `http://127.0.0.1:6433` / gRPC `127.0.0.1:6434` |
| livekit internal | `ws://livekit:7880` | — |
| livekit browser | — | `ws://127.0.0.1:7880` (web, localhost only) |
| voice-worker health | `http://voice-worker:8081` | via `http://127.0.0.1:8000/api/v1/voice/health` |

Browser token (`POST /api/v1/voice/token`) returns `ws://127.0.0.1:7880`, never `ws://livekit:7880` (fixed via `LIVEKIT_PUBLIC_URL`). This stage is browser/web only; LiveKit's `127.0.0.1` binding is intentional.

---

## 5. Health — Linux vs Windows

### Linux

```bash
docker compose --project-name scribe ps
docker inspect --format '{{.State.Health.Status}}' scribe-postgres-1 scribe-redis-1 scribe-qdrant-1 scribe-livekit-1 scribe-backend-1
curl -f http://127.0.0.1:8100/api/v1/health | jq
curl -f http://127.0.0.1:8100/api/v1/voice/health   # → {"available":true} when voice-worker healthy
docker compose --project-name scribe exec postgres psql -U scribe -d scribe -c "SELECT 1"
docker compose --project-name scribe exec redis redis-cli ping  # → PONG
docker compose --project-name scribe exec qdrant sh -c "timeout 2 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/6333' && echo ok"
```

### Windows (PowerShell)

```powershell
docker compose --project-name scribe ps
docker inspect --format '{{.State.Health.Status}}' scribe-postgres-1
docker inspect --format '{{.State.Health.Status}}' scribe-livekit-1
Invoke-RestMethod http://127.0.0.1:8100/api/v1/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8100/api/v1/voice/health | ConvertTo-Json
docker compose --project-name scribe exec postgres psql -U scribe -d scribe -c "SELECT 1"
docker compose --project-name scribe exec redis redis-cli ping
# Qdrant TCP (PowerShell has no /dev/tcp; use Test-NetConnection for TCP only):
Test-NetConnection 127.0.0.1 -Port 6333   # TcpTestSucceeded must be True
# LiveKit UDP: Test-NetConnection does NOT prove UDP — must do a real browser call (see §9).
```

---

## 6. Logs & single-service restart (both OS)

```bash
# Linux
docker compose --project-name scribe logs -f backend
docker compose --project-name scribe logs -f livekit voice-worker
docker compose --project-name scribe logs --tail=200 qdrant
docker compose --project-name scribe restart backend
docker compose --project-name scribe up -d --no-deps --build backend
```

```powershell
# Windows PowerShell
docker compose --project-name scribe logs -f backend
docker compose --project-name scribe logs -f livekit --tail 100
docker compose --project-name scribe restart frontend
docker compose --project-name scribe up -d --no-deps --build backend
```

**Never** `docker compose down -v` or `docker volume rm` — deletes `scribe_*`. Use `docker compose --project-name scribe down` (keeps volumes). Always include `--project-name scribe` to avoid touching `langfuse-*` or other projects; never `docker stop $(docker ps -q)`.

---

## 7. Switch back to LiveKit Cloud

```bash
# .env:
LIVEKIT_URL=wss://your-subdomain.livekit.cloud
LIVEKIT_PUBLIC_URL=wss://your-subdomain.livekit.cloud
LIVEKIT_API_KEY=APIxxxx
LIVEKIT_API_SECRET=secret
# Then:
docker compose --project-name scribe stop livekit
# or up without livekit:
docker compose --project-name scribe up -d backend frontend qdrant redis postgres voice-worker
```

---

## 8. Backup — PostgreSQL & Qdrant

```bash
# Linux
docker compose --project-name scribe exec postgres pg_dump -U scribe scribe > scribe_$(date +%F).sql
# Windows PowerShell
docker compose --project-name scribe exec postgres pg_dump -U scribe scribe > scribe_$(Get-Date -Format yyyy-MM-dd).sql
# With dev expose, also works from host:
# psql postgresql://scribe:pass@127.0.0.1:55432/scribe -c "\l"
# Qdrant snapshot (inside network):
docker compose --project-name scribe exec qdrant sh -c "ls /qdrant/storage/snapshots"
# Restore:
Get-Content scribe.sql | docker compose --project-name scribe exec -T postgres psql -U scribe scribe
```

Schedule dumps before any `down` or host reboot.

---

## 9. Networking — localhost web-only (this stage)

- Browser (`http://127.0.0.1:3100`), backend (`http://127.0.0.1:8000`), and LiveKit (`ws://127.0.0.1:7880`) all on `127.0.0.1` is **correct** for this localhost web stage.
- LiveKit is bound `127.0.0.1:7880/tcp`, `127.0.0.1:7881/tcp`, `127.0.0.1:7882/udp` (see Compose). `Test-NetConnection 127.0.0.1 -Port 7880` proves TCP; UDP media is only proven by a real browser call on the same host.
- Verify in a browser tab on the same host: open `http://127.0.0.1:3100/t/<token>`, start a voice session, and check `SignalPill` plus the LiveKit logs.

---

## 10. Public deployment — what local Docker is NOT

Local `ws://127.0.0.1:7880` and `127.0.0.1:3100` are loopback only. A future public browser deployment requires separate security and infrastructure work: a public domain, TLS/WSS, firewall configuration, off-host backups, monitoring, and real secrets. **Costs apply** even though LiveKit, Qdrant, and PostgreSQL are open-source.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` | `SCRIBE_*_PORT` in `.env`; `docker compose --project-name scribe config \| grep published` |
| `DATABASE_URL is not postgresql://` | `DATABASE_URL=postgresql+asyncpg://scribe:pass@postgres:5432/scribe` or `SCRIBE_ALLOW_SQLITE=true` for throwaway tests only |
| Frontend `Backend unreachable` | `docker compose --project-name scribe ps` → backend healthy; `BACKEND_ORIGIN=http://backend:8000` not `localhost` |
| Browser token `ws://livekit:7880` | `LIVEKIT_PUBLIC_URL` missing — set to `ws://127.0.0.1:7880`, restart host backend |
| Qdrant unhealthy | `docker compose --project-name scribe logs qdrant`; `exec qdrant sh -c 'timeout 2 bash -c ... 6333'` must exit 0; check `scribe_qdrant_storage` not full |
| LiveKit unhealthy | `docker compose --project-name scribe logs livekit` — check `LIVEKIT_KEYS` 32-char, `redis:6379` reachable |
