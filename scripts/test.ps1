#requires -Version 5.1
<#
.SYNOPSIS
  Run the backend and frontend test suites.

.DESCRIPTION
  Runs the pytest suite (including real YAMNet smoke tests when the official
  weights are installed), the Vitest suite, and the production TypeScript/Vite
  build.

.PARAMETER SkipFrontend
  Run only the backend tests.

.PARAMETER SkipBuild
  Run frontend tests without the production build.
#>
[CmdletBinding()]
param(
  [switch]$SkipFrontend,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
  throw "The Python environment is missing. Run .\scripts\setup.ps1 first."
}

$env:TF_USE_LEGACY_KERAS = "1"
$env:PYTHONUNBUFFERED = "1"

Write-Host ""
Write-Host "==> Backend tests (pytest)" -ForegroundColor Yellow
Push-Location (Join-Path $Root "backend")
try {
  & $Python -m pytest -q
  if ($LASTEXITCODE -ne 0) {
    throw "Backend tests failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

if (-not $SkipFrontend) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Install Node.js 20 or newer, or run with -SkipFrontend."
  }

  Push-Location (Join-Path $Root "frontend")
  try {
    Write-Host ""
    Write-Host "==> Frontend tests (Vitest)" -ForegroundColor Yellow
    & npm test
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend tests failed with exit code $LASTEXITCODE."
    }

    if (-not $SkipBuild) {
      Write-Host ""
      Write-Host "==> Production build (TypeScript + Vite)" -ForegroundColor Yellow
      & npm run build
      if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE."
      }
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "All requested checks passed." -ForegroundColor Green
