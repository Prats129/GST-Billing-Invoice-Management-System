# Runs only as the dedicated virtual service account. No installer elevation,
# downloads, service registration or adoption of an unknown cluster occurs here.
[CmdletBinding()]
param([Parameter(Mandatory)][string] $Configuration, [switch] $ExistingClusterOnly)
$ErrorActionPreference = 'Stop'
try {
    if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne 'NT SERVICE\GSTBillingPostgres') { throw 'Wrong database service identity.' }
    $config = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
    foreach ($name in @('initdb.exe','postgres.exe','pg_ctl.exe')) {
        $path = Join-Path $config.bin $name
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $config.hashes.$name) { throw 'Unapproved PostgreSQL executable.' }
    }
    $marker = Join-Path $config.data 'gst-cluster.json'
    if ($ExistingClusterOnly -and -not (Test-Path -LiteralPath $marker)) {throw 'Repair requires an existing cluster; initialization is forbidden.'}
    if (-not (Test-Path -LiteralPath $marker)) {
        if (@(Get-ChildItem -LiteralPath $config.data -Force).Count -ne 0) { throw 'Existing or interrupted cluster requires inspection.' }
        & (Join-Path $config.bin 'initdb.exe') '-D' $config.data '-U' 'gst_cluster_admin' '--pwfile' $config.passwordFile '--auth=scram-sha-256' '--encoding=UTF8' *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Cluster initialization failed.' }
        @"
listen_addresses = '127.0.0.1'
port = $($config.port)
password_encryption = 'scram-sha-256'
ssl = off
fsync = on
full_page_writes = on
log_statement = 'none'
log_min_error_statement = 'panic'
log_error_verbosity = 'terse'
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
"@ | Add-Content -LiteralPath (Join-Path $config.data 'postgresql.conf') -Encoding ASCII
        'host all all 127.0.0.1/32 scram-sha-256' | Set-Content -LiteralPath (Join-Path $config.data 'pg_hba.conf') -Encoding ASCII
        $value = @{ installationId = $config.installationId; data = $config.data; bin = $config.bin; port = $config.port }
        $stream = New-Object IO.FileStream($marker, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = [Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Compress)); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        # This file belongs to the PG-only initialization directory, never a
        # caller-selected cleanup tree. The operator retains separate recovery.
        if ([IO.Path]::GetFullPath($config.passwordFile) -ne (Join-Path ([IO.Path]::GetDirectoryName($Configuration)) 'init-password.txt')) { throw 'Password cleanup binding mismatch.' }
        Remove-Item -LiteralPath $config.passwordFile
    }
    $identity = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($identity.installationId -ne $config.installationId -or $identity.data -ne $config.data -or $identity.bin -ne $config.bin -or $identity.port -ne $config.port) { throw 'Cluster identity mismatch.' }
    & (Join-Path $config.bin 'postgres.exe') '-D' $config.data
    if ($LASTEXITCODE -ne 0) { throw 'Database process failed.' }
} catch {
    [Console]::Error.WriteLine('{"event":"offline_postgres_failed","message":"Inspect the dedicated cluster and private installer evidence. Existing data was not reinitialized."}')
    exit 1
}
