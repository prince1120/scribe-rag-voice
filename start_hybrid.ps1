# Hybrid startup - Windows host runs backend/frontend, Docker runs infra only
# Usage: .\start_hybrid.ps1  (from repo root)
# Never starts Docker app containers (backend/voice-worker/frontend in Docker).
$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$ProjectName = "scribe"
Write-Host "=== Scribe Hybrid - Windows + Docker Infra ===" -ForegroundColor Cyan
# 1. Docker available
Write-Host "`n[1/7] Checking Docker..." -ForegroundColor Yellow
try { docker --version | Out-Null; docker compose version | Out-Null } catch {
    Write-Host "Docker not found. Install Docker Desktop." -ForegroundColor Red; exit 1
}
Write-Host "Docker OK" -ForegroundColor Green
# 2. Port checks - fail clearly if occupied, never kill unknown
$required = @(
    @{ Port=55432; Name="PostgreSQL (hybrid)" },
    @{ Port=6479;  Name="Redis (hybrid)" },
    @{ Port=6433;  Name="Qdrant HTTP (hybrid)" },
    @{ Port=7880;  Name="LiveKit WS" },
    @{ Port=7881;  Name="LiveKit ICE TCP" },
    @{ Port=8000;  Name="Backend (host)" },
    @{ Port=3100;  Name="Frontend (host)" },
    @{ Port=8081;  Name="Voice worker health" }
)
$occupied = @()
foreach ($r in $required) {
    $c = Get-NetTCPConnection -LocalPort $r.Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $occupied += "$($r.Name) :$($r.Port) is already listening (PID $($c.OwningProcess) $($proc.ProcessName)). Stop the holder or change SCRIBE_*_PORT in .env."
    }
}
$udp = Get-NetUDPEndpoint -LocalPort 7882 -ErrorAction SilentlyContinue
if ($udp) {
    Write-Host "Note: UDP 7882 appears in use (LiveKit UDP mux). If scribe-livekit is already running this is expected." -ForegroundColor Yellow
}
if ($occupied.Count -gt 0) {
    $scribeRunning = (docker ps --format "{{.Names}}" 2>$null | Select-String "scribe-")
    if (-not $scribeRunning) {
        Write-Host "`nPort conflict - refusing to kill unknown processes:" -ForegroundColor Red
        $occupied | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        Write-Host "Free the ports or set SCRIBE_*_PORT in .env, then retry. Never run docker compose down -v." -ForegroundColor Cyan
        exit 1
    }
}
# 3. Env templates - copy if missing, never overwrite real .env
if (-not (Test-Path "$RepoRoot\.env")) {
    if (Test-Path "$RepoRoot\.env.selfhost.example") {
        Copy-Item "$RepoRoot\.env.selfhost.example" "$RepoRoot\.env"
        Write-Host "Created .env from .env.selfhost.example - edit it and replace CHANGE_ME." -ForegroundColor Yellow
    }
}
if (-not (Test-Path "$RepoRoot\backend\.env")) {
    if (Test-Path "$RepoRoot\backend\.env.hybrid.example") {
        Copy-Item "$RepoRoot\backend\.env.hybrid.example" "$RepoRoot\backend\.env"
        Write-Host "Created backend\.env from backend\.env.hybrid.example - edit CHANGE_ME." -ForegroundColor Yellow
    } elseif (Test-Path "$RepoRoot\backend\.env.example") {
        Copy-Item "$RepoRoot\backend\.env.example" "$RepoRoot\backend\.env"
        Write-Host "Created backend\.env from example." -ForegroundColor Yellow
    }
}
Write-Host "Using root .env and backend\.env as-is (not overwriting)." -ForegroundColor Green
. (Join-Path $RepoRoot "infra\Set-HybridEnvironment.ps1")
Set-ScribeHybridEnvironment -RepoRoot $RepoRoot
# 4. Start Docker infra only (4 services) - never backend/frontend/voice-worker in Docker
Write-Host "`n[2/7] Starting Docker infrastructure (postgres, redis, qdrant, livekit)..." -ForegroundColor Yellow
$composeFiles = @("-f", "docker-compose.yml", "-f", "docker-compose.dev.yml")
docker compose --project-name $ProjectName @composeFiles config --quiet
if ($LASTEXITCODE -ne 0) { Write-Host "Compose config invalid - check .env." -ForegroundColor Red; exit 1 }
docker compose --project-name $ProjectName @composeFiles up -d postgres redis qdrant livekit
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to start infra." -ForegroundColor Red; exit 1 }
# 5. Wait for healthy (max 90s)
Write-Host "`n[3/7] Waiting for infra to become healthy (max 90s)..." -ForegroundColor Yellow
$healthy = @("scribe-postgres-1","scribe-redis-1","scribe-qdrant-1","scribe-livekit-1")
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    $allHealthy = $true
    foreach ($c in $healthy) {
        $status = docker inspect --format "{{.State.Health.Status}}" $c 2>$null
        if ($status -ne "healthy") { $allHealthy = $false; break }
    }
    if ($allHealthy) { break }
    Start-Sleep -Seconds 3
}
docker compose --project-name $ProjectName ps
foreach ($c in $healthy) {
    $s = docker inspect --format "{{.State.Health.Status}}" $c 2>$null
    Write-Host "  $c : $s" -ForegroundColor $(if ($s -eq "healthy") { "Green" } else { "Yellow" })
}
if (-not $allHealthy) { Write-Host "Some services not healthy after 90s - check logs." -ForegroundColor Yellow }
# 6. Backend on Windows (port 8000 unless occupied)
Write-Host "`n[4/7] Starting backend on Windows (host)..." -ForegroundColor Yellow
$backendPort = 8000
if (Get-NetTCPConnection -LocalPort $backendPort -ErrorAction SilentlyContinue) {
    Write-Host "Port $backendPort occupied - failing. Free it or set different port. Not killing unknown process." -ForegroundColor Red
    Get-NetTCPConnection -LocalPort $backendPort | Format-Table LocalAddress,LocalPort,OwningProcess
    exit 1
}
$backendPath = Join-Path $RepoRoot "backend"
$venvPath = Join-Path $RepoRoot "venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "Existing venv not found at $venvPath. Create it first, then run this script again." -ForegroundColor Red
    exit 1
}
Write-Host "Using existing venv (dependency installation skipped)." -ForegroundColor Green
$backendCmd = "Set-Location '$backendPath'; & '$RepoRoot\venv\Scripts\Activate.ps1'; uvicorn app.main:app --host 127.0.0.1 --port $backendPort --reload"
Write-Host "Launching backend: $backendCmd" -ForegroundColor Cyan
Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command", $backendCmd -WorkingDirectory $RepoRoot
# 7. Frontend on Windows (port 3100)
Write-Host "`n[5/7] Starting frontend on Windows (host)..." -ForegroundColor Yellow
$frontendPort = 3100
if (Get-NetTCPConnection -LocalPort $frontendPort -ErrorAction SilentlyContinue) {
    Write-Host "Port $frontendPort occupied - frontend not started. Free it and run .\start_frontend.ps1" -ForegroundColor Yellow
} else {
    $frontendCmd = "Set-Location '$RepoRoot\frontend'; if (-not (Test-Path 'node_modules')) { npm install }; npm run dev -- --port $frontendPort --hostname 127.0.0.1"
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command", $frontendCmd -WorkingDirectory $RepoRoot
    Write-Host "Launching frontend on http://127.0.0.1:$frontendPort" -ForegroundColor Cyan
}
# 8. Worker - host auto-start via backend
Write-Host "`n[6/7] Voice worker: host backend will auto-spawn one Windows worker when needed (VOICE_WORKER_AUTO_START=true)." -ForegroundColor Yellow
Write-Host "No Docker voice-worker container should be running in hybrid" -ForegroundColor Cyan
# 9. URLs (no secrets)
Write-Host "`n[7/7] Hybrid stack ready (infra + host apps):" -ForegroundColor Green
Write-Host "  Frontend:  http://127.0.0.1:3100" -ForegroundColor Cyan
Write-Host "  Backend:   http://127.0.0.1:8000/docs  (health: http://127.0.0.1:8000/api/v1/health)" -ForegroundColor Cyan
Write-Host "  LiveKit:   ws://127.0.0.1:7880  (browser)  |  ws://livekit:7880 (inside Docker, not for browser)" -ForegroundColor Cyan
Write-Host "  Postgres:  127.0.0.1:55432 (Docker: postgres:5432)" -ForegroundColor Cyan
Write-Host "  Qdrant:    http://127.0.0.1:6433" -ForegroundColor Cyan
Write-Host "`nTo stop only Scribe (keeps volumes):" -ForegroundColor Yellow
Write-Host "  docker compose --project-name scribe -f docker-compose.yml -f docker-compose.dev.yml down" -ForegroundColor Cyan
Write-Host "  # then close the backend/frontend PowerShell windows" -ForegroundColor Cyan
Write-Host "`nNever run: docker compose down -v  (deletes volumes) | docker volume rm" -ForegroundColor Red
