# All service, registry, task, firewall, identity and network observations/effects
# below are mocked. XML parsing and orchestration decisions are real.
[CmdletBinding()]
param()
. "$PSScriptRoot/UpdateService.ps1"
$config = [PSCustomObject]@{
    operationId = '7b571b75-1c95-4e80-a7ac-868fa4d85a87'; serviceRoot = 'C:\GST\service'
    nodePath = 'C:\GST\node.exe'; nodeSha256 = ('a' * 64); wrapperSha256 = ('b' * 64)
    installedRoot = 'C:\GST\old'; stagedRoot = 'C:\GST\new'; environmentFile = 'C:\GST\runtime.env'
    journalDirectory = 'C:\GST\journal'; origin = 'https://localhost:3443'; port = 3443
    backupTaskName = 'GSTBilling-Backup-test'
}
$script:xml = @'
<service><id>GSTBillingApi</id><executable>C:\GST\node.exe</executable><arguments>"C:\GST\old\apps\api\dist\main.js"</arguments><workingdirectory>C:\GST\old</workingdirectory><serviceaccount><username>NT SERVICE\GSTBillingApi</username></serviceaccount><env name="ENV_FILE" value="C:\GST\runtime.env"/></service>
'@
$script:fixture = @{
    state = 'Running'; mode = 'Auto'; account = 'NT SERVICE\GSTBillingApi'; blocked = $false
    taskEnabled = $true; taskRunning = $false; saved = $null; saves = 0; stopFailure = $false; calls = 0
}
function Assert-Administrator {}
function Assert-UpdateProtectedPath { param($Path, $Private) }
function Get-VerifiedExecutable { param($Path, $Sha256) return $Path }
function Read-DeploymentServiceXml { param($Path) return ConvertFrom-DeploymentXml $script:xml }
function Get-NetIPAddress { return [PSCustomObject]@{ IPAddress = '127.0.0.1' } }
function Resolve-DeploymentAddresses { param($Hostname) return [Net.IPAddress]::Parse('127.0.0.1') }
function Get-ItemProperty { return [PSCustomObject]@{} }
function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    if ($ClassName -eq 'Win32_Process') { return [PSCustomObject]@{ ExecutablePath = $config.nodePath; CommandLine = ('"' + $config.nodePath + '" "C:\GST\new\apps\api\dist\main.js"'); ProcessId = 11 } }
    return [PSCustomObject]@{ StartName = $script:fixture.account; PathName = '"C:\GST\service\GSTBillingApi.exe"'; StartMode = $script:fixture.mode; State = $script:fixture.state; ProcessId = 10 }
}
function Get-NetFirewallRule {
    param($Name, $ErrorAction)
    if (-not $script:fixture.blocked) { if ($ErrorAction -eq 'Stop') { throw 'Missing block' }; return }
    return [PSCustomObject]@{ Group = ('GSTBilling-Update-' + $config.operationId); Direction = 'Inbound'; Action = 'Block'; Enabled = 'True'; Profile = 'Any' }
}
function Get-NetFirewallPortFilter { param([Parameter(ValueFromPipeline)]$InputObject) return [PSCustomObject]@{ LocalPort = 3443; Protocol = 'TCP' } }
function Get-NetFirewallApplicationFilter { param([Parameter(ValueFromPipeline)]$InputObject) return [PSCustomObject]@{ Program = $config.nodePath } }
function New-NetFirewallRule { $script:fixture.calls++; $script:fixture.blocked = $true }
function Remove-NetFirewallRule { param([Parameter(ValueFromPipeline)]$InputObject) $script:fixture.calls++; $script:fixture.blocked = $false }
function Get-ScheduledTask { return [PSCustomObject]@{ State = $(if ($script:fixture.taskRunning) { 'Running' } else { 'Ready' }); Settings = [PSCustomObject]@{ Enabled = $script:fixture.taskEnabled } } }
function Disable-ScheduledTask { $script:fixture.calls++; $script:fixture.taskEnabled = $false }
function Enable-ScheduledTask { $script:fixture.calls++; $script:fixture.taskEnabled = $true }
function Test-Path { param($LiteralPath, $PathType) if ($PathType -eq 'Leaf') { return $true }; return $null -ne $script:fixture.saved }
function Write-UpdateState { param($Path, $Value) $script:fixture.saved = $Value; $script:fixture.saves++ }
function Get-Content { return $script:fixture.saved | ConvertTo-Json }
function Set-Service { param($Name, $StartupType, $ErrorAction) $script:fixture.calls++; $script:fixture.mode = @{ Disabled = 'Disabled'; Manual = 'Manual'; Automatic = 'Auto' }[$StartupType] }
function Stop-Service { $script:fixture.calls++; if ($script:fixture.stopFailure) { throw 'Injected stop failure' }; $script:fixture.state = 'Stopped' }
function Start-Service { $script:fixture.calls++; $script:fixture.state = 'Running' }
function Get-Service {
    $value = [PSCustomObject]@{}
    $value | Add-Member ScriptMethod WaitForStatus { param($Expected, $Timeout) if ($script:fixture.state -ne $Expected) { throw 'Service did not reach expected state' } }
    return $value
}
function Get-NetTCPConnection { return [PSCustomObject]@{ OwningProcess = 11 } }
function Invoke-DeploymentHttp {
    param($Uri)
    $body = '<html><div id="root"></div></html>'
    if ($Uri.AbsolutePath -eq '/api/v1/health') { $body = '{"status":"ok","service":"gst-api","apiVersion":"1"}' }
    if ($Uri.AbsolutePath -eq '/api/v1/health/ready') { $body = '{"status":"ready","database":"up"}' }
    return [PSCustomObject]@{ StatusCode = 200; ContentType = 'text/html'; Content = $body }
}
function Assert-Rejected([scriptblock] $Action) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe operation unexpectedly accepted.' }
}
Assert-Rejected { Invoke-UpdateService Start $config }
$script:fixture.account = 'LocalSystem'
Assert-Rejected { Invoke-UpdateService Stop $config }
if ($script:fixture.calls -ne 0) { throw 'Invalid identity modified the machine.' }
$script:fixture.account = 'NT SERVICE\GSTBillingApi'
$script:fixture.taskRunning = $true
Assert-Rejected { Invoke-UpdateService Stop $config }
if ($script:fixture.calls -ne 0) { throw 'Running backup modified maintenance state.' }
$script:fixture.taskRunning = $false
Invoke-UpdateService Stop $config
Invoke-UpdateService Stop $config
if (-not $script:fixture.blocked -or $script:fixture.mode -ne 'Disabled' -or $script:fixture.taskEnabled -or $script:fixture.state -ne 'Stopped' -or $script:fixture.saves -ne 1) { throw 'Stop did not hold maintenance or preserve original state.' }
$oldXml = $script:xml
$script:xml = $oldXml.Replace('C:\GST\old', 'C:\GST\new')
Invoke-UpdateService Start $config
Invoke-UpdateService Ready $config
if (-not $script:fixture.blocked -or $script:fixture.mode -ne 'Manual') { throw 'Private startup admitted users.' }
$script:healthyProbe = ${function:Invoke-DeploymentHttp}
function Invoke-DeploymentHttp { param($Uri) return [PSCustomObject]@{ StatusCode = 200; ContentType = 'text/html'; Content = '{"status":"ok","service":"gst-api","apiVersion":1}' } }
Assert-Rejected { Invoke-UpdateService Ready $config }
Set-Item Function:Invoke-DeploymentHttp $script:healthyProbe
Invoke-UpdateService Admit $config
if ($script:fixture.blocked -or $script:fixture.mode -ne 'Auto' -or -not $script:fixture.taskEnabled) { throw 'Admission did not restore approved state.' }
$script:fixture.stopFailure = $true
Assert-Rejected { Invoke-UpdateService Stop $config }
if (-not $script:fixture.blocked -or $script:fixture.mode -ne 'Disabled') { throw 'Failed stop lost maintenance protection.' }
$script:xml = $oldXml.Replace('<id>GSTBillingApi</id>', '<id>OtherService</id>')
Assert-Rejected { Get-UpdateServiceXml $config }
Assert-Rejected { ConvertFrom-DeploymentXml '<!DOCTYPE service [<!ENTITY x SYSTEM "file:///invalid">]><service>&x;</service>' }
$definition = Set-UpdateReleaseXml (ConvertFrom-DeploymentXml $oldXml) 'C:\GST\new & ready'
if ($definition.service.workingdirectory -ne 'C:\GST\new & ready' -or $definition.OuterXml -notmatch '&amp;' -or $definition.service.SelectNodes('env[@name="WEB_ROOT"]').Count -ne 1 -or $definition.service.SelectSingleNode('env[@name="ENV_FILE"]').GetAttribute('value') -ne $config.environmentFile) { throw 'Service selection changed private configuration or failed to escape paths.' }
Write-Output 'PASS: mocked Windows update service identity, stop/start/admission, failure and secure XML checks. No machine changes.'
