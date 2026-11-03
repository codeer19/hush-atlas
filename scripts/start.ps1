#requires -Version 5.1
<#
.SYNOPSIS
  Start Hush Atlas locally.

.DESCRIPTION
  Serves the built frontend and the API from one loopback-only FastAPI process
  over trusted HTTPS. The first analysis loads YAMNet into memory, which can
  take a few seconds.

  The certificate is created by mkcert and trusted for the current Windows user.
  Run .\scripts\setup-https.ps1 once if Windows asks you to approve the local
  certificate authority.

.PARAMETER Port
  Loopback port. Default: 8765.

.PARAMETER Http
  Serve plain HTTP instead. Browsers still treat http://localhost as a secure
  context for the microphone, but the address bar will not show HTTPS.

.PARAMETER Open
  Open the archive in the default browser after a short delay.
#>
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8765,
  [switch]$Http,
  [switch]$Open
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Frontend = Join-Path $Root "frontend"
$Index = Join-Path $Frontend "dist\index.html"
$Weights = Join-Path $Root "models\yamnet\yamnet.h5"

if (-not (Test-Path $Python)) {
  throw "The Python environment is missing. Run .\scripts\setup.ps1 first."
}

if (-not (Test-Path $Index)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "The frontend has not been built and npm was not found. Run .\scripts\setup.ps1 first."
  }

  Write-Host "The production frontend is missing. Building it now..." -ForegroundColor Yellow
  Push-Location $Frontend
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "The frontend build failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-Path $Weights)) {
  Write-Warning "YAMNet weights are missing. The archive will start, but analysis will be unavailable."
  Write-Warning "Run .\scripts\download-models.ps1 to install them."
}

# These must be set before TensorFlow imports Keras. The app also sets them
# defensively, but keeping them in the launch environment helps diagnostics.
$env:TF_USE_LEGACY_KERAS = "1"
$env:PYTHONUNBUFFERED = "1"

$Scheme = if ($Http) { "http" } else { "https" }
$Url = "${Scheme}://localhost:$Port"
$UvicornArgs = @(
  "-m", "uvicorn", "app.main:app",
  "--host", "127.0.0.1",
  "--port", "$Port"
)

if (-not $Http) {
  & (Join-Path $PSScriptRoot "setup-https.ps1")
  $ServerCert = Join-Path $Root "certs\server.crt"
  $ServerKey = Join-Path $Root "certs\server.key"
  if (-not (Test-Path $ServerCert) -or -not (Test-Path $ServerKey)) {
    throw "The HTTPS certificate is missing. Run .\scripts\setup-https.ps1 to see the error."
  }
  $UvicornArgs += @("--ssl-keyfile", $ServerKey, "--ssl-certfile", $ServerCert)
}

Write-Host ""
Write-Host "Hush Atlas" -ForegroundColor Cyan
Write-Host "  Local archive: $Url"
Write-Host "  API docs:      $Url/docs"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

if ($Open) {
  Start-Job -ScriptBlock {
    param($Address)
    Start-Sleep -Seconds 2
    Start-Process $Address
  } -ArgumentList $Url | Out-Null
}

Push-Location (Join-Path $Root "backend")
try {
  & $Python @UvicornArgs
}
finally {
  Pop-Location
}
