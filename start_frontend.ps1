# Start Frontend Script for Production RAG System
# Run this script from the project root: .\start_frontend.ps1

Write-Host "=== Production RAG System - Frontend Startup ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "Found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Node.js not found! Please install Node.js 18+" -ForegroundColor Red
    exit 1
}

# Start frontend — relative to this script's own location, so it works
# regardless of where the repo is cloned.
Set-Location -Path (Join-Path $PSScriptRoot "frontend")

# Check if node_modules exists
if (-not (Test-Path -Path "node_modules")) {
    Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
    npm install
}

# Start the development server
Write-Host ""
Write-Host "Starting Next.js frontend..." -ForegroundColor Green
Write-Host "Frontend will be at: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

npm run dev
