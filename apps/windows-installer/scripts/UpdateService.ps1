# Native update backend for an ALREADY provisioned dedicated GSTBillingApi service.
# Do not dot-source and call against a development laptop. Tests mock all effects.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"

function Assert-UpdateProtectedPath([string] $Path, [bool] $Private = $false) {
    if ((Get-DeploymentPath $Path) -ne $Path) { throw 'Canonical local path required.' }
    $item = Get-Item -LiteralPath $Path -Force
    $first = $true
    $trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $serviceSid = (New-Object Security.Principal.NTAccount('NT SERVICE\GSTBillingApi')).Translate([Security.Principal.SecurityIdentifier]).Value
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse dependency.' }
        $acl = Get-Acl -LiteralPath $item.FullName
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Untrusted dependency owner.' }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne 'Allow') { continue }
            if (-not $first -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -in $trusted) { continue }
            $rights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            if ($first) { $rights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
            if (($rule.FileSystemRights -band $rights) -ne 0) { throw 'Writable update dependency.' }
            if ($first -and $Private -and $sid -ne $serviceSid -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0) { throw 'Public private configuration.' }
        }
        $first = $false
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
    }
}
function Assert-UpdateTree([string] $Root) {
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Root)
    $count = 0
    while ($pending.Count -gt 0) {
        $path = $pending.Pop()
        Assert-UpdateProtectedPath $path
        foreach ($item in Get-ChildItem -LiteralPath $path -Force) {
            if (++$count -gt 20000) { throw 'Oversized update tree.' }
            Assert-UpdateProtectedPath $item.FullName
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
        }
    }
}
function Get-UpdateServiceXml($Configuration, [Xml.XmlDocument] $Document = $null) {
    $xmlPath = Join-Path $Configuration.serviceRoot 'GSTBillingApi.xml'
    if ($null -eq $Document) { Assert-UpdateProtectedPath $xmlPath; $Document = Read-DeploymentServiceXml $xmlPath }
    $xml = $Document
    $root = $xml.DocumentElement
    foreach ($required in @('id','executable','arguments','workingdirectory','serviceaccount')) { if ($root.SelectNodes($required).Count -ne 1) { throw 'Ambiguous service definition.' } }
    if ($root.get_Name() -ne 'service' -or $root.id -ne 'GSTBillingApi' -or (Get-DeploymentServiceAccount $xml) -ne 'NT SERVICE\GSTBillingApi') { throw 'Service XML identity mismatch.' }
    if ($root.executable -ne $Configuration.nodePath) { throw 'Unexpected service runtime.' }
    $working = [string]$root.workingdirectory
    if ($working -notin @($Configuration.installedRoot, $Configuration.stagedRoot) -or $root.arguments -ne ('"' + (Join-Path $working 'apps\api\dist\main.js') + '"')) { throw 'Unexpected service application.' }
    $environment = @($root.SelectNodes('env[@name="ENV_FILE"]'))
    if ($environment.Count -ne 1 -or $environment[0].GetAttribute('value') -ne $Configuration.environmentFile) { throw 'Unexpected service environment.' }
    # No arbitrary pre/post executable hooks, downloads, auto-refresh or alternate
    # start/stop commands. Keep the production service definition narrowly scoped.
    foreach ($element in $root.ChildNodes) {
        if ($element.NodeType -eq [Xml.XmlNodeType]::Element -and $element.get_Name() -notin @('id','name','description','executable','arguments','workingdirectory','startmode','stoptimeout','logpath','log','serviceaccount','env','depend')) { throw 'Unsupported service feature.' }
    }
    foreach ($entry in $root.SelectNodes('env')) { if ($entry.GetAttribute('name') -notin @('ENV_FILE','WEB_ROOT')) { throw 'Unsupported runtime environment override.' } }
    return ,$xml
}
function Get-UpdateService($Configuration) {
    $service = Get-CimInstance Win32_Service -Filter "Name='GSTBillingApi'" -ErrorAction Stop
    $wrapper = Join-Path $Configuration.serviceRoot 'GSTBillingApi.exe'
    if (-not $service -or $service.StartName -ne 'NT SERVICE\GSTBillingApi' -or $service.PathName.Trim('"') -ne $wrapper) { throw 'Registered service identity mismatch.' }
    Assert-UpdateProtectedPath $wrapper
    $null = Get-VerifiedExecutable $wrapper $Configuration.wrapperSha256
    # The first adapter refuses recovery actions rather than incompletely saving
    # and restoring binary SERVICE_FAILURE_ACTIONS structures.
    $registry = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\GSTBillingApi' -ErrorAction Stop
    if ($null -ne $registry.PSObject.Properties['FailureActions'] -or ($null -ne $registry.PSObject.Properties['DelayedAutoStart'] -and $registry.DelayedAutoStart -ne 0)) { throw 'Unsupported restart/delayed-start policy.' }
    return $service
}
function Assert-UpdateInstallationLayout($Configuration,$Record=$null) {
    # The initial installer fixes ONE lock namespace. An alternate operator
    # config must not bypass repair/uninstall exclusion by copying state elsewhere.
    if(-not $Configuration.serviceRoot.EndsWith('\services\api',[StringComparison]::OrdinalIgnoreCase)){return}
    $root=[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($Configuration.serviceRoot))
    if($null-eq $Record) {
        $path=Join-Path $root 'operator\native-installation.json';Assert-UpdateProtectedPath $path $true
        if((Get-Item -LiteralPath $path).Length-gt 16777216){throw 'Oversized installation record.'}
        $Record=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    }
    if($Record.config.root-cne $root -or [IO.Path]::GetDirectoryName($Configuration.journalDirectory)-cne (Join-Path $root 'operations') -or $Configuration.environmentFile-cne (Join-Path $root 'runtime\runtime.env') -or $Configuration.nodePath-cne (Join-Path $root ('vendor\'+$Record.review.node.directory+'\node.exe')) -or $null-eq $Configuration.PSObject.Properties['backupAccountSid'] -or $Configuration.backupAccountSid-cne $Record.config.backupAccountSid -or $Configuration.backupTaskName-cne ('GSTBilling-Backup-'+$Record.config.installationId)){throw 'Installer maintenance layout mismatch.'}
    foreach($path in @($Configuration.installedRoot,$Configuration.stagedRoot)) {
        if([IO.Path]::GetDirectoryName($path)-cne (Join-Path $root 'releases') -or [IO.Path]::GetFileName($path)-notmatch '^(?:\d+\.\d+\.\d+|gst-release-[a-zA-Z0-9]{6})$'){throw 'Release is outside the installed layout.'}
    }
}
function Assert-UpdateBlock($Configuration) {
    $name = 'GSTBilling-Update-' + $Configuration.operationId
    $rule = Get-NetFirewallRule -Name $name -ErrorAction Stop
    $ports = @($rule | Get-NetFirewallPortFilter)
    $apps = @($rule | Get-NetFirewallApplicationFilter)
    if ($rule.Group -ne $name -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Block' -or $rule.Enabled -ne 'True' -or $rule.Profile -ne 'Any' -or $ports.Count -ne 1 -or [string]$ports[0].LocalPort -ne [string]$Configuration.port -or [string]$ports[0].Protocol -ne 'TCP' -or $apps.Count -ne 1 -or $apps[0].Program -ne $Configuration.nodePath) { throw 'Maintenance firewall identity mismatch.' }
}
function Write-UpdateState([string] $Path, $Value) {
    $file = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress)); $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) }
    finally { $file.Dispose() }
}
function Set-UpdateReleaseXml([Xml.XmlDocument] $Document, [string] $Root) {
    $Document.service.workingdirectory = $Root
    $Document.service.arguments = '"' + (Join-Path $Root 'apps\api\dist\main.js') + '"'
    foreach ($old in @($Document.service.SelectNodes('env[@name="WEB_ROOT"]'))) { $null = $Document.service.RemoveChild($old) }
    $web = $Document.CreateElement('env'); $web.SetAttribute('name','WEB_ROOT'); $web.SetAttribute('value',(Join-Path $Root 'apps\web\dist')); $null = $Document.service.AppendChild($web)
    return ,$Document
}
function Invoke-UpdateService([string] $Action, $Configuration) {
    Assert-Administrator
    Assert-UpdateInstallationLayout $Configuration
    if ($Action -notin @('Stop','Select','Start','Ready','Admit','Restore','StartOriginal','ReadyOriginal','AdmitOriginal','TlsInspect')) { throw 'Unknown update action.' }
    $operation = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Configuration.operationId, 'D', [ref]$operation)) { throw 'Operation UUID required.' }
    if ($Configuration.backupTaskName -and $Configuration.backupTaskName -notmatch '^GSTBilling-Backup-[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$') { throw 'Invalid backup task identity.' }
    $backupSid=$null
    if ($null -ne $Configuration.PSObject.Properties['backupAccountSid']) {
        $backupSid=[string]$Configuration.backupAccountSid
        if ($backupSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or -not $Configuration.backupTaskName) {throw 'Invalid backup identity.'}
        $backupTask=Get-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop
        $principal=[string]$backupTask.Principal.UserId
        if ($principal -notmatch '^S-1-5-') {$principal=(New-Object Security.Principal.NTAccount($principal)).Translate([Security.Principal.SecurityIdentifier]).Value}
        if ($principal -cne $backupSid) {throw 'Backup task principal mismatch.'}
    }
    $uri = Get-DeploymentOrigin $Configuration.origin 1
    if ($Configuration.port -isnot [int] -or $Configuration.port -lt 1024 -or $Configuration.port -gt 65535 -or $uri.Port -ne $Configuration.port) { throw 'Invalid HTTPS listener.' }
    $localAddresses = @(Get-NetIPAddress -ErrorAction Stop | ForEach-Object { $_.IPAddress })
    $resolved = @(Resolve-DeploymentAddresses $uri.DnsSafeHost)
    if ($resolved.Count -eq 0) { throw 'Local origin required.' }
    foreach ($address in $resolved) {
        if ((-not [Net.IPAddress]::IsLoopback($address) -and -not (Test-DeploymentPrivateAddress $address)) -or $address.ToString() -notin $localAddresses) { throw 'Private local origin required.' }
    }
    $dependencies = @($Configuration.serviceRoot, $Configuration.nodePath, $Configuration.installedRoot, $Configuration.environmentFile)
    # Initial read-only certificate inspection precedes operation-directory
    # creation. Every mutating action still requires that protected directory.
    if ($Action -ne 'TlsInspect' -or (Test-Path -LiteralPath $Configuration.journalDirectory)) { $dependencies += $Configuration.journalDirectory }
    foreach ($path in $dependencies) { Assert-UpdateProtectedPath $path ($path -eq $Configuration.environmentFile -or $path -eq $Configuration.journalDirectory) }
    $targetRoot = $Configuration.stagedRoot
    if ($Action.EndsWith('Original') -or $Action -eq 'Restore') { $targetRoot = $Configuration.installedRoot }
    if ($Action -ne 'Stop') {
        Assert-UpdateProtectedPath $targetRoot
        foreach ($relative in @('apps\api\dist\main.js','apps\web\dist\index.html')) { if (-not (Test-Path -LiteralPath (Join-Path $targetRoot $relative) -PathType Leaf)) { throw 'Required application files missing.' } }
    }
    $null = Get-VerifiedExecutable $Configuration.nodePath $Configuration.nodeSha256
    $service = Get-UpdateService $Configuration
    $xml = Get-UpdateServiceXml $Configuration
    if ($null -ne $Configuration.PSObject.Properties['certificateKeyPath']) {
        foreach ($path in @($Configuration.certificateKeyPath, $Configuration.certificateCertPath)) {
            Assert-UpdateProtectedPath $path $true
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Certificate file missing.' }
        }
        if ($Configuration.installedRoot -ne $Configuration.stagedRoot -or $xml.service.workingdirectory -ne $Configuration.installedRoot) { throw 'Certificate maintenance cannot select another application.' }
        $web = @($xml.service.SelectNodes('env[@name="WEB_ROOT"]'))
        if ($web.Count -gt 1 -or ($web.Count -eq 1 -and $web[0].GetAttribute('value') -ne (Join-Path $Configuration.installedRoot 'apps\web\dist'))) { throw 'Unexpected certificate service web root.' }
    }
    if ($Action -eq 'TlsInspect') {
        if ($null -eq $Configuration.PSObject.Properties['certificateKeyPath']) { throw 'Certificate binding required.' }
        return
    }
    $statePath = Join-Path $Configuration.journalDirectory 'service-maintenance.json'
    $ruleName = 'GSTBilling-Update-' + $Configuration.operationId
    if ($Action -eq 'Stop') {
        if (-not (Test-Path -LiteralPath $statePath)) {
            if ($service.StartMode -notin @('Auto','Manual')) { throw 'Unexpected initial startup policy.' }
            $taskEnabled = $false
            if ($Configuration.backupTaskName) {
                $task = Get-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop
                if ($task.State -eq 'Running') { throw 'Wait for the current backup job to finish.' }
                $taskEnabled = [bool]$task.Settings.Enabled
            }
            Write-UpdateState $statePath @{ startMode = $service.StartMode; taskEnabled = $taskEnabled }
        }
        if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Group $ruleName -Direction Inbound -Action Block -Profile Any -Protocol TCP -LocalPort $Configuration.port -Program $Configuration.nodePath -EdgeTraversalPolicy Block -ErrorAction Stop | Out-Null
        }
        Assert-UpdateBlock $Configuration
        if ($Configuration.backupTaskName) {
            Disable-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop | Out-Null
            if ((Get-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop).State -eq 'Running') { throw 'Backup job raced maintenance; keep stopped and inspect.' }
        }
        Set-Service -Name GSTBillingApi -StartupType Disabled -ErrorAction Stop
        Stop-Service -Name GSTBillingApi -ErrorAction Stop
        (Get-Service -Name GSTBillingApi).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        return
    }
    Assert-UpdateBlock $Configuration
    if (-not (Test-Path -LiteralPath $statePath)) { throw 'Maintenance record required.' }
    if ($Action -eq 'Select') {
        if ($service.State -ne 'Stopped' -or $service.StartMode -ne 'Disabled') { throw 'Service must remain disabled and stopped.' }
        Assert-UpdateTree $Configuration.stagedRoot
        # DACL-only addition: do not copy or rewrite audit/owner information.
        & (Join-Path $env:SystemRoot 'System32\icacls.exe') $Configuration.stagedRoot '/grant' 'NT SERVICE\GSTBillingApi:(OI)(CI)(RX)' '/Q' *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Service read-access provisioning failed.' }
        if ($backupSid) {
            & (Join-Path $env:SystemRoot 'System32\icacls.exe') $Configuration.stagedRoot '/grant' ('*'+$backupSid+':(OI)(CI)(RX)') '/Q' *> $null
            if ($LASTEXITCODE -ne 0) {throw 'Backup release read access failed.'}
        }
        $xml = Set-UpdateReleaseXml $xml $Configuration.stagedRoot
        $xmlPath = Join-Path $Configuration.serviceRoot 'GSTBillingApi.xml'
        $temporary = Join-Path $Configuration.serviceRoot ('update-' + $Configuration.operationId + '.xml')
        $previous = Join-Path $Configuration.journalDirectory 'previous-service.xml'
        if ((Test-Path -LiteralPath $temporary) -or (Test-Path -LiteralPath $previous)) { throw 'Do not overwrite an existing service selection record.' }
        $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $xml.Save($stream); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Copy($xmlPath, $previous, $false)
        [IO.File]::Replace($temporary, $xmlPath, $null)
        return
    }
    if ($Action -eq 'Restore') {
        if ($service.State -ne 'Stopped' -or $service.StartMode -ne 'Disabled') { throw 'Service must remain stopped for recovery.' }
        Assert-UpdateTree $Configuration.installedRoot
        if ($xml.service.workingdirectory -eq $Configuration.installedRoot) { return }
        $previous = Join-Path $Configuration.journalDirectory 'previous-service.xml'
        Assert-UpdateProtectedPath $previous $true
        $original = Get-UpdateServiceXml $Configuration (Read-DeploymentServiceXml $previous)
        if ($original.service.workingdirectory -ne $Configuration.installedRoot) { throw 'Retained definition does not select the original release.' }
        $path = Join-Path $Configuration.serviceRoot 'GSTBillingApi.xml'
        $temporary = Join-Path $Configuration.serviceRoot ('restore-' + $Configuration.operationId + '.xml')
        $retired = Join-Path $Configuration.journalDirectory 'retired-service.xml'
        if ((Test-Path -LiteralPath $temporary) -or (Test-Path -LiteralPath $retired)) { throw 'Existing recovery selection requires inspection.' }
        $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $original.Save($stream); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Copy($path, $retired, $false)
        [IO.File]::Replace($temporary, $path, $null)
        return
    }
    if ($xml.service.workingdirectory -ne $targetRoot) { throw 'Expected application has not been selected.' }
    if ($Action -in @('Start','StartOriginal')) {
        if ($service.State -ne 'Stopped' -or $service.StartMode -ne 'Disabled') { throw 'Candidate must be stopped and disabled before private startup.' }
        Set-Service -Name GSTBillingApi -StartupType Manual -ErrorAction Stop
        Start-Service -Name GSTBillingApi -ErrorAction Stop
        (Get-Service -Name GSTBillingApi).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        return
    }
    if ($service.State -ne 'Running' -or $service.StartMode -ne 'Manual') { throw 'Unexpected private candidate state.' }
    if ($Action -in @('Ready','ReadyOriginal')) {
        $entry = Join-Path $targetRoot 'apps\api\dist\main.js'
        $command = '^\s*(?:"' + [regex]::Escape($Configuration.nodePath) + '"|' + [regex]::Escape($Configuration.nodePath) + ')\s+"' + [regex]::Escape($entry) + '"\s*$'
        $processes = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + [int]$service.ProcessId) | Where-Object { $_.ExecutablePath -eq $Configuration.nodePath -and $_.CommandLine -match $command })
        if ($processes.Count -ne 1) { throw 'Candidate process ownership mismatch.' }
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Configuration.port -ErrorAction Stop)
        if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.OwningProcess -ne $processes[0].ProcessId }).Count -gt 0) { throw 'Candidate listener ownership mismatch.' }
        $backupSid=$null
    if ($null -ne $Configuration.PSObject.Properties['backupAccountSid']) {
        $backupSid=[string]$Configuration.backupAccountSid
        if ($backupSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or -not $Configuration.backupTaskName) {throw 'Invalid backup identity.'}
        $backupTask=Get-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop
        if ($backupTask.Principal.UserId -cne $backupSid) {throw 'Backup task principal mismatch.'}
    }
    $uri = Get-DeploymentOrigin $Configuration.origin 1
        $live = Invoke-DeploymentHttp ([Uri]::new($uri, '/api/v1/health'))
        $ready = Invoke-DeploymentHttp ([Uri]::new($uri, '/api/v1/health/ready'))
        $front = Invoke-DeploymentHttp $uri
        $l = $live.Content | ConvertFrom-Json; $r = $ready.Content | ConvertFrom-Json
        if ($l.status -isnot [string] -or $l.service -isnot [string] -or $l.apiVersion -isnot [string] -or $r.status -isnot [string] -or $r.database -isnot [string] -or $live.StatusCode -ne 200 -or $l.status -cne 'ok' -or $l.service -cne 'gst-api' -or $l.apiVersion -cne '1' -or $ready.StatusCode -ne 200 -or $r.status -cne 'ready' -or $r.database -cne 'up' -or $front.StatusCode -ne 200 -or $front.ContentType -notmatch '^text/html' -or $front.Content -notmatch 'id="root"') { throw 'Candidate HTTPS readiness failed.' }
        return
    }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.startMode -notin @('Auto','Manual') -or $state.taskEnabled -isnot [bool]) { throw 'Invalid saved maintenance state.' }
    if ($state.startMode -eq 'Auto') { Set-Service -Name GSTBillingApi -StartupType Automatic -ErrorAction Stop }
    if ($backupSid) {
        $installedState=Join-Path ([IO.Path]::GetDirectoryName($Configuration.journalDirectory)) 'installation.json'
        Assert-UpdateProtectedPath $installedState
        & (Join-Path $env:SystemRoot 'System32\icacls.exe') $installedState '/grant' ('*'+$backupSid+':(R)') '/Q' *> $null
        if ($LASTEXITCODE -ne 0) {throw 'Backup installed-state read access failed.'}
    }
    if ($Configuration.backupTaskName -and $state.taskEnabled) { Enable-ScheduledTask -TaskName $Configuration.backupTaskName -TaskPath '\' -ErrorAction Stop | Out-Null }
    Get-NetFirewallRule -Name $ruleName -ErrorAction Stop | Remove-NetFirewallRule -ErrorAction Stop
}
