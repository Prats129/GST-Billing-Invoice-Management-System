# Generates a reviewable definition; registration is a separate explicit action.
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Definition', 'Register')][string] $Action = 'Definition',
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')][string] $InstallationName,
    [Parameter(Mandatory)][ValidatePattern('^S-1-5-21-\d+-\d+-\d+-\d+$')][string] $BackupAccountSid,
    [Parameter(Mandatory)][ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string] $DailyAt,
    [Parameter(Mandatory)][string] $NodeExecutable,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string] $NodeSha256,
    [Parameter(Mandatory)][string] $ApplicationDirectory,
    [Parameter(Mandatory)][string] $EnvironmentFile,
    [Parameter(Mandatory)][string] $KeyDirectory,
    [Parameter(Mandatory)][string] $OutputDirectory,
    [Parameter(Mandatory)][string] $WorkDirectory,
    [Parameter(Mandatory)][string] $PgBinDirectory,
    [PSCredential] $Credential
)
. "$PSScriptRoot/Common.ps1"

function Get-TaskPath([string] $Value) {
    if ($Value -notmatch '^[a-zA-Z]:\\' -or $Value -match '["%\r\n]' -or $Value.EndsWith('\')) {
        throw 'Task paths must be absolute local paths without quotes, percent signs, newlines or trailing backslashes.'
    }
    return [IO.Path]::GetFullPath($Value)
}
function Assert-ProtectedTaskPath([string] $Path, [bool] $Private, [bool] $Writable) {
    # Check ancestors too: a safe file ACL is insufficient if its parent can be
    # replaced by an untrusted account. Never change permissions implicitly.
    $item = Get-Item -LiteralPath $Path -Force
    $first = $true
    # Registration already requires elevation. Existing private provisioning
    # grants the installing administrator an explicit user ACE as well.
    $trusted = @('S-1-5-18', 'S-1-5-32-544',
        'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Task paths must not traverse reparse points.' }
        $acl = Get-Acl -LiteralPath $item.FullName
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin $trusted -and -not ($owner -eq $BackupAccountSid -and $Writable)) {
            throw 'A task dependency has an untrusted owner who could change its permissions.'
        }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne 'Allow') { continue }
            # An inherit-only rule has no effect on this object.
            if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -in $trusted) { continue }
            $writeRights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            if (-not $first) {
                # Creating an unrelated sibling at a drive root does not permit
                # replacing an existing protected child. Default C:\ grants
                # Authenticated Users CreateDirectories, which is safe here.
                $writeRights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            }
            if (($rule.FileSystemRights -band $writeRights) -ne 0 -and -not ($sid -eq $BackupAccountSid -and $Writable)) {
                throw 'Untrusted write access to a task dependency or ancestor. Provision protected installation paths first.'
            }
            if ($first -and $Private -and $sid -ne $BackupAccountSid -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0) {
                throw 'Private backup configuration is readable by another account.'
            }
        }
        $first = $false
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
    }
}
function Assert-ProtectedTaskTree([string] $Path) {
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Path)
    $visited = 0
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        Assert-ProtectedTaskPath $current $false $false
        foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
            if (++$visited -gt 20000) { throw 'Unexpectedly large runtime tree. Review the packaged installation.' }
            # Audit before descending, so a junction is never followed.
            Assert-ProtectedTaskPath $child.FullName $false $false
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}

$taskName = 'GSTBilling-Backup-' + $InstallationName
if ($BackupAccountSid -match '-(500|501|502)$') { throw 'Use a dedicated ordinary local backup account, not a built-in account.' }
$jobScript = Get-TaskPath (Join-Path $PSScriptRoot 'Invoke-BackupJob.ps1')
$node = Get-TaskPath $NodeExecutable
$application = Get-TaskPath $ApplicationDirectory
$environment = Get-TaskPath $EnvironmentFile
$key = Get-TaskPath $KeyDirectory
$output = Get-TaskPath $OutputDirectory
$work = Get-TaskPath $WorkDirectory
$pg = Get-TaskPath $PgBinDirectory
$powerShell = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
$argumentValues = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $jobScript,
    '-NodeExecutable', $node, '-NodeSha256', $NodeSha256,
    '-ApplicationDirectory', $application, '-EnvironmentFile', $environment,
    '-KeyDirectory', $key, '-OutputDirectory', $output, '-WorkDirectory', $work, '-PgBinDirectory', $pg)
$arguments = ($argumentValues | ForEach-Object { '"' + $_ + '"' }) -join ' '

# No credentials are serialized. XmlDocument escapes path characters as data.
$xml = New-Object Xml.XmlDocument
$xml.LoadXml(@'
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>GST Billing encrypted backup and disposable restore verification</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger><StartBoundary/><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
    <BootTrigger><Enabled>true</Enabled><Delay>PT5M</Delay></BootTrigger>
  </Triggers>
  <Principals><Principal id="BackupOperator"><UserId/><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled><ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="BackupOperator"><Exec><Command/><Arguments/><WorkingDirectory/></Exec></Actions>
</Task>
'@)
$ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace('t', $xml.DocumentElement.NamespaceURI)
$xml.SelectSingleNode('//t:StartBoundary', $ns).InnerText = '2020-01-01T' + $DailyAt + ':00'
$xml.SelectSingleNode('//t:UserId', $ns).InnerText = $BackupAccountSid
$xml.SelectSingleNode('//t:Command', $ns).InnerText = $powerShell
$xml.SelectSingleNode('//t:Arguments', $ns).InnerText = $arguments
$xml.SelectSingleNode('//t:WorkingDirectory', $ns).InnerText = $application
if ($Action -eq 'Definition') { return $xml.OuterXml }

if (-not $Credential) { throw 'Registration requires the dedicated backup account credential. Never put its password in a file or command argument.' }
Assert-Administrator
$account = New-Object Security.Principal.NTAccount($Credential.UserName)
if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne $BackupAccountSid) { throw 'Credential does not match the reviewed backup-account SID.' }
$local = Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]$BackupAccountSid)
if (-not $local.Enabled) { throw 'The dedicated local backup account must be enabled.' }
$administrators = @(Get-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-544'))
if (@($administrators | Where-Object { $_.SID.Value -eq $BackupAccountSid }).Count -gt 0) { throw 'The backup account must not be a local administrator.' }
if (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) { throw 'Task already exists. Review/remove it explicitly; existing tasks are never overwritten.' }
$null = Get-VerifiedExecutable $node $NodeSha256
if ((& $node --version) -notmatch '^v24\.') { throw 'The approved runtime must be Node 24.' }
foreach ($required in @((Join-Path $application 'packages/database/dist/backup-cli.js'), (Join-Path $pg 'pg_dump.exe'), (Join-Path $pg 'pg_restore.exe'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Build the application and provision native PostgreSQL 18 tools before registering.' }
    Assert-ProtectedTaskPath $required $false $false
}
if ((Get-Item -LiteralPath (Join-Path $key 'backup.key')).Length -ne 32) { throw 'A 32-byte backup key is required.' }
foreach ($path in @($jobScript, (Join-Path $PSScriptRoot 'Common.ps1'), $node, $application, $pg)) {
    Assert-ProtectedTaskPath $path $false $false
}
foreach ($tree in @($application, $pg, [IO.Path]::GetDirectoryName($node)) | Select-Object -Unique) {
    Assert-ProtectedTaskTree $tree
}
foreach ($path in @($environment, (Join-Path $key 'backup.key'), (Join-Path $key 'installation-id.txt'))) {
    Assert-ProtectedTaskPath $path $true $false
}
foreach ($path in @($output, $work)) { Assert-ProtectedTaskPath $path $true $true }
if ($PSCmdlet.ShouldProcess($taskName, 'Register daily and boot backup task under the dedicated account; preserve all archives')) {
    # Task Scheduler protects the credential; no password is stored in task XML,
    # application configuration, logs or this repository.
    $password = $Credential.GetNetworkCredential().Password
    try {
        $null = Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml.OuterXml -User $Credential.UserName -Password $password -ErrorAction Stop
    } finally { $password = $null }
    Write-Output "Registered $taskName. Verify a run under this identity and monitor backup health before relying on it."
}
