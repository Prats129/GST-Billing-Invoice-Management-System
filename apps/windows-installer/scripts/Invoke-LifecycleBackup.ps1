param(
    [Parameter(Mandatory = $true)][string] $Root,
    [ValidateSet('Backup', 'Check')][string] $Action = 'Backup'
)
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
Assert-Administrator
function Get-LifecycleCertificateIdentity([string] $CertificatePath) {
    Assert-OfflinePath $CertificatePath $true
    $item = Get-Item -LiteralPath $CertificatePath -Force
    if ($item.Length -gt 262144 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid public certificate.' }
    $bytes = [IO.File]::ReadAllBytes($CertificatePath)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    if ($text -match '-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----') {
        $bytes = [Convert]::FromBase64String($Matches[1])
    }
    if ([Security.Cryptography.X509Certificates.X509Certificate2]::GetCertContentType($bytes) -ne [Security.Cryptography.X509Certificates.X509ContentType]::Cert) { throw 'Public certificate required.' }
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2(,$bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return [ordered]@{
            subject = $certificate.Subject
            issuer = $certificate.Issuer
            serverCertificateSha256 = ([BitConverter]::ToString($sha.ComputeHash($certificate.RawData))).Replace('-', '').ToLowerInvariant()
            validFromUtc = $certificate.NotBefore.ToUniversalTime().ToString('o')
            validUntilUtc = $certificate.NotAfter.ToUniversalTime().ToString('o')
            observation = 'Configured server certificate only; not proof of live client trust or CA-file identity.'
        }
    } finally { $sha.Dispose(); $certificate.Dispose() }
}
function Get-LifecycleStatus([string] $InstallationRoot) {
    Assert-OfflinePath (Join-Path $InstallationRoot 'operator') $true
    $file = Join-Path $InstallationRoot 'operator\native-installation.json'
    Assert-OfflinePath $file $true
    if ((Get-Item -LiteralPath $file).Length -gt 16777216) { throw 'Invalid installation record.' }
    $plan = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($plan.config.root -cne $InstallationRoot) { throw 'Wrong installation root.' }
    $checks = [ordered]@{}
    foreach ($name in @('GSTBillingApi', 'GSTBillingPostgres')) {
        try {
            $service = Get-OfflineOwnedService $plan $name
            $checks[$name] = if ($null -eq $service) { 'missing' } else { [string]$service.State }
        } catch { $checks[$name] = 'ownership-unverified' }
    }
    try {
        $task = Get-OfflineOwnedTask $plan
        $checks['backupTask'] = if ($null -eq $task) { 'missing' } else { [string]$task.State }
    } catch { $checks['backupTask'] = 'ownership-unverified' }
    try {
        $origin = Get-DeploymentOrigin $plan.config.origin $plan.config.databasePort
        $resolved = @(Resolve-DeploymentAddresses $origin.DnsSafeHost)
        $local = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.IPAddress })
        if ($resolved.Count -ne 1 -or $resolved[0].AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
            $resolved[0].ToString() -notin $local -or
            (-not [Net.IPAddress]::IsLoopback($resolved[0]) -and -not (Test-DeploymentPrivateAddress $resolved[0]))) {
            throw 'The configured HTTPS name must still resolve to this private host.'
        }
        $response = Invoke-DeploymentHttp ([Uri]($plan.config.origin + '/api/v1/health/ready'))
        $body = $response.Content | ConvertFrom-Json
        $checks['httpsDatabaseReady'] = ($response.StatusCode -eq 200 -and $body.status -ceq 'ready' -and $body.database -ceq 'up')
    } catch { $checks['httpsDatabaseReady'] = $false }
    $checks['interruptedMaintenance'] = Test-Path -LiteralPath (Join-Path $InstallationRoot 'operations\gst-update.lock')
    try { $checks['certificate'] = Get-LifecycleCertificateIdentity (Join-Path $InstallationRoot 'runtime\tls\cert.pem') }
    catch { $checks['certificate'] = 'unavailable: inspect the configured certificate before connecting clients' }
    return $checks
}
function Invoke-LifecycleBackup([string] $InstallationRoot) {
    if ((Get-DeploymentPath $InstallationRoot) -cne $InstallationRoot) { throw 'Canonical installation root required.' }
    Assert-OfflinePath (Join-Path $InstallationRoot 'operator') $true
    $file = Join-Path $InstallationRoot 'operator\native-installation.json'
    Assert-OfflinePath $file $true
    if ((Get-Item -LiteralPath $file).Length -gt 16777216) { throw 'Invalid installation record.' }
    $plan = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($plan.config.root -cne $InstallationRoot) { throw 'Wrong installation root.' }
    if (Test-Path -LiteralPath (Join-Path $InstallationRoot 'operations\gst-update.lock')) { throw 'Resolve maintenance before backup.' }
    $task = Get-OfflineOwnedTask $plan
    if ($null -eq $task -or $task.State -ne 'Ready') { throw 'The owned backup task must be ready, enabled and idle.' }
    $name = 'GSTBilling-Backup-' + $plan.config.installationId
    $before = (Get-ScheduledTaskInfo -TaskName $name -TaskPath '\').LastRunTime
    $started = [DateTime]::UtcNow
    Start-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalMinutes -lt 30) {
        $current = Get-ScheduledTask -TaskName $name -TaskPath '\'
        $info = Get-ScheduledTaskInfo -TaskName $name -TaskPath '\'
        if ($info.LastRunTime -gt $before -and $current.State -ne 'Running') {
            if ($info.LastTaskResult -ne 0) { throw 'Backup task failed; inspect its retained status.' }
            $statusFile = Join-Path $InstallationRoot 'backups\backup-status.json'
            $item = Get-Item -LiteralPath $statusFile -Force
            if ($item.Length -gt 16384 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid backup status.' }
            $status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
            if ($status.status -cne 'verified' -or [DateTime]::Parse($status.lastSuccessAt).ToUniversalTime() -lt $started -or
                $status.artifact -notmatch '^backup-[0-9TZ]+-[a-f0-9]{32}\.gstbackup$' -or
                -not (Test-Path -LiteralPath (Join-Path $InstallationRoot ('backups\' + $status.artifact)) -PathType Leaf)) {
                throw 'A new verified backup receipt is required.'
            }
            return @{ state = 'verified'; artifact = $status.artifact; verifiedAt = $status.lastSuccessAt }
        }
        Start-Sleep -Seconds 1
    }
    throw 'The scheduled backup outcome is unknown; leave it running and inspect its status before retrying.'
}
try {
    $result = if ($Action -eq 'Check') { Get-LifecycleStatus $Root } else { Invoke-LifecycleBackup $Root }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} catch {
    [Console]::Error.WriteLine('Backup was not confirmed. Inspect the owned task and backup status; retain all existing archives.')
    exit 1
}
