# Start Frontend - Windows host (hybrid)
# Run from repo root: .\start_frontend.ps1
# Frontend on Windows 127.0.0.1:3100, proxy to backend 127.0.0.1:8000
Write-Host "=== Scribe Frontend - Windows host ===" -ForegroundColor Cyan
try { $v = node --version 2>&1; Write-Host "Found: $v" -ForegroundColor Green } catch { Write-Host "Node.js not found!" -ForegroundColor Red; exit 1 }
Set-Location -Path (Join-Path $PSScriptRoot "frontend")
if (-not (Test-Path "node_modules")) { Write-Host "Installing deps..." -ForegroundColor Yellow; npm install }
if (Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue) {
    Write-Host "Port 3100 is already in use. Free it or change SCRIBE_FRONTEND_PORT. Not killing unknown." -ForegroundColor Red
    Get-NetTCPConnection -LocalPort 3100 | Format-Table LocalAddress,LocalPort,OwningProcess
    exit 1
}
Write-Host "Starting Next.js on http://127.0.0.1:3100 (hybrid, BACKEND_ORIGIN http://127.0.0.1:8000)" -ForegroundColor Green
try { Invoke-RestMethod http://127.0.0.1:8000/api/v1/health -TimeoutSec 2 | Out-Null; Write-Host "Backend reachable." -ForegroundColor Green } catch { Write-Host "Backend not yet reachable at 127.0.0.1:8000 - start it first: .\start_backend.ps1" -ForegroundColor Yellow }
npm run dev -- --port 3100 --hostname 127.0.0.1
