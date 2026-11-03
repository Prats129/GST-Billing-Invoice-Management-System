# Complete repair sequencing with every system observation/action and external
# verifier mocked. Only generated evidence directories/XML are real test data.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
. "$PSScriptRoot/OfflineRepair.ps1"
$parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$root=Join-Path $parent ('gst-repair-flow-'+[Guid]::NewGuid().ToString('N'));$null=[IO.Directory]::CreateDirectory($root);$null=[IO.Directory]::CreateDirectory((Join-Path $root 'data'));$null=[IO.Directory]::CreateDirectory((Join-Path $root 'pg-init'))
$script:calls=New-Object 'Collections.Generic.List[string]';$script:blocked=$false;$script:readyFailure=$false
$script:services=@{};$script:mode=@{};$script:pgDefinition=$null
function Assert-OfflinePath {param($Path,$Private,$ParentOnly)}
function Assert-OfflineFirewall {}
function Assert-OfflineWritableDirectory {param($Path,$Writer)$script:calls.Add('data-path-verified')}
function Assert-OfflineRetainedCluster {param($Request)$script:calls.Add('existing-cluster')}
function Assert-OfflineRepairDefinitions {param($Request)$script:calls.Add('owned-definitions')}
function Assert-OfflineRetainedInputs {param($Request)$script:calls.Add('unchanged-inputs')}
function Resolve-DeploymentAddresses {param($Hostname)return [Net.IPAddress]::Parse('127.0.0.1')}
function Get-NetIPAddress {return [PSCustomObject]@{IPAddress='127.0.0.1'}}
function Import-Clixml {param($LiteralPath)return New-Object Management.Automation.PSCredential('fixture-backup',(ConvertTo-SecureString 'ephemeral fixture' -AsPlainText -Force))}
function Assert-OfflineBackupAccount {param($Configuration,$Credential)$script:calls.Add('backup-identity')}
function Stop-OfflineOwnedInstallation {param($Plan)$script:calls.Add('stop-owned');foreach($name in @($script:services.Keys)){$script:services[$name]='Stopped';$script:mode[$name]='Disabled'}}
function Set-OfflineIsolation {param($Plan)$script:blocked=$true;$script:calls.Add('isolate')}
function New-PrivateDirectory {param($Path)$null=[IO.Directory]::CreateDirectory($Path);return $Path}
function Restore-OfflineFile {param($Source,$Target,$Sha256,$Root,$Evidence)if(-not $script:blocked){throw 'File repair preceded isolation.'};$script:calls.Add('restore-file')}
function Get-FileHash {param($LiteralPath,$Algorithm)return [PSCustomObject]@{Hash=('a'*64)}}
function Expand-OfflineArchive {param($Archive,$Destination,$Prefix)$null=[IO.Directory]::CreateDirectory((Join-Path $Destination $Prefix));$script:calls.Add('approved-archive')}
function Get-ChildItem {param($LiteralPath,[switch]$Recurse,[switch]$File,[switch]$Force)return @()}
function Save-OfflineRepairXml {param($Xml,$Path,$Evidence)if($Path.EndsWith('GSTBillingPostgres.xml')){$script:pgDefinition=$Xml};$script:calls.Add('service-xml')}
function Get-OfflineOwnedService {param($Plan,$Name)if($script:services.ContainsKey($Name)){return [PSCustomObject]@{State=$script:services[$Name]}}return $null}
function Register-OfflineService {param($Name,$Wrapper)$script:services[$Name]='Stopped';$script:mode[$Name]='Manual';$script:calls.Add('register-'+$Name)}
function Set-Service {param($Name,$StartupType)$script:mode[$Name]=$StartupType;$script:calls.Add('mode-'+$Name+'-'+$StartupType)}
function Get-OfflineServiceSid {param($Name)return 'S-1-5-80-1-2-3-4-5'}
function Grant-OfflineAccess {param($Path,$Sid,$Rights,$Inherit)$script:calls.Add('read-access')}
function Start-Service {param($Name)$script:services[$Name]='Running';$script:calls.Add('start-'+$Name)}
function Wait-OfflineDatabase {param($Configuration,$Bin)$script:calls.Add('database-live')}
function Assert-OfflineListener {param($Plan,$Name,$Port,$Executable)$script:calls.Add('listener-'+$Name)}
function Get-VerifiedExecutable {param($Path,$Sha256)return $Path}
function Invoke-RepairVerifier {param($Cli,$Root,$Value,$More,$Version,$Digest)if(-not $script:blocked){throw 'Verifier ran after admission.'};$script:calls.Add($Cli);$global:LASTEXITCODE=0}
function Restore-OfflineBackupTask {param($Plan,$Credential)$script:calls.Add('restore-task')}
function Get-Service {param($Name)$value=[PSCustomObject]@{};$value|Add-Member ScriptMethod WaitForStatus {param($State,$Timeout)};return $value}
function Assert-OfflineRepairReady {param($Request,$Node)$script:calls.Add('https-ready');if($script:readyFailure){throw 'Injected HTTPS failure'}}
function Enable-ScheduledTask {$script:calls.Add('enable-task')}
function New-NetFirewallRule {$script:calls.Add('allow-private')}
function Get-OfflineOwnedFirewall {param($Plan)return [PSCustomObject]@{Name='owned'}}
function Get-OfflineInstallBlock {param($Plan)return [PSCustomObject]@{Name='owned-block'}}
function Remove-NetFirewallRule {param([Parameter(ValueFromPipeline)]$InputObject)$script:calls.Add('admit');$script:blocked=$false}
try {
    $plan=[PSCustomObject]@{config=[PSCustomObject]@{root=$root;installationId=[Guid]::NewGuid().ToString();origin='https://127.0.0.1:3443';databasePort=55432;backupAccountSid='S-1-5-21-1-2-3-1001';privateSubnet='192.168.1.0/24'};review=[PSCustomObject]@{node=[PSCustomObject]@{directory='node'};postgres=[PSCustomObject]@{directory='pgsql'}}}
    $repair=[PSCustomObject]@{host='127.0.0.1';version='1.0.0';schemaDigest=('a'*64);appRoot=(Join-Path $root 'releases\1.0.0');inputHashes=[PSCustomObject]@{'private-trust'=('a'*64)};files=@([PSCustomObject]@{source='signed-source';destination=(Join-Path $root 'releases\1.0.0\main.js');sha256=('a'*64)});config=[PSCustomObject]@{backupCredentialFile='private-credential';bundleRoot=(Join-Path $root 'bundle');releaseTrustFile='private-trust'};nodeArchive=[PSCustomObject]@{path='node.zip';sha256=('a'*64)};postgresArchive=[PSCustomObject]@{path='pg.zip';sha256=('a'*64)};wrapper=[PSCustomObject]@{path='wrapper.exe';sha256=('a'*64)}}
    $request=[PSCustomObject]@{plan=$plan;repair=$repair;tools=[PSCustomObject]@{helpers=@();node='Invoke-RepairVerifier';nodeSha256=('a'*64);verifier='verify-existing-db';verifierSha256=('a'*64);appVerifier='verify-signed-tree';appVerifierSha256=('a'*64)}}
    Invoke-OfflineRepair $request $root
    if($script:blocked -or $script:calls[-1]-cne 'admit' -or $script:pgDefinition.service.startarguments-notmatch ' -ExistingClusterOnly$'){throw 'Repair admission or no-initialization policy failed.'}
    if($script:calls.IndexOf('verify-existing-db')-gt $script:calls.IndexOf('https-ready') -or $script:calls.IndexOf('https-ready')-gt $script:calls.IndexOf('admit') -or $script:calls.IndexOf('isolate')-gt $script:calls.IndexOf('restore-file')){throw 'Unsafe repair order.'}
    if($script:mode.GSTBillingApi-cne 'Automatic' -or $script:mode.GSTBillingPostgres-cne 'Automatic'){throw 'Automatic startup was not restored.'}
    $script:calls.Clear();$script:readyFailure=$true
    $rejected=$false;try{Invoke-OfflineRepair $request $root}catch{$rejected=$true}
    if(-not $rejected -or -not $script:blocked -or $script:calls.Contains('admit') -or $script:services.GSTBillingApi-cne 'Stopped' -or $script:services.GSTBillingPostgres-cne 'Stopped'){throw 'Failed readiness did not keep repair isolated/stopped.'}
    Write-Output 'PASS: mocked full repair/reinstall ordering, missing service restoration, existing-only PostgreSQL, read-only verification and failed-readiness isolation. No machine changes.'
} finally {
    $target=[IO.Path]::GetFullPath($root)
    if([IO.Path]::GetDirectoryName($target)-ne $parent -or [IO.Path]::GetFileName($target)-notmatch '^gst-repair-flow-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup.'}
    Remove-Item -LiteralPath $target -Recurse -Force
}
