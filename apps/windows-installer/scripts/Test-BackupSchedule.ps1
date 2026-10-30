# Definition tests only: never registers a task or changes machine configuration.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$parameters = @{
    InstallationName = 'definition-test'; BackupAccountSid = 'S-1-5-21-111-222-333-1005'; DailyAt = '02:30'
    NodeExecutable = 'C:\Program Files\GST & Billing\node.exe'; NodeSha256 = ('a' * 64)
    ApplicationDirectory = 'C:\GST\application'; EnvironmentFile = 'C:\GST\private\service.env'
    KeyDirectory = 'C:\GST\private\backup'; OutputDirectory = 'C:\GST\backups'; WorkDirectory = 'C:\GST\work'; PgBinDirectory = 'C:\GST\postgres\bin'
}
[xml]$definition = . "$PSScriptRoot/Set-BackupSchedule.ps1" @parameters
$ns = New-Object Xml.XmlNamespaceManager($definition.NameTable)
$ns.AddNamespace('t', $definition.DocumentElement.NamespaceURI)
function Assert-Value([string] $XPath, [string] $Expected) {
    if ($definition.SelectSingleNode($XPath, $ns).InnerText -ne $Expected) { throw "Unexpected task definition: $XPath" }
}
Assert-Value '//t:UserId' $parameters.BackupAccountSid
Assert-Value '//t:LogonType' 'Password'
Assert-Value '//t:RunLevel' 'LeastPrivilege'
Assert-Value '//t:StartBoundary' '2020-01-01T02:30:00'
Assert-Value '//t:MultipleInstancesPolicy' 'IgnoreNew'
Assert-Value '//t:StartWhenAvailable' 'true'
Assert-Value '//t:BootTrigger/t:Delay' 'PT5M'
Assert-Value '//t:ExecutionTimeLimit' 'PT1H'
$arguments = $definition.SelectSingleNode('//t:Arguments', $ns).InnerText
if (-not $arguments.Contains('"C:\Program Files\GST & Billing\node.exe"') -or $arguments -match 'Bypass|EncodedCommand|DockerContainer') { throw 'Unsafe task action.' }
# Validate against the actual Windows Task Scheduler parser, in memory only.
# NewTask does not register anything or execute its action.
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$nativeDefinition = $scheduler.NewTask(0)
$nativeDefinition.XmlText = $definition.OuterXml
if ($nativeDefinition.Principal.UserId -ne $parameters.BackupAccountSid -or $nativeDefinition.Actions.Count -ne 1) { throw 'Native Task Scheduler definition validation failed.' }
# Exercise access decisions without creating users or changing any real ACL.
& {
    $script:testOwnerSid = 'S-1-5-32-544'
    $script:testReaderSid = 'S-1-5-32-545'
    $script:testRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $script:testAncestorRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $script:testReparse = $false
    $script:testUnsafeChild = $false
    function Get-Item {
        param($LiteralPath, [switch]$Force)
        $attributes = [IO.FileAttributes]::Directory
        if ($script:testReparse) { $attributes = $attributes -bor [IO.FileAttributes]::ReparsePoint }
        $parent = $null
        if ($LiteralPath -eq 'C:\test') { $parent = [PSCustomObject]@{ FullName = 'C:\'; Attributes = [IO.FileAttributes]::Directory; PSIsContainer = $true; Parent = $null } }
        return [PSCustomObject]@{ FullName = $LiteralPath; Attributes = $attributes; PSIsContainer = $true; Parent = $parent }
    }
    function Get-Acl {
        param($LiteralPath)
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetOwner([Security.Principal.SecurityIdentifier]$script:testOwnerSid)
        $rights = $script:testRights
        if ($LiteralPath -eq 'C:\') { $rights = $script:testAncestorRights }
        if ($script:testUnsafeChild -and $LiteralPath -eq 'C:\tree\unsafe.dll') { $rights = [Security.AccessControl.FileSystemRights]::Modify }
        $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]$script:testReaderSid, $rights, 'Allow')
        $acl.AddAccessRule($rule)
        return $acl
    }
    Assert-ProtectedTaskPath 'C:\test' $false $false
    $script:testAncestorRights = [Security.AccessControl.FileSystemRights]::AppendData
    Assert-ProtectedTaskPath 'C:\test' $false $false
    $script:testAncestorRights = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $false $false } catch { $rejected = $true }
    if (-not $rejected) { throw 'Ancestor permits replacing protected child paths.' }
    $script:testAncestorRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $true $false } catch { $rejected = $true }
    if (-not $rejected) { throw 'Public-readable private configuration accepted.' }
    $script:testRights = [Security.AccessControl.FileSystemRights]::Modify
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $false $false } catch { $rejected = $true }
    if (-not $rejected) { throw 'Untrusted writable code accepted.' }
    $script:testReaderSid = $parameters.BackupAccountSid
    Assert-ProtectedTaskPath 'C:\test' $true $true
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $true $false } catch { $rejected = $true }
    if (-not $rejected) { throw 'Backup account can modify its executable dependencies.' }
    $script:testOwnerSid = 'S-1-5-32-545'
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $true $true } catch { $rejected = $true }
    if (-not $rejected) { throw 'Untrusted owner accepted.' }
    $script:testOwnerSid = 'S-1-5-32-544'
    $script:testReparse = $true
    $rejected = $false
    try { Assert-ProtectedTaskPath 'C:\test' $false $false } catch { $rejected = $true }
    if (-not $rejected) { throw 'Reparse dependency accepted.' }
    $script:testReparse = $false
    $script:testReaderSid = 'S-1-5-32-545'
    $script:testRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $script:testUnsafeChild = $true
    function Get-ChildItem {
        param($LiteralPath, [switch]$Force)
        return [PSCustomObject]@{ FullName = 'C:\tree\unsafe.dll'; PSIsContainer = $false }
    }
    $rejected = $false
    try { Assert-ProtectedTaskTree 'C:\tree' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Explicit unsafe child ACL accepted inside a protected dependency tree.' }
}
foreach ($case in @(
    @{ NodeExecutable = 'C:\bad"path\node.exe' },
    @{ EnvironmentFile = '\\server\share\service.env' },
    @{ KeyDirectory = 'C:\keys\' },
    @{ DailyAt = '25:00' },
    @{ BackupAccountSid = 'S-1-5-18' },
    @{ BackupAccountSid = 'S-1-5-21-111-222-333-500' }
)) {
    $invalid = $parameters.Clone()
    foreach ($key in $case.Keys) { $invalid[$key] = $case[$key] }
    $rejected = $false
    try { $null = & "$PSScriptRoot/Set-BackupSchedule.ps1" @invalid } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe task parameters were accepted.' }
}
Write-Output 'PASS: backup task definition, identity, quoting, schedule and unsafe-input checks. No task was registered.'
