#requires -Version 5.1
<#
.SYNOPSIS
  Create a trusted local HTTPS certificate for Hush Atlas with mkcert.

.DESCRIPTION
  mkcert creates a small certificate authority (CA) that exists only on this
  computer, then issues a certificate for localhost, 127.0.0.1, ::1, the
  computer name, and the current LAN IPv4 addresses.

  The CA is installed into the current Windows user's trusted-root store. That
  is enough for Chrome and Edge. The first time, Windows may show a certificate
  confirmation dialog; approve it once. The private CA key stays in
  %LOCALAPPDATA%\mkcert and is never written to this repository.

  The public CA certificate is copied to certs\mkcert-rootCA.crt so it can be
  installed once on a phone that needs to use the LAN address.

.PARAMETER Force
  Regenerate the server certificate even if it already exists. The local CA is
  kept, so devices that already trust it do not need to install it again.

.PARAMETER NoTrust
  Generate the certificate without trying to install the CA into the Windows
  trust store. Useful for CI or when trust is managed separately.

.EXAMPLE
  .\scripts\setup-https.ps1
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$NoTrust
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$CertDir = Join-Path $Root "certs"
$ServerCert = Join-Path $CertDir "server.crt"
$ServerKey = Join-Path $CertDir "server.key"
$CaCopy = Join-Path $CertDir "mkcert-rootCA.crt"

function Find-Mkcert {
  $command = Get-Command mkcert -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\mkcert.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe\mkcert.exe"),
    (Join-Path $env:ProgramFiles "mkcert\mkcert.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $wingetRoot) {
    $found = Get-ChildItem $wingetRoot -Recurse -Filter mkcert.exe -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  return $null
}

function Get-CaCertificate {
  param([string]$Mkcert)
  $caRoot = (& $Mkcert -CAROOT).Trim()
  if (-not $caRoot) {
    return $null
  }
  $caPem = Join-Path $caRoot "rootCA.pem"
  if (-not (Test-Path $caPem)) {
    return $null
  }
  return [pscustomobject]@{
    Root = $caRoot
    Path = $caPem
    Certificate = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPem))
  }
}

function Test-Trusted {
  param([string]$Thumbprint)
  foreach ($location in @("CurrentUser", "LocalMachine")) {
    try {
      $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", $location)
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
      try {
        if ($store.Certificates | Where-Object { $_.Thumbprint -eq $Thumbprint }) {
          return $true
        }
      }
      finally {
        $store.Close()
      }
    }
    catch {
      # A locked-down machine may not allow reading one of the stores.
    }
  }
  return $false
}

$Mkcert = Find-Mkcert
if (-not $Mkcert) {
  throw @"
mkcert was not found.

Install it once with Windows Package Manager:
  winget install FiloSottile.mkcert

Then run this script again. mkcert is an open-source local certificate tool:
https://github.com/FiloSottile/mkcert
"@
}

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

$Ca = Get-CaCertificate -Mkcert $Mkcert
if (-not $Ca) {
  Write-Host "Creating the local certificate authority..." -ForegroundColor Cyan
  & $Mkcert -install
}

$Ca = Get-CaCertificate -Mkcert $Mkcert
if (-not $Ca) {
  throw "mkcert did not create a local certificate authority. Run 'mkcert -install' in an interactive PowerShell window and try again."
}

$Trusted = Test-Trusted -Thumbprint $Ca.Certificate.Thumbprint
if (-not $Trusted -and -not $NoTrust) {
  Write-Host "Installing the local certificate authority for this Windows user..." -ForegroundColor Cyan
  Write-Host "Windows may ask you to confirm. Approve it once." -ForegroundColor Yellow
  try {
    & $Mkcert -install
  }
  catch {
    Write-Warning "mkcert could not finish its automatic install: $($_.Exception.Message)"
  }
  $Trusted = Test-Trusted -Thumbprint $Ca.Certificate.Thumbprint
}

$Names = @("localhost", "127.0.0.1", "::1")
if ($env:COMPUTERNAME) {
  $Names += $env:COMPUTERNAME
}
$Addresses = @(
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.AddressState -ne "Tentative"
    } |
    Select-Object -ExpandProperty IPAddress -Unique
)
foreach ($Address in $Addresses) {
  $Names += $Address
}

# Refresh the leaf certificate on every run so a changed Wi-Fi address is
# included. The local CA stays the same, so phones keep trusting it.
Write-Host "Creating the HTTPS certificate..." -ForegroundColor Cyan
& $Mkcert -cert-file $ServerCert -key-file $ServerKey @Names | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ServerCert) -or -not (Test-Path $ServerKey)) {
  throw "mkcert could not create certs\server.crt and certs\server.key."
}

Copy-Item -LiteralPath $Ca.Path -Destination $CaCopy -Force

Write-Host ""
if ($Trusted) {
  Write-Host "The local certificate authority is trusted on this computer." -ForegroundColor Green
}
else {
  Write-Warning "The local certificate authority is not trusted on this computer yet."
  Write-Warning "Run 'mkcert -install' in an interactive PowerShell window and approve the prompt,"
  Write-Warning "or double-click certs\mkcert-rootCA.crt and install it for the current user."
}
Write-Host "  Server certificate: $ServerCert"
Write-Host "  Public CA for phones: $CaCopy"
Write-Host ""
Write-Host "Names in the certificate:" -ForegroundColor DarkGray
Write-Host ("  " + ($Names -join ", ")) -ForegroundColor DarkGray
Write-Host ""
Write-Host "Private keys stay in certs\ and %LOCALAPPDATA%\mkcert and are ignored by git." -ForegroundColor DarkGray
