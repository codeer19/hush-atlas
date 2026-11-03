#requires -Version 5.1
<#
.SYNOPSIS
  Start the Hush Atlas development servers over trusted HTTPS.

.DESCRIPTION
  Starts the FastAPI backend on loopback and the Vite development server over
  HTTPS. The browser talks to Vite at https://localhost:5173 and Vite proxies
  /api to the backend, so the page and API share one secure origin.

  The certificate is created by mkcert. Run this script from a normal PowerShell
  window; Windows may ask you to approve the local certificate authority once.

.PARAMETER BackendPort
  Loopback port for FastAPI. Default: 8765.

.PARAMETER FrontendPort
  Port for Vite. Default: 5173.

.PARAMETER Open
  Open the HTTPS site in the default browser after a short delay.
#>
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$BackendPort = 8765,
  [ValidateRange(1024, 65535)]
  [int]$FrontendPort = 5173,
  [switch]$Open
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Frontend = Join-Path $Root "frontend"

if (-not (Test-Path $Python)) {
  throw "The Python environment is missing. Run .\scripts\setup.ps1 first."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js 20 or newer and run .\scripts\setup.ps1 first."
}

& (Join-Path $PSScriptRoot "setup-https.ps1")

$env:TF_USE_LEGACY_KERAS = "1"
$env:PYTHONUNBUFFERED = "1"
$env:VITE_HTTPS_REQUIRED = "1"
$env:VITE_DEV_HOST = "localhost"
$env:VITE_DEV_API_TARGET = "http://127.0.0.1:$BackendPort"

$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "https://localhost:$FrontendPort"

Write-Host ""
Write-Host "Hush Atlas - development" -ForegroundColor Cyan
Write-Host "  HTTPS site:   $FrontendUrl"
Write-Host "  Local API:    $BackendUrl/api"
Write-Host "  Press Ctrl+C to stop both servers."
Write-Host ""

$Backend = Start-Process -FilePath $Python `
  -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
  -WorkingDirectory (Join-Path $Root "backend") `
  -PassThru `
  -NoNewWindow

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($Backend.HasExited) {
      throw "The backend stopped during startup. Check the console output above."
    }
    try {
      $health = Invoke-RestMethod -Uri "$BackendUrl/api/health" -TimeoutSec 2
      if ($health.status) {
        $ready = $true
        break
      }
    }
    catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    throw "The backend did not become ready at $BackendUrl/api/health."
  }

  if ($Open) {
    Start-Job -ScriptBlock {
      param($Address)
      Start-Sleep -Seconds 2
      Start-Process $Address
    } -ArgumentList $FrontendUrl | Out-Null
  }

  Push-Location $Frontend
  try {
    & npm run dev -- --port $FrontendPort
    if ($LASTEXITCODE -ne 0) {
      throw "The Vite development server exited with code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($Backend -and -not $Backend.HasExited) {
    Stop-Process -Id $Backend.Id -Force -ErrorAction SilentlyContinue
  }
}
