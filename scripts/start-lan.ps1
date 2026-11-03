#requires -Version 5.1
<#
.SYNOPSIS
  Start Hush Atlas so a phone or tablet on the same network can open it.

.DESCRIPTION
  Same app as start.ps1, but binds to all interfaces and prints the address to
  type on the other device.

  Hush Atlas has no login. Only run this on a network you trust, and stop the
  server (Ctrl+C) when you are finished.

  Microphone recording needs a secure page. A plain http:// address on the LAN
  is not secure, so phones block the microphone there. This script therefore
  serves HTTPS with a certificate made by mkcert on this computer.

  The certificate is trusted on this computer after setup-https.ps1. A phone
  must install certs\mkcert-rootCA.crt once. That is a local-only certificate
  authority; it cannot be used to impersonate public websites.

  Use -Http only for browsing, file upload, playback, and maps. The phone will
  not allow microphone recording on that address.

.PARAMETER Port
  Port to listen on. Default: 8765.

.PARAMETER Http
  Serve plain HTTP instead. The phone can browse and upload files, but its
  browser will not allow microphone recording.

.PARAMETER Open
  Open the app in this computer's browser after a short delay.
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

$ServerCert = Join-Path $Root "certs\server.crt"
$ServerKey = Join-Path $Root "certs\server.key"
$CaCert = Join-Path $Root "certs\mkcert-rootCA.crt"

if (-not $Http) {
  & (Join-Path $PSScriptRoot "setup-https.ps1")
  if (-not (Test-Path $ServerCert) -or -not (Test-Path $ServerKey)) {
    throw "The HTTPS certificate could not be created. Run .\scripts\setup-https.ps1 to see the error."
  }
}

# Prefer the address on the interface that carries the default route.
$Address = $null
try {
  $Route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
    Sort-Object RouteMetric |
    Select-Object -First 1
  if ($Route) {
    $Address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $Route.InterfaceIndex -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
}
catch {
  $Address = $null
}

if (-not $Address) {
  $Address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
}

$env:TF_USE_LEGACY_KERAS = "1"
$env:PYTHONUNBUFFERED = "1"

$Scheme = if ($Http) { "http" } else { "https" }
$LocalUrl = "${Scheme}://localhost:$Port"

Write-Host ""
Write-Host "Hush Atlas - phone access" -ForegroundColor Cyan
Write-Host "  On this computer: $LocalUrl"
if ($Address) {
  Write-Host "  On your phone:    ${Scheme}://${Address}:$Port" -ForegroundColor Green
  Write-Host "  (same Wi-Fi network)"
}
else {
  Write-Warning "No network address was found. Connect to Wi-Fi or Ethernet and try again."
}
Write-Host ""
Write-Host "  No login: use only on a network you trust." -ForegroundColor Yellow
if (-not $Http) {
  Write-Host ""
  Write-Host "  First time on a phone:" -ForegroundColor Cyan
  Write-Host "    1. Copy certs\mkcert-rootCA.crt to the phone."
  Write-Host "    2. Install it as a CA certificate."
  Write-Host "    3. Open the HTTPS address above. The certificate is trusted and recording works."
  Write-Host ""
  Write-Host "  Android: Settings > Security > Encryption & credentials >" -ForegroundColor DarkGray
  Write-Host "           Install a certificate > CA certificate." -ForegroundColor DarkGray
  Write-Host "  iPhone:  Install the downloaded profile, then Settings > General >" -ForegroundColor DarkGray
  Write-Host "           About > Certificate Trust Settings > enable full trust." -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  Certificate to install: $CaCert" -ForegroundColor DarkGray
  Write-Host "  This CA is local to this computer. Remove it from the phone when you no longer need it." -ForegroundColor DarkGray
}
else {
  Write-Host "  HTTP mode: the phone can browse and upload, but cannot record." -ForegroundColor Yellow
}
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

if ($Address) {
  Write-Host "If the phone cannot connect, allow Python through the firewall:" -ForegroundColor DarkGray
  Write-Host "  New-NetFirewallRule -DisplayName 'Hush Atlas $Port' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow" -ForegroundColor DarkGray
  Write-Host ""
}

if ($Open) {
  Start-Job -ScriptBlock {
    param($Address)
    Start-Sleep -Seconds 2
    Start-Process $Address
  } -ArgumentList $LocalUrl | Out-Null
}

$UvicornArgs = @(
  "-m", "uvicorn", "app.main:app",
  "--host", "0.0.0.0",
  "--port", "$Port"
)
if (-not $Http) {
  $UvicornArgs += @("--ssl-keyfile", $ServerKey, "--ssl-certfile", $ServerCert)
}

Push-Location (Join-Path $Root "backend")
try {
  & $Python @UvicornArgs
}
finally {
  Pop-Location
}
