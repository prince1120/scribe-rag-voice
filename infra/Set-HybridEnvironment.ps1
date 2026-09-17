function Get-ScribeDotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = ""
    )

    if (-not (Test-Path -LiteralPath $Path)) { return $Default }
    $prefix = "^\s*" + [Regex]::Escape($Name) + "\s*=\s*(.*)\s*$"
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*#" -or [string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -match $prefix) {
            $value = $Matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $Default
}

function Set-ScribeHybridEnvironment {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $rootEnv = Join-Path $RepoRoot ".env"
    $dbUser = Get-ScribeDotEnvValue -Path $rootEnv -Name "POSTGRES_USER" -Default "scribe"
    $dbName = Get-ScribeDotEnvValue -Path $rootEnv -Name "POSTGRES_DB" -Default "scribe"
    $dbPassword = Get-ScribeDotEnvValue -Path $rootEnv -Name "POSTGRES_PASSWORD" -Default "scribe_secret_change_me"
    $encodedPassword = [Uri]::EscapeDataString($dbPassword)

    # These process-level values intentionally override cloud endpoints from
    # backend/.env only for a hybrid run. Provider credentials remain loaded
    # from backend/.env and that file is never rewritten.
    $env:DATABASE_URL = "postgresql+asyncpg://${dbUser}:${encodedPassword}@127.0.0.1:55432/$dbName"
    $env:REDIS_HOST = "127.0.0.1"
    $env:REDIS_PORT = "6479"
    $env:QDRANT_HOST = "127.0.0.1"
    $env:QDRANT_PORT = "6433"
    $env:QDRANT_API_KEY = ""
    $env:QDRANT_HTTPS = "false"
    $env:LIVEKIT_URL = "ws://127.0.0.1:7880"
    $env:LIVEKIT_PUBLIC_URL = "ws://127.0.0.1:7880"
    $env:LIVEKIT_API_KEY = Get-ScribeDotEnvValue -Path $rootEnv -Name "LIVEKIT_API_KEY" -Default "devkey"
    $env:LIVEKIT_API_SECRET = Get-ScribeDotEnvValue -Path $rootEnv -Name "LIVEKIT_API_SECRET" -Default "scribe_dev_secret_32_chars_min_12345"
    $env:VOICE_WORKER_HEALTH_URL = "http://127.0.0.1:8081"
    $env:VOICE_WORKER_AUTO_START = "true"
    $env:DEBUG = "true"

    Write-Host "Hybrid process endpoints set to local Docker infrastructure (credentials hidden)." -ForegroundColor Green
}
