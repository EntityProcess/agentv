$ErrorActionPreference = "Stop"

$installedCli = "no"
$agentvCommand = Get-Command agentv -ErrorAction SilentlyContinue

if (-not $agentvCommand) {
  Write-Host "agentv CLI not found on PATH."
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue

  if ($bunCommand) {
    Write-Host "Installing agentv with bun..."
    bun add -g agentv@latest
  }
  elseif ($npmCommand) {
    Write-Host "Installing agentv with npm..."
    npm install -g agentv@latest
  }
  else {
    throw "Neither bun nor npm is available to install agentv."
  }

  $installedCli = "yes"
}

$agentvCommand = Get-Command agentv -ErrorAction SilentlyContinue
if (-not $agentvCommand) {
  throw "agentv is still not available on PATH after installation."
}

$agentvVersion = (agentv --version).Trim()
Write-Host "agentv version: $agentvVersion"

Write-Host "Running agentv init..."
agentv init

$requiredFiles = @(
  ".env.example",
  ".agentv/config.yaml",
  ".agentv/targets.yaml"
)

$missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -Path $_ -PathType Leaf) })

if ($missingFiles.Count -gt 0) {
  Write-Host "Missing setup artifacts after first init run:"
  $missingFiles | ForEach-Object { Write-Host "  - $_" }
  Write-Host "Re-running agentv init..."
  agentv init
  $missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -Path $_ -PathType Leaf) })
}

if ($missingFiles.Count -gt 0) {
  Write-Error "Setup verification failed. Missing files: $($missingFiles -join ', ')"
  exit 1
}

Write-Host "ONBOARDING_SUMMARY version=$agentvVersion installed_cli=$installedCli init_completed=yes verification_passed=yes"
