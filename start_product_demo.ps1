# Product QR internal demo: web-only on this Windows computer.
# Docker starts infrastructure only; backend/frontend/worker stay on Windows.
$ErrorActionPreference = "Stop"
$env:PRODUCT_QR_ENABLED = "true"
& (Join-Path $PSScriptRoot "start_hybrid.ps1")
