# Extract definitions only; all OS effects and observations are mocked.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-LifecycleBackup.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Lifecycle helper syntax invalid.' }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([ScriptBlock]::Create($function.Extent.Text))
}
$script:started = 0; $script:locked = $false; $script:taskState = 'Ready'; $script:exit = 0; $script:receipt = 'verified'; $script:foreign = $false
$fixture = 'C:\GST-lifecycle-fixture'
$plan = @{ config = @{ root = $fixture; installationId = '25a3a48f-7f24-4b65-ae13-b55cd3d5fa31'; origin = 'https://127.0.0.1:3443'; databasePort = 55432 } } | ConvertTo-Json -Compress
function Get-DeploymentPath { param($Path) return $Path }
function Assert-OfflinePath { param($Path, $Private) }
function Get-Item { param($LiteralPath, [switch]$Force) return [PSCustomObject]@{ Length = 100; Attributes = [IO.FileAttributes]::Normal } }
function Test-Path { param($LiteralPath, $PathType) if ($LiteralPath.EndsWith('gst-update.lock')) { return $script:locked }; return $true }
function Get-Content {
    param($LiteralPath, [switch]$Raw)
    if ($LiteralPath.EndsWith('native-installation.json')) { return $script:plan }
    return (@{ status = $script:receipt; lastSuccessAt = [DateTime]::UtcNow.ToString('o'); artifact = ('backup-20261112T120000Z-' + ('a' * 32) + '.gstbackup') } | ConvertTo-Json -Compress)
}
function Get-OfflineOwnedTask { param($Plan) if ($script:foreign) { throw 'Foreign task' }; return [PSCustomObject]@{ State = $script:taskState } }
function Get-ScheduledTaskInfo { return [PSCustomObject]@{ LastRunTime = $(if ($script:started -eq 0) { [DateTime]::UtcNow.AddDays(-1) } else { [DateTime]::UtcNow }); LastTaskResult = $script:exit } }
function Get-ScheduledTask { return [PSCustomObject]@{ State = 'Ready' } }
function Start-ScheduledTask { $script:started++ }
function Start-Sleep { throw 'This fixture must complete without polling.' }
function Get-OfflineOwnedService { param($Plan, $Name) if ($script:foreign) { throw 'Foreign service' }; return [PSCustomObject]@{ State = 'Stopped' } }
$script:certificateMissing = $false
function Get-LifecycleCertificateIdentity { param($CertificatePath) if ($script:certificateMissing) { throw 'Missing certificate' }; return @{ subject = 'CN=fixture'; serverCertificateSha256 = ('a' * 64) } }
$script:publicTarget = $false; $script:httpCalls = 0
function Get-DeploymentOrigin { param($Origin, $DatabasePort) return [Uri]$Origin }
function Resolve-DeploymentAddresses { param($Hostname) return [Net.IPAddress]::Parse($(if ($script:publicTarget) { '8.8.8.8' } else { '127.0.0.1' })) }
function Get-NetIPAddress { param($AddressFamily, $ErrorAction) return [PSCustomObject]@{ IPAddress = '127.0.0.1' } }
function Test-DeploymentPrivateAddress { param($Address) return $false }
function Invoke-DeploymentHttp { $script:httpCalls++; throw 'Injected HTTPS unavailability' }
function Reject([scriptblock]$Action) { $rejected = $false; try { & $Action | Out-Null } catch { $rejected = $true }; if (-not $rejected) { throw 'Unsafe operation accepted.' } }

$result = Invoke-LifecycleBackup $fixture
if ($script:started -ne 1 -or $result.state -cne 'verified') { throw 'Backup confirmation failed.' }
foreach ($case in @('locked', 'busy', 'foreign', 'failed-task', 'failed-receipt')) {
    $script:started = 0; $script:locked = $case -eq 'locked'; $script:foreign = $case -eq 'foreign'
    $script:taskState = if ($case -eq 'busy') { 'Running' } else { 'Ready' }
    $script:exit = if ($case -eq 'failed-task') { 1 } else { 0 }
    $script:receipt = if ($case -eq 'failed-receipt') { 'failed' } else { 'verified' }
    Reject { Invoke-LifecycleBackup $fixture }
    if ($case -in @('locked', 'busy', 'foreign') -and $script:started -ne 0) { throw 'Backup started before its prerequisites passed.' }
}
$status = Get-LifecycleStatus $fixture
if ($status.GSTBillingApi -cne 'Stopped' -or $status.httpsDatabaseReady -ne $false) { throw 'Unavailable service falsely reported healthy.' }
if ($status.certificate.subject -cne 'CN=fixture') { throw 'Connection guide lost certificate identity.' }
$script:certificateMissing = $true
$status = Get-LifecycleStatus $fixture
if ($status.certificate -notlike 'unavailable:*') { throw 'Missing certificate falsely reported available.' }
$script:foreign = $true
$status = Get-LifecycleStatus $fixture
if ($status.GSTBillingApi -cne 'ownership-unverified') { throw 'Foreign registration was trusted.' }
$script:publicTarget = $true; $script:httpCalls = 0
$status = Get-LifecycleStatus $fixture
if ($script:httpCalls -ne 0 -or $status.httpsDatabaseReady -ne $false) { throw 'Public/rebound target was contacted.' }
Write-Output 'PASS: lifecycle status and scheduled backup decisions reject foreign, busy, locked and failed outcomes. No host operations were executed.'
