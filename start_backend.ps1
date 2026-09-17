# Start Backend - Windows host (hybrid: Docker infra only)
# Run from repo root: .\start_backend.ps1
# Backend runs on Windows (127.0.0.1:8000), infra (postgres/redis/qdrant/livekit) in Docker.
Write-Host "=== Scribe Backend - Windows host ===" -ForegroundColor Cyan
try { $v = python --version 2>&1; Write-Host "Found: $v" -ForegroundColor Green } catch { Write-Host "Python not found!" -ForegroundColor Red; exit 1 }
Set-Location -Path (Join-Path $PSScriptRoot "backend")
$venvPath = Join-Path $PSScriptRoot "venv"
if (-not (Test-Path $venvPath)) { Write-Host "Creating venv..." -ForegroundColor Yellow; python -m venv $venvPath }
Write-Host "Activating venv..." -ForegroundColor Yellow
& (Join-Path $venvPath "Scripts\Activate.ps1")
Write-Host "Installing deps (cached)..." -ForegroundColor Yellow
pip install -r requirements.txt --quiet
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.hybrid.example") {
        Copy-Item ".env.hybrid.example" ".env"
        Write-Host "Created .env from .env.hybrid.example - edit CHANGE_ME!" -ForegroundColor Yellow
    } elseif (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example" -ForegroundColor Yellow
    }
}
. (Join-Path $PSScriptRoot "infra\Set-HybridEnvironment.ps1")
Set-ScribeHybridEnvironment -RepoRoot $PSScriptRoot
if (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue) {
    Write-Host "Port 8000 is already in use. Free it or change port. Not killing unknown process." -ForegroundColor Red
    Get-NetTCPConnection -LocalPort 8000 | Format-Table LocalAddress,LocalPort,OwningProcess
    exit 1
}
Write-Host "Checking infra (hybrid)..." -ForegroundColor Yellow
$checks = @(
    @{ Name="Postgres 127.0.0.1:55432"; Test={ Test-NetConnection 127.0.0.1 -Port 55432 -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded } },
    @{ Name="Redis 127.0.0.1:6479"; Test={ try { $c=New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1",6479); $c.Connected } catch { $false } } },
    @{ Name="Qdrant http://127.0.0.1:6433/healthz"; Test={ try { Invoke-RestMethod http://127.0.0.1:6433/healthz -TimeoutSec 2 | Out-Null; $true } catch { $false } } },
    @{ Name="LiveKit ws://127.0.0.1:7880"; Test={ Test-NetConnection 127.0.0.1 -Port 7880 -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded } }
)
foreach ($c in $checks) {
    $ok = & $c.Test
    Write-Host ("  {0}: {1}" -f $c.Name, $(if ($ok) { "OK" } else { "NOT REACHABLE - start infra: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis qdrant livekit" })) -ForegroundColor $(if ($ok) { "Green" } else { "Yellow" })
}
Write-Host "Checking voice worker health port..." -ForegroundColor Yellow
$repoPath = $PSScriptRoot
$port8081 = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($port8081) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($port8081.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.CommandLine -like "*$repoPath*" -and $owner.CommandLine -like "*voice*worker*") {
        Write-Host "Existing Scribe voice worker found on 8081 (PID $($port8081.OwningProcess)); leaving it running." -ForegroundColor Green
    } elseif ($owner) {
        Write-Host "Port 8081 is occupied by PID $($port8081.OwningProcess) ($($owner.CommandLine)) - not our worker, not killing. Free it manually or change VOICE_WORKER_HEALTH_URL port." -ForegroundColor Yellow
    } else {
        Write-Host "Port 8081 is listening (PID $($port8081.OwningProcess)) - unknown owner, not killing." -ForegroundColor Yellow
    }
} else {
    Write-Host "Port 8081 is free; the backend will start the worker on demand." -ForegroundColor Green
}
Write-Host "`nStarting FastAPI on http://127.0.0.1:8000/docs (hybrid, VOICE_WORKER_AUTO_START=true)" -ForegroundColor Green
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
