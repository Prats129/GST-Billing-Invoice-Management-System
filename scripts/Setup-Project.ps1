param([switch] $SkipInstall)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    & (Join-Path $PSScriptRoot 'Use-ProjectToolchain.ps1')
    if (-not $SkipInstall) {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed. Existing databases/settings were not changed.' }
    }
    & pnpm build:packages
    if ($LASTEXITCODE -ne 0) { throw 'Shared build failed. Existing databases/settings were not changed.' }
    & pnpm setup:guided
    if ($LASTEXITCODE -ne 0) { throw 'Guided setup stopped. Preserve the private profile and inspect its last reported step before resuming.' }
} finally { Pop-Location }
