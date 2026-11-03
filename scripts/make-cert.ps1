#requires -Version 5.1
<#
.SYNOPSIS
  Compatibility wrapper for setup-https.ps1.

.DESCRIPTION
  Earlier versions of Hush Atlas generated their own certificate authority with
  OpenSSL. That authority was never trusted by browsers, which caused the
  "Not secure" warning. This wrapper now delegates to the mkcert-based setup.

.PARAMETER Force
  Regenerate the server certificate. The local CA is kept.
#>
[CmdletBinding()]
param(
  [switch]$Force
)

& (Join-Path $PSScriptRoot "setup-https.ps1") -Force:$Force
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
