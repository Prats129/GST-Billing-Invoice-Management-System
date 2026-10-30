Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$requiredPnpm = $manifest.packageManager -replace '^pnpm@', ''
$requiredNode = [Version](Get-Content -LiteralPath (Join-Path $projectRoot '.nvmrc') -Raw).Trim()
$localRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local'))
$toolchain = Join-Path $localRoot 'toolchain'
$toolBin = Join-Path $toolchain 'bin'

function Test-ProjectNode([string] $Executable) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $versionText = (& $Executable --version).Trim().TrimStart('v')
        return $LASTEXITCODE -eq 0 -and ([Version]$versionText).Major -eq $requiredNode.Major -and [Version]$versionText -ge $requiredNode
    } catch { return $false }
}

function Assert-ProjectToolchain([string] $Directory) {
    $node = Join-Path $Directory 'bin/node.exe'
    $pnpm = Join-Path $Directory 'pnpm/bin/pnpm.cjs'
    if (-not (Test-ProjectNode $node) -or -not (Test-Path -LiteralPath $pnpm -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $Directory 'bin/pnpm.cmd') -PathType Leaf)) {
        throw 'The local toolchain is incomplete or incompatible. Existing files were preserved; inspect .local/toolchain before replacing it.'
    }
    if ((& $node $pnpm --version).Trim() -ne $requiredPnpm -or $LASTEXITCODE -ne 0) { throw 'The local pnpm version does not match package.json. Existing files were preserved.' }
}

if (-not (Test-Path -LiteralPath $toolchain)) {
    $nodeSource = Join-Path $projectRoot '.local/node/package/bin/node.exe'
    if (-not (Test-ProjectNode $nodeSource)) {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand -or -not (Test-ProjectNode $nodeCommand.Source)) {
            throw "Install Node $requiredNode (major $($requiredNode.Major)) first, or retain the existing verified .local/node runtime. No downloads or system changes were made."
        }
        $nodeSource = $nodeCommand.Source
    }
    $pnpmSource = $null
    $cacheRoot = Join-Path $projectRoot '.cache/npm/_npx'
    $candidates = @()
    if (Test-Path -LiteralPath $cacheRoot) {
        $candidates += Get-ChildItem -LiteralPath $cacheRoot -Directory | ForEach-Object { Join-Path $_.FullName 'node_modules/pnpm' }
    }
    if ($env:APPDATA) { $candidates += Join-Path $env:APPDATA 'npm/node_modules/pnpm' }
    foreach ($candidate in $candidates) {
        $packageFile = Join-Path $candidate 'package.json'
        if ((Test-Path -LiteralPath $packageFile -PathType Leaf) -and (Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version -eq $requiredPnpm) {
            $pnpmSource = $candidate
            break
        }
    }
    if (-not $pnpmSource) { throw "Install pnpm $requiredPnpm with the required Node version first. No matching cached pnpm distribution was found." }

    $stage = Join-Path $localRoot ('toolchain-setup-' + [Guid]::NewGuid().ToString('N'))
    foreach ($target in @($stage, $toolchain)) {
        if (-not ([IO.Path]::GetFullPath($target)).StartsWith($localRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Toolchain path escaped the project-local directory.' }
    }
    $null = New-Item -ItemType Directory -Path (Join-Path $stage 'bin') -Force
    Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $stage 'bin/node.exe')
    Copy-Item -LiteralPath $pnpmSource -Destination (Join-Path $stage 'pnpm') -Recurse
    [IO.File]::WriteAllText((Join-Path $stage 'bin/pnpm.cmd'), '@"%~dp0node.exe" "%~dp0..\pnpm\bin\pnpm.cjs" %*' + "`r`n", [Text.Encoding]::ASCII)
    Assert-ProjectToolchain $stage
    # Both absolute paths were checked above. Never overwrite an existing setup.
    if (Test-Path -LiteralPath $toolchain) { throw 'Another setup created .local/toolchain; no existing files were replaced.' }
    Move-Item -LiteralPath $stage -Destination $toolchain
}
Assert-ProjectToolchain $toolchain
if (-not $env:Path.StartsWith($toolBin + ';', [StringComparison]::OrdinalIgnoreCase)) { $env:Path = $toolBin + ';' + $env:Path }
Write-Output "Project toolchain selected: Node $(& (Join-Path $toolBin 'node.exe') --version), pnpm $requiredPnpm."
