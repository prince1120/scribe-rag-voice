param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    $match = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=")
    } | Select-Object -First 1
    if (-not $match) { return "" }
    return (($match -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Set-DotEnvValue {
    param([string]$Path, [string]$Name, [string]$Value)
    $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
    $pattern = "^\s*" + [regex]::Escape($Name) + "\s*="
    $replaced = $false
    $updated = foreach ($line in $lines) {
        if (-not $replaced -and $line -match $pattern) {
            $replaced = $true
            "$Name=$Value"
        } else {
            $line
        }
    }
    if (-not $replaced) { $updated += "$Name=$Value" }
    # SlowAPI/Starlette reads dotenv files with the Windows process encoding.
    # Keep comments ASCII-only so UTF-8 punctuation cannot break startup on
    # cp1252 systems. Values are left byte-for-byte unchanged.
    $updated = @($updated | ForEach-Object {
        if ($_.TrimStart().StartsWith("#")) { $_ -replace '[^\x00-\x7F]', '-' } else { $_ }
    })
    Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

function New-Secret([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Is-Placeholder([string]$Value) {
    return [string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)change[_-]?me|placeholder|devsecret'
}

$rootEnv = Join-Path $RepoRoot ".env"
$backendEnv = Join-Path $RepoRoot "backend\.env"

# SESSION_SECRET encrypts saved provider keys. Preserve the backend value and
# copy it to the root so Docker and hybrid deployments decrypt the same data.
$sessionSecret = Get-DotEnvValue $backendEnv "SESSION_SECRET"
if (Is-Placeholder $sessionSecret) { $sessionSecret = New-Secret 48 }

$apiKey = Get-DotEnvValue $backendEnv "API_KEY"
if (Is-Placeholder $apiKey) { $apiKey = Get-DotEnvValue $rootEnv "API_KEY" }
if (Is-Placeholder $apiKey) { $apiKey = New-Secret 32 }

$internalKey = Get-DotEnvValue $backendEnv "INTERNAL_API_KEY"
if (Is-Placeholder $internalKey) { $internalKey = Get-DotEnvValue $rootEnv "INTERNAL_API_KEY" }
if (Is-Placeholder $internalKey) { $internalKey = New-Secret 48 }

$liveKitKey = Get-DotEnvValue $backendEnv "LIVEKIT_API_KEY"
if ((Is-Placeholder $liveKitKey) -or $liveKitKey -eq "devkey") {
    $liveKitKey = "lk_" + (New-Secret 18)
}
$liveKitSecret = Get-DotEnvValue $backendEnv "LIVEKIT_API_SECRET"
if (Is-Placeholder $liveKitSecret) { $liveKitSecret = New-Secret 48 }

foreach ($path in @($rootEnv, $backendEnv)) {
    Set-DotEnvValue $path "DEBUG" "false"
    Set-DotEnvValue $path "SESSION_SECRET" $sessionSecret
    Set-DotEnvValue $path "API_KEY" $apiKey
    Set-DotEnvValue $path "INTERNAL_API_KEY" $internalKey
    Set-DotEnvValue $path "LIVEKIT_API_KEY" $liveKitKey
    Set-DotEnvValue $path "LIVEKIT_API_SECRET" $liveKitSecret
}

Write-Host "Production infrastructure secrets initialized and synchronized (values hidden)." -ForegroundColor Green
Write-Host "Existing provider keys and SESSION_SECRET were preserved." -ForegroundColor Green
