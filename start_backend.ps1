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

# Check if virtual environment exists
if (-not (Test-Path -Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
.\venv\Scripts\Activate.ps1

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

# Start the backend
Write-Host ""
Write-Host "Starting FastAPI backend..." -ForegroundColor Green
Write-Host "API docs will be at: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
