# Safe orchestration checks. No native service/task/firewall/database command
# reaches Windows; filesystem calls are mocked or use an in-memory XML document.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
$script:plan=[PSCustomObject]@{config=[PSCustomObject]@{root='C:\GST';installationId='25a3a48f-7f24-4b65-ae13-b55cd3d5fa31';backupAccountSid='S-1-5-21-1-2-3-1001'}}
$script:operation='deee6526-a531-44bb-9bb3-a7c7e73dcf12'
$script:effects=New-Object 'Collections.Generic.List[string]'
$script:wrongAccount=$false;$script:wrongRoot=$false;$script:maintenance=$false;$script:existing=$false;$script:stopFailure=$false
function Assert-Administrator {}
function Assert-OfflinePath {param($Path,$Private,$ParentOnly)}
function Get-DeploymentPath {param($Path) return $Path}
function Get-CimInstance {
    param($ClassName,$Filter,$ErrorAction)
    $name=if($Filter -match 'GSTBillingPostgres'){'GSTBillingPostgres'}else{'GSTBillingApi'}
    $dir=if($name -eq 'GSTBillingApi'){'api'}else{'postgres'}
    $account=if($script:wrongAccount){'LocalSystem'}else{'NT SERVICE\'+$name}
    $root=if($script:wrongRoot){'C:\Other'}else{'C:\GST'}
    return [PSCustomObject]@{StartName=$account;PathName=('"'+$root+'\services\'+$dir+'\'+$name+'.exe"');State='Running';ProcessId=100}
}
function Get-OfflineOwnedTask {param($Plan) return [PSCustomObject]@{State='Ready'}}
function Get-OfflineInstallBlock {param($Plan) return $null}
function Set-OfflineIsolation {param($Plan) $script:effects.Add('block-inbound')}
function Get-OfflineOwnedFirewall {param($Plan) return [PSCustomObject]@{Name='owned'}}
function Get-ScheduledTask {return [PSCustomObject]@{State='Disabled'}}
function Disable-ScheduledTask {$script:effects.Add('disable-task')}
function Unregister-ScheduledTask {$script:effects.Add('remove-task')}
function Remove-NetFirewallRule {param([Parameter(ValueFromPipeline)]$InputObject) $script:effects.Add('remove-firewall')}
function Set-Service {param($Name,$StartupType,$ErrorAction) $script:effects.Add('disable-'+$Name)}
function Stop-Service {param($Name,$ErrorAction) if($script:stopFailure){throw 'Injected stop failure'};$script:effects.Add('stop-'+$Name)}
function Get-Service {
    $value=[PSCustomObject]@{};$value|Add-Member ScriptMethod WaitForStatus {param($State,$Timeout)};return $value
}
function Unregister-OfflineService {param($Name) $script:effects.Add('remove-'+$Name)}
function Test-Path {param($LiteralPath,$PathType)
    if($LiteralPath -eq 'C:\GST'){return $script:existing}
    if($LiteralPath.EndsWith('gst-update.lock')){return $script:maintenance}
    if($LiteralPath.EndsWith('operations')){return $true}
    return $false
}
function Get-Content {param($LiteralPath,[switch]$Raw,$TotalCount)
    if($LiteralPath.EndsWith('owner.json')) {return @{installationId=$script:plan.config.installationId;operationId=$(if($script:maintenance){[Guid]::NewGuid().ToString()}else{$script:operation})}|ConvertTo-Json}
    if($LiteralPath.EndsWith('events.jsonl')) {return @{event='update_journal_created';operationKind='uninstall';installationId=$script:plan.config.installationId;operationId=$script:operation}|ConvertTo-Json}
    return $script:plan|ConvertTo-Json -Depth 30 -Compress
}
function Write-OfflineFile {param($Path,$Value) $script:effects.Add('write-evidence')}
function Write-OfflineEvent {param($Path,$Phase) $script:effects.Add('event-'+$Phase)}
function Remove-Item {throw 'Uninstall must never delete retained files.'}
function Assert-Rejected([scriptblock]$Action) {
    $rejected=$false;try{&$Action}catch{$rejected=$true};if(-not $rejected){throw 'Unsafe lifecycle accepted.'}
}
$xml=New-OfflineServiceXml 'GSTBillingApi' 'C:\GST\node.exe' '"C:\GST\main.js"' 'C:\GST' 'C:\GST\logs'
if((Get-DeploymentServiceAccount $xml) -cne 'NT SERVICE\GSTBillingApi' -or $xml.service.startmode -cne 'Manual'){throw 'Stable WinSW contract failed.'}
Assert-Rejected {Invoke-OfflineUninstall $script:plan 'wrong' $script:operation}
if($script:effects.Count -ne 0){throw 'Wrong confirmation caused a side effect.'}
$script:wrongAccount=$true
Assert-Rejected {Stop-OfflineOwnedInstallation $script:plan}
$script:wrongAccount=$false;$script:wrongRoot=$true
Assert-Rejected {Stop-OfflineOwnedInstallation $script:plan}
if($script:effects.Count -ne 0){throw 'Foreign service was changed.'}
$script:wrongRoot=$false;$script:maintenance=$true
Assert-Rejected {Invoke-OfflineUninstall $script:plan $script:plan.config.installationId $script:operation}
if($script:effects.Count -ne 0){throw 'Interrupted maintenance was modified.'}
$script:maintenance=$false;$script:existing=$true
Assert-Rejected {Invoke-OfflineInstallation $script:plan}
if($script:effects.Count -ne 0){throw 'Repeat installation was modified.'}
$script:existing=$false
Invoke-OfflineUninstall $script:plan $script:plan.config.installationId $script:operation
if(@($script:effects|Where-Object {$_ -eq 'remove-GSTBillingApi'}).Count -ne 1 -or @($script:effects|Where-Object {$_ -eq 'remove-GSTBillingPostgres'}).Count -ne 1 -or $script:effects[-1] -cne 'event-uninstalled-data-retained'){throw 'Preserving uninstall did not complete.'}
$script:effects.Clear();$script:stopFailure=$true
Assert-Rejected {Invoke-OfflineUninstall $script:plan $script:plan.config.installationId $script:operation}
if(@($script:effects|Where-Object {$_ -like 'remove-GSTBilling*' -or $_ -eq 'remove-task'}).Count -ne 0){throw 'Failed stop removed a registration.'}
& {
    $script:firewallEnabled='True';$script:firewallStatus='Running'
    function Get-NetFirewallProfile {param($ErrorAction) foreach($name in @('Domain','Private','Public')){[PSCustomObject]@{Name=$name;Enabled=$script:firewallEnabled}}}
    function Get-Service {param($Name,$ErrorAction) return [PSCustomObject]@{Status=$script:firewallStatus}}
    Assert-OfflineFirewall
    $script:firewallEnabled='False';Assert-Rejected {Assert-OfflineFirewall}
    $script:firewallEnabled='True';$script:firewallStatus='Stopped';Assert-Rejected {Assert-OfflineFirewall}
}
Write-Output 'PASS: mocked installer repeat refusal, stable service XML, exact ownership/confirmation, maintenance exclusion, preserving uninstall, firewall and stop failure. No machine changes.'
