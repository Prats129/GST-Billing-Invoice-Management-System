param(
    [Parameter(Mandatory = $true)][string] $NodeExecutable,
    [Parameter(Mandatory = $true)][string] $NodeSha256,
    [Parameter(Mandatory = $true)][string] $ApplicationDirectory,
    [Parameter(Mandatory = $true)][string] $EnvironmentFile,
    [Parameter(Mandatory = $true)][string] $KeyDirectory,
    [Parameter(Mandatory = $true)][string] $OutputDirectory,
    [Parameter(Mandatory = $true)][string] $WorkDirectory,
    [string] $PgBinDirectory,
    [string] $DockerContainer
)
. "$PSScriptRoot/Common.ps1"

$lock = $null
$previousEnvFile = $env:ENV_FILE
$statusTemp = $null
$statusPath = $null
try {
    if ([bool]$PgBinDirectory -eq [bool]$DockerContainer) { throw 'Select exactly one approved PostgreSQL binary directory or local development container.' }
    $node = Get-VerifiedExecutable -Path $NodeExecutable -Sha256 $NodeSha256
    if ((& $node --version) -notmatch '^v24\.') { throw 'Approved Node 24 runtime required.' }
    $release = (Resolve-Path -LiteralPath $ApplicationDirectory).Path
    $cli = Join-Path $release 'packages/database/dist/backup-cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'Build the application before scheduling backups.' }
    $env:ENV_FILE = (Resolve-Path -LiteralPath $EnvironmentFile).Path
    $keyRoot = (Resolve-Path -LiteralPath $KeyDirectory).Path
    $installationId = (Get-Content -LiteralPath (Join-Path $keyRoot 'installation-id.txt') -Raw).Trim()
    $parsedId = [Guid]::Empty
    if (-not [Guid]::TryParse($installationId, [ref]$parsedId)) { throw 'Invalid installation identity.' }
    $output = [IO.Path]::GetFullPath($OutputDirectory)
    if (-not (Test-Path -LiteralPath $output)) { $null = New-PrivateDirectory -Path $output }
    # Hold an exclusive open handle for the entire backup + restore drill. The
    # empty lock file remains to avoid delete/recreate races between jobs.
    $lock = [IO.File]::Open((Join-Path $output 'backup-job.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $statusPath = Join-Path $output 'backup-status.json'
    $statusTemp = Join-Path $output ('backup-status-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $archiveName = 'backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N') + '.gstbackup'
    $archive = Join-Path $output $archiveName
    $arguments = @('--key-file', (Join-Path $keyRoot 'backup.key'), '--installation-id', $installationId, '--work-directory', [IO.Path]::GetFullPath($WorkDirectory), '--artifact', $archive)
    if ($PgBinDirectory) { $arguments += @('--pg-bin-directory', (Resolve-Path -LiteralPath $PgBinDirectory).Path) }
    else { $arguments += @('--docker-container', $DockerContainer) }
    $null = & $node $cli create @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Backup creation failed.' }
    $verificationOutput = & $node $cli verify @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Backup restore verification failed.' }
    $verification = $verificationOutput | ConvertFrom-Json
    $status = @{ status = 'verified'; lastSuccessAt = [DateTime]::UtcNow.ToString('o'); artifact = $archiveName; currentReleaseCompatible = $verification.result.currentReleaseCompatible }
    [IO.File]::WriteAllText($statusTemp, ($status | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $statusTemp -Destination $statusPath -Force
    Write-Output 'PASS: encrypted backup created and restored successfully into a disposable verification database.'
} catch {
    if ($null -ne $lock -and $statusPath -and $statusTemp) {
        $lastSuccess = $null
        if (Test-Path -LiteralPath $statusPath) {
            try { $previous = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json; $lastSuccess = $previous.lastSuccessAt } catch { $lastSuccess = $null }
        }
        $failed = @{ status = 'failed'; failedAt = [DateTime]::UtcNow.ToString('o'); lastSuccessAt = $lastSuccess }
        [IO.File]::WriteAllText($statusTemp, ($failed | ConvertTo-Json -Compress))
        Move-Item -LiteralPath $statusTemp -Destination $statusPath -Force
    }
    Write-Error 'Backup job failed. Check protected configuration, approved tools, database access and storage; retain existing backups.' -ErrorAction Continue
    exit 1
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
    $env:ENV_FILE = $previousEnvFile
    if ($statusTemp -and (Test-Path -LiteralPath $statusTemp)) { Remove-Item -LiteralPath $statusTemp }
}
