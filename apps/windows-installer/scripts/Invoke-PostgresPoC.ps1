# Run as a standard user. Never points at an existing customer PostgreSQL cluster.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Initialize', 'Start', 'Stop', 'Status')][string] $Action,
    [Parameter(Mandatory)][string] $BinDirectory,
    [Parameter(Mandatory)][string] $DataDirectory,
    [ValidateRange(1024, 65535)][int] $Port = 55432
)
. "$PSScriptRoot/Common.ps1"
$binPath = (Resolve-Path -LiteralPath $BinDirectory).Path
$dataPath = [IO.Path]::GetFullPath($DataDirectory)
$marker = Join-Path $dataPath 'gst-billing-poc.json'
$pgCtl = Join-Path $binPath 'pg_ctl.exe'
$initDb = Join-Path $binPath 'initdb.exe'
foreach ($executable in @($pgCtl, $initDb)) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Missing $executable" }
}
if ($Action -eq 'Initialize') {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'PoC port is in use.' }
    $null = New-PrivateDirectory $dataPath
    # initdb prompts securely; no passwords in process arguments, repository or logs.
    Invoke-Checked $initDb @('-D', $dataPath, '-U', 'gst_poc_admin', '-W', '--auth=scram-sha-256', '--encoding=UTF8')
    @"

# GST Billing PoC: dedicated loopback-only instance. Do not expose this port.
listen_addresses = '127.0.0.1'
port = $Port
password_encryption = 'scram-sha-256'
"@ | Add-Content -LiteralPath (Join-Path $dataPath 'postgresql.conf') -Encoding ASCII
    # Replace generated HBA entries: no trust, replication or LAN access.
    'host all all 127.0.0.1/32 scram-sha-256' | Set-Content -LiteralPath (Join-Path $dataPath 'pg_hba.conf') -Encoding ASCII
    @{ product = 'gst-billing-poc'; port = $Port; bin = $binPath; data = $dataPath } |
        ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
    Write-Output 'Initialized dedicated PoC cluster. Start explicitly; provision separate migration/runtime database roles next.'
    return
}
if (-not (Test-Path -LiteralPath $marker)) { throw 'Missing PoC identity marker; refusing an unmanaged cluster.' }
$identity = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
if ($identity.product -ne 'gst-billing-poc' -or $identity.data -ne $dataPath -or $identity.bin -ne $binPath) {
    throw 'Cluster identity or binaries do not match. No action taken.'
}
switch ($Action) {
    'Start' { Invoke-Checked $pgCtl @('-D', $dataPath, '-l', (Join-Path $dataPath 'postgresql.log'), '-w', 'start') }
    'Stop' { Invoke-Checked $pgCtl @('-D', $dataPath, '-m', 'fast', '-w', 'stop') }
    'Status' { Invoke-Checked $pgCtl @('-D', $dataPath, 'status') }
}
