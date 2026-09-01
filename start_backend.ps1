# Start Backend Script for Production RAG System
# Run this script from the project root: .\start_backend.ps1

Write-Host "=== Production RAG System - Backend Startup ===" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "Python not found! Please install Python 3.9+" -ForegroundColor Red
    exit 1
}

# Setup backend — relative to this script's own location, so it works
# regardless of where the repo is cloned.
Set-Location -Path (Join-Path $PSScriptRoot "backend")

# The venv lives at the repo root, not under backend/. This used to look for
# ".\venv" *after* switching into backend/, never find it, and helpfully build a
# second environment there — then install every dependency into it and run the
# server from the wrong one.
$venvPath = Join-Path $PSScriptRoot "venv"
if (-not (Test-Path -Path $venvPath)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv $venvPath
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& (Join-Path $venvPath "Scripts\Activate.ps1")

# Install requirements
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# Check .env file
if (-not (Test-Path -Path ".env")) {
    Write-Host "Creating .env file from example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "IMPORTANT: Edit .env and add your GROQ_API_KEY!" -ForegroundColor Red
    Write-Host "Get your free key at: https://console.groq.com" -ForegroundColor Cyan
}

# Check if Qdrant is accessible
Write-Host "Checking Qdrant connection..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:6333/health" -Method GET -TimeoutSec 5
    Write-Host "Qdrant is running!" -ForegroundColor Green
} catch {
    Write-Host "Qdrant not detected at localhost:6333" -ForegroundColor Yellow
    Write-Host "To install Qdrant:" -ForegroundColor Cyan
    Write-Host "  1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" -ForegroundColor Cyan
    Write-Host "  2. Run: docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant" -ForegroundColor Cyan
    Write-Host "Or use Qdrant Cloud (free tier): https://cloud.qdrant.io" -ForegroundColor Cyan
}

# Bring Redis up before the API server.
#
# Redis holds the working conversation context the LLM is given each turn.
# Without it the app falls back to an in-process dictionary, which is not
# durable, not shared between processes, and silently loses a caller's context
# on every restart — so the assistant forgets what was just said and nothing
# reports why. The compose service is `restart: unless-stopped` with a named
# volume, so this is a no-op once it has been started.
Write-Host "Checking Redis..." -ForegroundColor Yellow
$redisUp = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 6379)
    $redisUp = $tcp.Connected
    $tcp.Close()
} catch { $redisUp = $false }

if ($redisUp) {
    Write-Host "Redis is running!" -ForegroundColor Green
} else {
    Write-Host "Redis not detected at localhost:6379 - starting it via docker compose..." -ForegroundColor Yellow
    try {
        docker compose up -d redis 2>&1 | Out-Null
        if ($?) {
            Start-Sleep -Seconds 3
            Write-Host "Redis started." -ForegroundColor Green
        } else {
            throw "docker compose returned a failure"
        }
    } catch {
        # Not fatal: the app runs without Redis, just degraded. Said plainly
        # rather than left for someone to discover from /health.
        Write-Host "Could not start Redis (is Docker Desktop running?)." -ForegroundColor Red
        Write-Host "The app will still start, but conversation memory will be" -ForegroundColor Yellow
        Write-Host "in-process only and lost on every restart." -ForegroundColor Yellow
        Write-Host "  Start it manually with: docker compose up -d redis" -ForegroundColor Cyan
    }
}

# Stop any voice worker left over from a previous run.
#
# The worker is spawned *detached* on purpose, so it survives uvicorn's
# --reload restarts instead of dying with them (see worker_supervisor.py). The
# cost of that is it also survives your code changes: an old worker keeps
# serving calls with whatever prompt and turn-taking settings it started with,
# which reads as "my fix did nothing". Clearing it here means the next call
# spawns a fresh one on current code.
#
# This lives in the start script rather than the app's own startup hook
# deliberately: with --reload, that hook runs again on every file save, and
# killing the worker mid-call each time you touch a file would be worse than
# the problem it solves. Starting the backend is a thing you do on purpose.
Write-Host "Clearing any stale voice worker..." -ForegroundColor Yellow
$stale = Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
    Where-Object { $_.CommandLine -like '*voice.worker*' }
if ($stale) {
    $stale | ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
    }
    Write-Host "Stopped $($stale.Count) stale worker process(es)." -ForegroundColor Green
} else {
    Write-Host "None running." -ForegroundColor Green
}

# Start the backend
Write-Host ""
Write-Host "Starting FastAPI backend..." -ForegroundColor Green
Write-Host "API docs will be at: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000