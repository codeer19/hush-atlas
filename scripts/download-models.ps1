#requires -Version 5.1
<#
.SYNOPSIS
  Download the official YAMNet weights used by Hush Atlas.

.DESCRIPTION
  Downloads yamnet.h5 from Google's official AudioSet storage, verifies the
  SHA-256 checksum, and places it in models\yamnet\yamnet.h5. The weights are
  intentionally not stored in git.

.PARAMETER Force
  Download again even when a valid copy is already present.
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$Directory = Join-Path $Root "models\yamnet"
$Target = Join-Path $Directory "yamnet.h5"
$ExpectedSha256 = "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744"
$Url = "https://storage.googleapis.com/audioset/yamnet.h5"

function Get-Sha256 {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

New-Item -ItemType Directory -Force -Path $Directory | Out-Null

if ((Test-Path $Target) -and -not $Force) {
  Write-Host "Checking existing YAMNet weights..."
  $existingHash = Get-Sha256 -Path $Target
  if ($existingHash -eq $ExpectedSha256) {
    Write-Host "YAMNet weights are already present and verified." -ForegroundColor Green
    Write-Host "  $Target"
    return
  }
  Write-Warning "The existing yamnet.h5 does not match the official checksum. It will be replaced."
}

$Temp = Join-Path $Directory "yamnet.h5.download"
try {
  if (Test-Path $Temp) {
    Remove-Item -LiteralPath $Temp -Force
  }

  Write-Host "Downloading YAMNet weights (about 15 MB)..." -ForegroundColor Yellow
  Write-Host "  $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Temp -UseBasicParsing

  $downloadHash = Get-Sha256 -Path $Temp
  if ($downloadHash -ne $ExpectedSha256) {
    throw "The downloaded weights failed checksum verification. Expected $ExpectedSha256, got $downloadHash."
  }

  Move-Item -LiteralPath $Temp -Destination $Target -Force
  Write-Host "YAMNet weights installed and verified." -ForegroundColor Green
  Write-Host "  $Target"
  Write-Host "  sha256 $downloadHash"
}
catch {
  if (Test-Path $Temp) {
    Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
  }
  throw
}
