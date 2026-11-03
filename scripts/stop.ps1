#requires -Version 5.1
<#
.SYNOPSIS
  Stop Hush Atlas development or LAN servers started from this repository.

.DESCRIPTION
  Finds listeners on the usual Hush Atlas ports and stops only processes whose
  command line belongs to this repository (uvicorn app.main:app or Vite). Other
  applications on the same ports are left alone.

.PARAMETER Port
  Additional port to check. The script always checks 5173, 4173, 8765, and 8766.
#>
[CmdletBinding()]
param(
  [int[]]$Port = @()
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$portsToCheck = (@(5173, 4173, 8765, 8766) + $Port) | Select-Object -Unique
$stopped = @()

foreach ($candidate in $portsToCheck) {
  $connections = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }
    $commandLine = [string]$process.CommandLine
    $executable = [string]$process.ExecutablePath
    $belongsToRepo = $executable -like "$Root*" -or $commandLine -like "*$Root*"
    $isHushAtlas = $commandLine -match "uvicorn\s+app\.main:app" -or $commandLine -match "vite"
    if ($belongsToRepo -and $isHushAtlas) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
      $stopped += "$candidate (PID $($connection.OwningProcess))"
    }
    else {
      Write-Warning "Port $candidate is used by PID $($connection.OwningProcess), which does not look like this repository. Left running."
    }
  }
}

if ($stopped.Count -gt 0) {
  Write-Host ("Stopped: " + ($stopped -join ", ")) -ForegroundColor Green
}
else {
  Write-Host "No Hush Atlas development servers were running." -ForegroundColor DarkGray
}
