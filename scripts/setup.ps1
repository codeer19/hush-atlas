#requires -Version 5.1
<#
.SYNOPSIS
  Install Hush Atlas on Windows.

.DESCRIPTION
  Creates a Python 3.12 virtual environment, installs the pinned backend
  dependencies, installs the frontend dependencies, downloads the official
  YAMNet weights, and builds the production frontend.

.PARAMETER SkipFrontend
  Do not install or build the frontend.

.PARAMETER SkipModels
  Do not download the YAMNet weights. The app will start, but analysis will be
  unavailable until scripts\download-models.ps1 is run.
#>
[CmdletBinding()]
param(
  [switch]$SkipFrontend,
  [switch]$SkipModels
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $Root ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Yellow
}

function Assert-Success {
  param([string]$What)
  if ($LASTEXITCODE -ne 0) {
    throw "$What failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Probe {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    $output = & $FilePath @Arguments 2>$null
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  }
  catch {
    return [pscustomobject]@{
      ExitCode = 1
      Output = $null
    }
  }
  finally {
    $ErrorActionPreference = $previous
  }
}

function Get-Python312 {
  $candidates = @()

  if (Get-Command py -ErrorAction SilentlyContinue) {
    $probe = Invoke-Probe -FilePath "py" -Arguments @("-3.12", "-c", "import sys; print(sys.executable)")
    if ($probe.ExitCode -eq 0 -and $probe.Output) {
      $candidates += ($probe.Output | Select-Object -Last 1).Trim()
    }
  }

  foreach ($name in @("python3.12", "python")) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { continue }
    $probe = Invoke-Probe -FilePath $name -Arguments @("-c", "import sys; print(sys.executable)")
    if ($probe.ExitCode -eq 0 -and $probe.Output) {
      $candidates += ($probe.Output | Select-Object -Last 1).Trim()
    }
  }

  if (Get-Command uv -ErrorAction SilentlyContinue) {
    $probe = Invoke-Probe -FilePath "uv" -Arguments @("python", "find", "3.12")
    if ($probe.ExitCode -eq 0 -and $probe.Output) {
      $candidates += ($probe.Output | Select-Object -Last 1).Trim()
    }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not $candidate -or -not (Test-Path $candidate)) { continue }
    $probe = Invoke-Probe -FilePath $candidate -Arguments @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    if ($probe.ExitCode -eq 0 -and ($probe.Output | Select-Object -Last 1).Trim() -eq "3.12") {
      return $candidate
    }
  }

  return $null
}

Write-Host "Hush Atlas - local setup" -ForegroundColor Cyan
Write-Host "Repository: $Root"

if (-not (Test-Path $VenvPython)) {
  Write-Step "Locating Python 3.12"
  $basePython = Get-Python312
  if (-not $basePython) {
    throw @"
Python 3.12 was not found.

TensorFlow 2.16.1 does not support Python 3.13 or 3.14. Install Python 3.12
from https://www.python.org/downloads/ and make sure the Python launcher is
enabled, then run this script again. On a machine managed with uv, running
"uv python install 3.12" also works.
"@
  }

  Write-Host "Using $basePython"
  & $basePython -m venv $VenvDir
  Assert-Success "Creating the virtual environment"
}
else {
  $existingVersion = & $VenvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
  Assert-Success "Reading the existing virtual environment"
  if ($existingVersion.Trim() -ne "3.12") {
    throw @"
The existing .venv uses Python $existingVersion, but this project requires 3.12.

Remove the .venv directory and run setup.ps1 again so a compatible environment
can be created. Do not install TensorFlow 2.16.1 into Python 3.13 or newer.
"@
  }
  Write-Host "Using existing virtual environment: $VenvPython"
}

$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
Write-Step "Preparing pip"
$pipExecutable = Join-Path $VenvDir "Scripts\pip.exe"
if (-not (Test-Path $pipExecutable)) {
  Write-Host "pip is absent from this virtual environment; bootstrapping it..."
  & $VenvPython -m ensurepip --upgrade
  Assert-Success "Bootstrapping pip"
}
& $VenvPython -m pip install --upgrade pip
Assert-Success "Upgrading pip"

Write-Step "Installing backend dependencies"
& $VenvPython -m pip install -r (Join-Path $Root "backend\requirements-dev.txt")
Assert-Success "Installing backend dependencies"

if (-not $SkipFrontend) {
  Write-Step "Checking Node.js"
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw "Node.js 20 or newer and npm were not found. Install Node.js, then rerun setup.ps1."
  }

  $nodeVersion = (& node --version).Trim()
  if ($nodeVersion -match "^v(\d+)") {
    $nodeMajor = [int]$Matches[1]
    if ($nodeMajor -lt 20) {
      throw "Node.js $nodeVersion is too old. Install Node.js 20 or newer."
    }
  }

  Write-Step "Installing frontend dependencies"
  Push-Location (Join-Path $Root "frontend")
  try {
    & npm ci
    Assert-Success "Installing frontend dependencies"
    Write-Step "Building the production frontend"
    & npm run build
    Assert-Success "Building the frontend"
  }
  finally {
    Pop-Location
  }
}

if (-not $SkipModels) {
  Write-Step "Downloading the official YAMNet weights"
  & (Join-Path $PSScriptRoot "download-models.ps1")
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start the archive with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1"
Write-Host ""
Write-Host "Then open http://127.0.0.1:8765"
