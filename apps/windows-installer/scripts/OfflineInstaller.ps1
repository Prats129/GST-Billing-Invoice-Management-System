# Definitions only. The Node operator entrypoint supplies a signed, verified plan.
# Safe tests mock every machine effect. Never dot-source/call on the dev laptop.
function Write-OfflineFile([string] $Path, $Value) {
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        if ($Value -is [byte[]]) { $bytes = $Value }
        elseif ($Value -is [string]) { $bytes = [Text.Encoding]::UTF8.GetBytes($Value) }
        else { $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 30 -Compress)) }
        $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true)
    } finally { $stream.Dispose() }
}
function Assert-OfflinePath([string] $Path, [bool] $Private = $false, [bool] $ParentOnly = $false) {
    if ((Get-DeploymentPath $Path) -ne $Path) { throw 'Canonical local path required.' }
    $item = Get-Item -LiteralPath $Path -Force; $first = $true
    $trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse dependency.' }
        $acl = Get-Acl -LiteralPath $item.FullName
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Untrusted installer owner.' }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne 'Allow' -or (-not $first -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -in $trusted) { continue }
            $rights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            if ($first -and -not $ParentOnly) { $rights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
            if (($rule.FileSystemRights -band $rights) -ne 0 -or ($first -and $Private -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0)) { throw 'Untrusted installer access.' }
        }
        $first = $false
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
    }
}
function Grant-OfflineAccess([string] $Path, [string] $Sid, [string] $Rights, [bool] $Inherit = $false) {
    if ($Sid -notmatch '^S-1-5-(?:21|80)-[0-9-]+$' -or $Rights -notin @('ReadAndExecute','Read','Modify','Traverse')) { throw 'Invalid ACL grant.' }
    $acl = Get-Acl -LiteralPath $Path
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    if ($Inherit) { $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]$Sid), ([Security.AccessControl.FileSystemRights]$Rights), $inheritance, 'None', 'Allow')
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath $Path -AclObject $acl
}
function Get-OfflineSecret {
    $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes); return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant() }
    finally { [Array]::Clear($bytes,0,$bytes.Length); $rng.Dispose() }
}
function Get-OfflineChild([string] $Root, [string] $Relative) {
    $path = [IO.Path]::GetFullPath((Join-Path $Root $Relative.Replace('/','\')))
    if (-not $path.StartsWith($Root.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes installation.' }
    return $path
}
function Expand-OfflineArchive([string] $Archive, [string] $Destination, [string] $Prefix) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive); $total = [long]0
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    try {
        if ($zip.Entries.Count -gt 100000) { throw 'Oversized archive.' }
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if (-not $name.StartsWith($Prefix + '/') -or $name -match '(^|/)\.\.?(/|$)|[:\x00-\x1f]' -or -not $seen.Add($name.TrimEnd('/')) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe archive entry.' }
            foreach ($component in $name.TrimEnd('/').Split('/')) {
                if (-not $component -or $component -match '[<>"|?*]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {throw 'Unsafe Windows archive path.'}
            }
            $total += $entry.Length
            if ($entry.Length -gt 1073741824 -or $total -gt 5368709120) { throw 'Oversized archive.' }
            $target = Get-OfflineChild $Destination $name
            if ($target.Length -gt 240) {throw 'Archive path exceeds supported Windows length.'}
            if ($name.EndsWith('/')) { $null = [IO.Directory]::CreateDirectory($target); continue }
            $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $input = $entry.Open(); $output = New-Object IO.FileStream($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try {
                $buffer = New-Object byte[] 65536; $length = [long]0
                while (($count = $input.Read($buffer,0,$buffer.Length)) -gt 0) { $length += $count; if ($length -gt $entry.Length) { throw 'Archive length mismatch.' }; $output.Write($buffer,0,$count) }
                if ($length -ne $entry.Length) { throw 'Truncated archive.' }; $output.Flush($true)
            } finally { $input.Dispose(); $output.Dispose() }
        }
    } finally { $zip.Dispose() }
}
function New-OfflineServiceXml([string] $Id, [string] $Executable, [string] $Arguments, [string] $Working, [string] $Log, [string] $Environment = '', [string] $Dependency = '') {
    $xml = New-Object Xml.XmlDocument; $service = $xml.CreateElement('service'); $null = $xml.AppendChild($service)
    $values = [ordered]@{ id=$Id; name=$Id; description='GST Billing dedicated offline service'; executable=$Executable; arguments=$Arguments; workingdirectory=$Working; startmode='Manual'; stoptimeout='60sec'; logpath=$Log }
    foreach ($entry in $values.GetEnumerator()) { $element=$xml.CreateElement($entry.Key); $element.InnerText=$entry.Value; $null=$service.AppendChild($element) }
    $account=$xml.CreateElement('serviceaccount')
    foreach ($entry in @{domain='NT SERVICE';user=$Id}.GetEnumerator()) { $element=$xml.CreateElement($entry.Key); $element.InnerText=$entry.Value; $null=$account.AppendChild($element) }; $null=$service.AppendChild($account)
    $logElement=$xml.CreateElement('log'); $logElement.SetAttribute('mode','roll'); $null=$service.AppendChild($logElement)
    if ($Environment) { $envElement=$xml.CreateElement('env'); $envElement.SetAttribute('name','ENV_FILE'); $envElement.SetAttribute('value',$Environment); $null=$service.AppendChild($envElement) }
    if ($Dependency) { $element=$xml.CreateElement('depend'); $element.InnerText=$Dependency; $null=$service.AppendChild($element) }
    return ,$xml
}
function Register-OfflineService([string] $Name, [string] $Wrapper) {
    if (Get-Service -Name $Name -ErrorAction SilentlyContinue) { throw 'Service collision.' }
    $password = New-Object Security.SecureString
    $credential = New-Object Management.Automation.PSCredential(('NT SERVICE\' + $Name),$password)
    $null = New-Service -Name $Name -BinaryPathName ('"' + $Wrapper + '"') -StartupType Manual -Credential $credential -ErrorAction Stop
}
function Wait-OfflineDatabase($Configuration, [string] $Bin) {
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        & (Join-Path $Bin 'pg_isready.exe') '-h' '127.0.0.1' '-p' ([string]$Configuration.databasePort) '-U' 'gst_cluster_admin' '-d' 'postgres' *> $null
        if ($LASTEXITCODE -eq 0) {
            $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Configuration.databasePort -ErrorAction Stop)
            if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -gt 0) { throw 'Database exposed beyond loopback.' }
            return
        }
        Start-Sleep -Seconds 1
    }
    throw 'Dedicated database startup timed out.'
}
function Assert-OfflineBackupAccount($Configuration, [PSCredential] $Credential) {
    $sid = (New-Object Security.Principal.NTAccount($Credential.UserName)).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -ne $Configuration.backupAccountSid -or $sid -match '-(500|501|502)$') { throw 'Backup identity mismatch.' }
    $account=Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]$sid)
    if (-not $account.Enabled -or @(Get-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-544') | Where-Object {$_.SID.Value -eq $sid}).Count -gt 0) { throw 'Use the dedicated enabled non-admin backup account.' }
}
function Write-OfflineEvent([string] $Path, [string] $Phase) {
    $stream = New-Object IO.FileStream($Path,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try {
        $bytes=[Text.Encoding]::UTF8.GetBytes((@{phase=$Phase;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress)+"`n")
        $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)
    } finally {$stream.Dispose()}
}
function Get-OfflineOwnedService($Plan, [string] $Name) {
    if ($Name -notin @('GSTBillingApi','GSTBillingPostgres')) {throw 'Unknown service.'}
    $service=Get-CimInstance Win32_Service -Filter ("Name='"+$Name+"'") -ErrorAction Stop
    if ($null -eq $service) {return $null}
    $directory=if($Name -eq 'GSTBillingApi'){'api'}else{'postgres'}
    $wrapper=Join-Path $Plan.config.root ('services\'+$directory+'\'+$Name+'.exe')
    if ($service.StartName -cne ('NT SERVICE\'+$Name) -or $service.PathName -cne ('"'+$wrapper+'"')) {throw 'Service ownership mismatch; no machine change allowed.'}
    return $service
}
function Get-OfflineOwnedTask($Plan) {
    $name='GSTBilling-Backup-'+$Plan.config.installationId
    $task=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
    if ($null -eq $task) {return $null}
    $receipt=Join-Path $Plan.config.root 'operator\backup-task.xml'
    if (-not (Test-Path -LiteralPath $receipt -PathType Leaf)) {throw 'Task ownership receipt required; inspect interrupted registration.'}
    Assert-OfflinePath $receipt $true
    $saved=ConvertFrom-DeploymentXml (Get-Content -LiteralPath $receipt -Raw)
    $live=ConvertFrom-DeploymentXml (Export-ScheduledTask -TaskName $name -TaskPath '\')
    $ns=New-Object Xml.XmlNamespaceManager($live.NameTable);$ns.AddNamespace('t',$live.DocumentElement.NamespaceURI)
    $enabled=$live.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$ns)
    if ($null -eq $enabled) {throw 'Task enabled state missing.'}
    $savedEnabled=$saved.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$ns)
    $enabled.InnerText=$savedEnabled.InnerText
    $principal=[string]$task.Principal.UserId
    if ($principal -notmatch '^S-1-5-') {$principal=(New-Object Security.Principal.NTAccount($principal)).Translate([Security.Principal.SecurityIdentifier]).Value}
    if ($saved.OuterXml -cne $live.OuterXml -or $principal -cne $Plan.config.backupAccountSid) {throw 'Task ownership mismatch.'}
    return $task
}
function Get-OfflineOwnedFirewall($Plan) {
    $name='GSTBilling-HTTPS-'+$Plan.config.installationId
    $rule=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($null -eq $rule) {return $null}
    $ports=@($rule|Get-NetFirewallPortFilter);$apps=@($rule|Get-NetFirewallApplicationFilter);$addresses=@($rule|Get-NetFirewallAddressFilter)
    $node=Join-Path $Plan.config.root ('vendor\'+$Plan.review.node.directory+'\node.exe')
    if (@($rule).Count -ne 1 -or $rule.Group -cne ('GSTBilling-'+$Plan.config.installationId) -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or $rule.Profile -ne 'Private' -or $ports.Count -ne 1 -or [string]$ports[0].LocalPort -ne [string]([Uri]$Plan.config.origin).Port -or [string]$ports[0].Protocol -ne 'TCP' -or $apps.Count -ne 1 -or $apps[0].Program -cne $node -or $addresses.Count -ne 1 -or @($addresses[0].RemoteAddress).Count -ne 1 -or @($addresses[0].RemoteAddress)[0] -ne $Plan.config.privateSubnet) {throw 'Firewall ownership mismatch.'}
    return $rule
}
function Get-OfflineInstallBlock($Plan) {
    $name='GSTBilling-Install-'+$Plan.config.installationId
    $rule=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($null -eq $rule) {return $null}
    $ports=@($rule|Get-NetFirewallPortFilter);$apps=@($rule|Get-NetFirewallApplicationFilter)
    $node=Join-Path $Plan.config.root ('vendor\'+$Plan.review.node.directory+'\node.exe')
    if (@($rule).Count -ne 1 -or $rule.Group -cne $name -or $rule.Action -ne 'Block' -or $rule.Direction -ne 'Inbound' -or $rule.Profile -ne 'Any' -or $rule.Enabled -ne 'True' -or $ports.Count -ne 1 -or [string]$ports[0].LocalPort -ne [string]([Uri]$Plan.config.origin).Port -or [string]$ports[0].Protocol -ne 'TCP' -or $apps.Count -ne 1 -or $apps[0].Program -cne $node) {throw 'Initial isolation rule mismatch.'}
    return $rule
}
function Stop-OfflineOwnedInstallation($Plan) {
    # Verify every registration before touching any. A same-name registration
    # belonging to another root/account is never stopped, disabled or removed.
    $api=Get-OfflineOwnedService $Plan 'GSTBillingApi'
    $postgres=Get-OfflineOwnedService $Plan 'GSTBillingPostgres'
    $task=Get-OfflineOwnedTask $Plan
    $rule=Get-OfflineOwnedFirewall $Plan
    $null=Get-OfflineInstallBlock $Plan
    if ($null -ne $api) {Set-OfflineIsolation $Plan}
    if ($null -ne $rule) {$rule|Remove-NetFirewallRule -ErrorAction Stop}
    if ($null -ne $task) {
        $name='GSTBilling-Backup-'+$Plan.config.installationId
        Disable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
        if ((Get-ScheduledTask -TaskName $name -TaskPath '\').State -eq 'Running') {throw 'Backup still running; wait before stopping the database.'}
    }
    foreach ($entry in @(@{name='GSTBillingApi';value=$api},@{name='GSTBillingPostgres';value=$postgres})) {
        if ($null -ne $entry.value) {
            Set-Service $entry.name -StartupType Disabled -ErrorAction Stop
            Stop-Service $entry.name -ErrorAction Stop
            (Get-Service $entry.name).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
        }
    }
}
function Set-OfflineIsolation($Plan) {
    Assert-OfflineFirewall
    if ($null -ne (Get-OfflineInstallBlock $Plan)) {return}
    $name='GSTBilling-Install-'+$Plan.config.installationId
    $node=Join-Path $Plan.config.root ('vendor\'+$Plan.review.node.directory+'\node.exe')
    New-NetFirewallRule -Name $name -DisplayName $name -Group $name -Direction Inbound -Action Block -Profile Any -Protocol TCP -LocalPort ([Uri]$Plan.config.origin).Port -Program $node -EdgeTraversalPolicy Block | Out-Null
    $null=Get-OfflineInstallBlock $Plan
}
function Assert-OfflineFirewall {
    $profiles=@(Get-NetFirewallProfile -ErrorAction Stop)
    if ($profiles.Count -ne 3 -or @($profiles|Where-Object {$_.Enabled -ne 'True'}).Count -gt 0 -or (Get-Service -Name MpsSvc -ErrorAction Stop).Status -ne 'Running') {throw 'Running Windows Firewall with all profiles enabled is required.'}
}
function Assert-OfflineListener($Plan, [string] $Name, [int] $Port, [string] $Executable) {
    $service=Get-OfflineOwnedService $Plan $Name
    if ($null -eq $service -or $service.State -ne 'Running') {throw 'Dedicated service not running.'}
    $parents=@([int]$service.ProcessId)
    # PostgreSQL is the direct child of its dedicated PowerShell bootstrap.
    if ($Name -eq 'GSTBillingPostgres') {
        $shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+[int]$service.ProcessId) | Where-Object {$_.ExecutablePath -ceq $shell})
        if ($children.Count -ne 1) {throw 'Database bootstrap process mismatch.'}
        $parents=@([int]$children[0].ProcessId)
    }
    $processes=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$parents[0]) | Where-Object {$_.ExecutablePath -ceq $Executable})
    if ($processes.Count -ne 1) {throw 'Service process ownership mismatch.'}
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    if ($listeners.Count -eq 0 -or @($listeners|Where-Object {$_.OwningProcess -ne $processes[0].ProcessId -or ($Name -eq 'GSTBillingPostgres' -and $_.LocalAddress -ne '127.0.0.1')}).Count -gt 0) {throw 'Service listener ownership mismatch.'}
}
function Invoke-OfflineUninstall($Plan, [string] $Confirmation, [string] $OperationId) {
    Assert-Administrator
    $root=Get-DeploymentPath $Plan.config.root
    if ($Confirmation -cne $Plan.config.installationId -or $root -cne $Plan.config.root) {throw 'Exact installation confirmation required.'}
    Assert-OfflinePath (Join-Path $root 'operator') $true
    $record=Join-Path $root 'operator\native-installation.json'
    Assert-OfflinePath $record $true
    $saved=Get-Content -LiteralPath $record -Raw|ConvertFrom-Json
    if ($saved.config.installationId -cne $Confirmation -or $saved.config.root -cne $root -or ($saved|ConvertTo-Json -Depth 30 -Compress) -cne ($Plan|ConvertTo-Json -Depth 30 -Compress)) {throw 'Installation record mismatch.'}
    $operations=Join-Path $root 'operations'
    $operation=[Guid]::Empty
    if (-not [Guid]::TryParseExact($OperationId,'D',[ref]$operation)) {throw 'Exclusive uninstall operation required.'}
    $ownerFile=Join-Path $operations 'gst-update.lock\owner.json'
    Assert-OfflinePath $ownerFile $true
    $owner=Get-Content -LiteralPath $ownerFile -Raw|ConvertFrom-Json
    if ($owner.installationId -cne $Confirmation -or $owner.operationId -cne $OperationId) {throw 'Resolve interrupted maintenance before uninstall.'}
    $journal=Join-Path $operations ('gst-update-'+$OperationId+'\events.jsonl')
    Assert-OfflinePath $journal $true
    $header=(Get-Content -LiteralPath $journal -TotalCount 1)|ConvertFrom-Json
    if ($header.event -cne 'update_journal_created' -or $header.operationKind -cne 'uninstall' -or $header.installationId -cne $Confirmation -or $header.operationId -cne $OperationId) {throw 'Uninstall journal binding required.'}
    $events=Join-Path $root 'operator\uninstall-events.jsonl'
    if (-not (Test-Path -LiteralPath $events)) {Write-OfflineFile $events ''}
    Write-OfflineEvent $events 'uninstall-requested-data-retained'
    Stop-OfflineOwnedInstallation $Plan
    $task=Get-OfflineOwnedTask $Plan
    if ($null -ne $task) {Unregister-ScheduledTask -TaskName ('GSTBilling-Backup-'+$Confirmation) -TaskPath '\' -Confirm:$false -ErrorAction Stop}
    foreach ($name in @('GSTBillingApi','GSTBillingPostgres')) {
        if ($null -ne (Get-OfflineOwnedService $Plan $name)) {
            Unregister-OfflineService $name
        }
    }
    $block=Get-OfflineInstallBlock $Plan
    if ($null -ne $block) {$block|Remove-NetFirewallRule -ErrorAction Stop}
    # No files, database, roles, keys, credentials or archives are deleted.
    Write-OfflineEvent $events 'uninstalled-data-retained'
}
function Unregister-OfflineService([string] $Name) {
    if ($Name -notin @('GSTBillingApi','GSTBillingPostgres')) {throw 'Unknown service removal.'}
    & (Join-Path $env:SystemRoot 'System32\sc.exe') 'delete' $Name *> $null
    if ($LASTEXITCODE -ne 0) {throw 'Service deletion failed; keep retained evidence and inspect.'}
}
function Invoke-OfflineInstallation($Plan) {
    Assert-Administrator
    $config=$Plan.config; $root=Get-DeploymentPath $config.root
    if ($root -ne $config.root -or (Test-Path -LiteralPath $root)) { throw 'Initial installation requires a new root; no existing files are adopted.' }
    Assert-OfflinePath ([IO.Path]::GetDirectoryName($root)) $false $true
    $os=Get-CimInstance Win32_OperatingSystem
    if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess -or [int]$os.BuildNumber -lt 22000 -or $os.ProductType -ne 1) { throw 'Windows 11 x64 required; other platforms need acceptance.' }
    if ((Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release -lt 528040) { throw '.NET Framework 4.8 or newer required.' }
    Assert-OfflineFirewall
    $origin=Get-DeploymentOrigin $config.origin $config.databasePort
    foreach ($port in @($origin.Port,$config.databasePort)) { if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw 'Port collision.' } }
    foreach ($name in @('GSTBillingApi','GSTBillingPostgres')) { if (Get-Service -Name $name -ErrorAction SilentlyContinue) { throw 'Existing service is never adopted.' } }
    $taskName='GSTBilling-Backup-' + $config.installationId
    if (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) { throw 'Backup task collision.' }
    $ruleName='GSTBilling-HTTPS-' + $config.installationId
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'Firewall rule collision.' }
    $blockName='GSTBilling-Install-'+$config.installationId
    if (Get-NetFirewallRule -Name $blockName -ErrorAction SilentlyContinue) {throw 'Isolation rule collision.'}
    $local=@(Get-NetIPAddress | ForEach-Object {$_.IPAddress})
    $resolved=@(Resolve-DeploymentAddresses $origin.DnsSafeHost)
    if ($resolved.Count -ne 1 -or $resolved[0].AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Initial HTTPS origin must resolve to exactly one local IPv4 address.' }
    foreach ($address in $resolved) { if ((-not [Net.IPAddress]::IsLoopback($address) -and -not (Test-DeploymentPrivateAddress $address)) -or $address.ToString() -notin $local) { throw 'Private local HTTPS origin required.' } }
    if (-not [Net.IPAddress]::IsLoopback($resolved[0])) {
        $interface=@(Get-NetIPAddress -IPAddress $resolved[0].ToString() -ErrorAction Stop)
        if ($interface.Count -ne 1 -or (Get-NetConnectionProfile -InterfaceIndex $interface[0].InterfaceIndex -ErrorAction Stop).NetworkCategory -ne 'Private') {throw 'The LAN interface must already use the Private network profile.'}
    }
    # Require an explicit private subnet; do not reuse the PoC rule or permit Any.
    if ($config.privateSubnet -notmatch '^(\d{1,3}\.){3}\d{1,3}/([1-9]|[12]\d|3[0-2])$') { throw 'Explicit IPv4 subnet required.' }
    $subnet=[Net.IPAddress]::Parse($config.privateSubnet.Split('/')[0]); $prefix=[int]$config.privateSubnet.Split('/')[1]; $b=$subnet.GetAddressBytes()
    if (-not (($b[0]-eq 10 -and $prefix-ge 8) -or ($b[0]-eq 172 -and $b[1]-ge 16 -and $b[1]-le 31 -and $prefix-ge 12) -or ($b[0]-eq 192 -and $b[1]-eq 168 -and $prefix-ge 16))) { throw 'RFC1918 subnet required.' }
    Assert-OfflinePath $config.backupCredentialFile $true
    $credential=Import-Clixml -LiteralPath $config.backupCredentialFile
    if ($credential -isnot [PSCredential]) { throw 'Protected local backup credential required.' }; Assert-OfflineBackupAccount $config $credential
    $null=New-PrivateDirectory $root
    $operator=Join-Path $root 'operator'; $null=New-PrivateDirectory $operator
    $record=Join-Path $operator 'native-installation.json'
    Write-OfflineFile $record $Plan
    Write-OfflineFile (Join-Path $operator 'install.lock') $config.installationId
    $events=Join-Path $operator 'install-events.jsonl'
    Write-OfflineFile $events "{`"phase`":`"prepared`"}`n"
    try {
        foreach ($input in $Plan.inputs.PSObject.Properties) {
            Assert-OfflinePath $input.Name $true
            if ((Get-FileHash -LiteralPath $input.Name -Algorithm SHA256).Hash -ne $input.Value) { throw 'Reviewed installer input changed.' }
        }
        foreach ($file in $Plan.files) {
            $source=Get-OfflineChild $config.bundleRoot $file.path; $target=Get-OfflineChild $root $file.destination
            $item=Get-Item -LiteralPath $source -Force
            if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Signed payload changed.' }
            $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)); [IO.File]::Copy($source,$target,$false)
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Payload copy mismatch.' }
        }
        $vendor=Join-Path $root 'vendor'; $null=New-PrivateDirectory $vendor
        foreach ($artifact in @($Plan.review.node,$Plan.review.postgres)) { Expand-OfflineArchive (Get-OfflineChild $root ('payload/'+$artifact.archive)) $vendor $artifact.directory }
        $nodeRoot=Join-Path $vendor $Plan.review.node.directory; $node=Join-Path $nodeRoot 'node.exe'
        $pgRoot=Join-Path $vendor $Plan.review.postgres.directory; $pgBin=Join-Path $pgRoot 'bin'
        foreach ($artifact in @(@{root=$nodeRoot; hashes=$Plan.review.node.executables},@{root=$pgRoot;hashes=$Plan.review.postgres.executables})) {
            foreach ($entry in $artifact.hashes.PSObject.Properties) { $null=Get-VerifiedExecutable (Get-OfflineChild $artifact.root $entry.Name) $entry.Value }
        }
        if ((& $node --version) -ne ('v'+$Plan.review.node.version) -or (& (Join-Path $pgBin 'postgres.exe') --version) -notmatch ('^postgres \(PostgreSQL\) '+[regex]::Escape($Plan.review.postgres.version)+'$')) { throw 'Vendor version mismatch.' }
        $app=Join-Path $root ('releases\'+$Plan.version); $runtime=Join-Path $root 'runtime'; $null=New-PrivateDirectory $runtime
        $services=Join-Path $root 'services'; $null=New-PrivateDirectory $services
        foreach ($name in @('api','postgres')) { $null=New-PrivateDirectory (Join-Path $services $name) }
        $wrapperSource=Get-OfflineChild $root ('payload/'+$Plan.review.winsw.file)
        foreach ($entry in @(@{dir='api';id='GSTBillingApi'},@{dir='postgres';id='GSTBillingPostgres'})) { [IO.File]::Copy($wrapperSource,(Join-Path (Join-Path $services $entry.dir) ($entry.id+'.exe')),$false) }
        foreach ($name in @('data','backups','backup-work','logs-api','logs-postgres','pg-init','backup-key','operations')) { $null=New-PrivateDirectory (Join-Path $root $name) }
        $tls=Join-Path $runtime 'tls'; $null=New-PrivateDirectory $tls
        [IO.File]::Copy($config.tlsKeyFile,(Join-Path $tls 'key.pem'),$false); [IO.File]::Copy($config.tlsCertFile,(Join-Path $tls 'cert.pem'),$false)
        [IO.File]::Copy($config.entitlementTrustFile,(Join-Path $runtime 'entitlement-trust.json'),$false)
        $admin=Get-OfflineSecret; $owner=Get-OfflineSecret; $api=Get-OfflineSecret; $auth=Get-OfflineSecret
        $base='postgresql://'; $server='@127.0.0.1:'+ $config.databasePort
        $adminUrl=$base+'gst_cluster_admin:'+$admin+$server+'/postgres'
        $ownerUrl=$base+'gst_owner:'+$owner+$server+'/gst_billing'; $apiUrl=$base+'gst_runtime:'+$api+$server+'/gst_billing'
        Write-OfflineFile (Join-Path $operator 'database-input.json') @{adminConnectionString=$adminUrl;expectedDataDirectory=(Join-Path $root 'data');installationId=$config.installationId;ownerPassword=$owner;runtimePassword=$api}
        $environment="NODE_ENV=production`nDEPLOYMENT_EDITION=offline`nHOST=$($resolved[0].ToString())`nPORT=$($origin.Port)`nAPP_ORIGIN=$($config.origin)`nALLOWED_HOSTS=$($origin.Authority)`nOFFLINE_INSTALLATION_ID=$($config.installationId)`nAUTH_DATA_KEY=$auth`nDATABASE_URL=$apiUrl`nTLS_KEY_PATH=$(Join-Path $tls 'key.pem')`nTLS_CERT_PATH=$(Join-Path $tls 'cert.pem')`nWEB_ROOT=$(Join-Path $app 'apps\web\dist')`nENTITLEMENT_TRUST_FILE=$(Join-Path $runtime 'entitlement-trust.json')`n"
        $runtimeEnv=Join-Path $runtime 'runtime.env'; Write-OfflineFile $runtimeEnv $environment
        Write-OfflineFile (Join-Path $operator 'operator.env') ($environment+"MIGRATION_DATABASE_URL=$ownerUrl`n")
        $backupEnv=Join-Path $operator 'backup.env'; Write-OfflineFile $backupEnv "MIGRATION_DATABASE_URL=$ownerUrl`nOFFLINE_INSTALLATION_ID=$($config.installationId)`n"
        $backupKey=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); try {$rng.GetBytes($backupKey);Write-OfflineFile (Join-Path $root 'backup-key\backup.key') $backupKey} finally {[Array]::Clear($backupKey,0,$backupKey.Length);$rng.Dispose()}
        Write-OfflineFile (Join-Path $root 'backup-key\installation-id.txt') ($config.installationId+"`n")
        $pgConfig=Join-Path $root 'pg-init\cluster.json'; Write-OfflineFile (Join-Path $root 'pg-init\init-password.txt') ($admin+"`n")
        $hashes=@{}; foreach ($name in @('initdb.exe','postgres.exe','pg_ctl.exe')) {$hashes[$name]=$Plan.review.postgres.executables.('bin/'+$name)}
        Write-OfflineFile $pgConfig @{installationId=$config.installationId;bin=$pgBin;data=(Join-Path $root 'data');port=$config.databasePort;hashes=$hashes;passwordFile=(Join-Path $root 'pg-init\init-password.txt')}
        $powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $pgXml=New-OfflineServiceXml 'GSTBillingPostgres' $powerShell ('-NoLogo -NoProfile -NonInteractive -File "'+(Join-Path $root 'payload\installer\Start-OfflinePostgres.ps1')+'" -Configuration "'+$pgConfig+'"') $pgRoot (Join-Path $root 'logs-postgres')
        # Explicit pg_ctl fast stop; no database service runs as an administrator.
        $old=$pgXml.service.SelectSingleNode('arguments'); $start=$pgXml.CreateElement('startarguments');$start.InnerText=$old.InnerText;$null=$pgXml.service.ReplaceChild($start,$old)
        foreach ($entry in @{stopexecutable=(Join-Path $pgBin 'pg_ctl.exe');stoparguments=('-D "'+(Join-Path $root 'data')+'" -m fast -w stop')}.GetEnumerator()) { $element=$pgXml.CreateElement($entry.Key);$element.InnerText=$entry.Value;$null=$pgXml.service.AppendChild($element) }
        $pgXml.Save((Join-Path $services 'postgres\GSTBillingPostgres.xml'))
        $apiXml=New-OfflineServiceXml 'GSTBillingApi' $node ('"'+(Join-Path $app 'apps\api\dist\main.js')+'"') $app (Join-Path $root 'logs-api') $runtimeEnv 'GSTBillingPostgres'; $apiXml.Save((Join-Path $services 'api\GSTBillingApi.xml'))
        Register-OfflineService 'GSTBillingPostgres' (Join-Path $services 'postgres\GSTBillingPostgres.exe')
        Register-OfflineService 'GSTBillingApi' (Join-Path $services 'api\GSTBillingApi.exe')
        $pgSid=(New-Object Security.Principal.NTAccount('NT SERVICE\GSTBillingPostgres')).Translate([Security.Principal.SecurityIdentifier]).Value
        $apiSid=(New-Object Security.Principal.NTAccount('NT SERVICE\GSTBillingApi')).Translate([Security.Principal.SecurityIdentifier]).Value
        foreach ($sid in @($pgSid,$apiSid,$config.backupAccountSid)) {
            Grant-OfflineAccess $root $sid 'ReadAndExecute'
            foreach ($parent in @('vendor','releases','payload','services')) { Grant-OfflineAccess (Join-Path $root $parent) $sid 'Traverse' }
        }
        Grant-OfflineAccess (Join-Path $root 'payload\installer') $config.backupAccountSid 'ReadAndExecute' $true
        foreach ($entry in @(@{path=$pgRoot;sid=$pgSid},@{path=(Join-Path $services 'postgres');sid=$pgSid},@{path=(Join-Path $root 'payload\installer');sid=$pgSid},@{path=$app;sid=$apiSid},@{path=$app;sid=$config.backupAccountSid},@{path=$nodeRoot;sid=$apiSid},@{path=$nodeRoot;sid=$config.backupAccountSid},@{path=$pgRoot;sid=$config.backupAccountSid},@{path=$runtime;sid=$apiSid},@{path=(Join-Path $services 'api');sid=$apiSid})) { Grant-OfflineAccess $entry.path $entry.sid 'ReadAndExecute' $true }
        foreach ($entry in @(@{path='data';sid=$pgSid},@{path='pg-init';sid=$pgSid},@{path='logs-postgres';sid=$pgSid},@{path='logs-api';sid=$apiSid},@{path='backups';sid=$config.backupAccountSid},@{path='backup-work';sid=$config.backupAccountSid})) { Grant-OfflineAccess (Join-Path $root $entry.path) $entry.sid 'Modify' $true }
        Grant-OfflineAccess $operator $config.backupAccountSid 'Traverse';Grant-OfflineAccess $backupEnv $config.backupAccountSid 'Read'
        Grant-OfflineAccess (Join-Path $root 'backup-key') $config.backupAccountSid 'ReadAndExecute' $true
        Write-OfflineEvent $events 'starting-new-cluster'
        Start-Service GSTBillingPostgres; Wait-OfflineDatabase $config $pgBin
        Assert-OfflineListener $Plan 'GSTBillingPostgres' $config.databasePort (Join-Path $pgBin 'postgres.exe')
        Write-OfflineEvent $events 'provisioning-new-database'
        & $node (Join-Path $app 'packages\database\dist\install-cli.js') (Join-Path $operator 'database-input.json') (Join-Path $operator 'database-receipt.json') *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Initial database provisioning failed.' }
        $databaseReceipt=Get-Content -LiteralPath (Join-Path $operator 'database-receipt.json') -Raw|ConvertFrom-Json
        if ($databaseReceipt.database -cne 'gst_billing' -or $databaseReceipt.schemaDigest -cne $Plan.schemaDigest -or $databaseReceipt.systemIdentifier -notmatch '^\d+$') {throw 'New cluster/schema receipt mismatch.'}
        Write-OfflineEvent $events 'provisioning-owner'
        $previousEnvFile=$env:ENV_FILE
        $env:ENV_FILE=Join-Path $operator 'operator.env'
        try { & $node (Join-Path $app 'apps\api\dist\security\host-cli.js') 'provision' $config.ownerInputFile (Join-Path $operator 'owner-recovery.json') *> $null; if($LASTEXITCODE-ne 0){throw 'Initial owner provisioning failed.'} } finally {$env:ENV_FILE=$previousEnvFile}
        $state=Join-Path $root 'operations\installation.json'
        Write-OfflineFile $state @{format=1;installationId=$config.installationId;version=$Plan.version;schemaDigest=$Plan.schemaDigest;appRoot=$app;operationId=$null}
        Grant-OfflineAccess (Join-Path $root 'operations') $config.backupAccountSid 'Traverse';Grant-OfflineAccess $state $config.backupAccountSid 'Read'
        Write-OfflineEvent $events 'registering-backup'
        $tools=Join-Path $root 'payload\installer'
        & (Join-Path $tools 'Set-BackupSchedule.ps1') -Action Register -InstallationName $config.installationId -BackupAccountSid $config.backupAccountSid -DailyAt $config.backupDailyAt -NodeExecutable $node -NodeSha256 $Plan.review.node.executables.'node.exe' -ApplicationDirectory $app -InstallationStateFile $state -EnvironmentFile $backupEnv -KeyDirectory (Join-Path $root 'backup-key') -OutputDirectory (Join-Path $root 'backups') -WorkDirectory (Join-Path $root 'backup-work') -PgBinDirectory $pgBin -Credential $credential -Confirm:$false *> $null
        $taskXml=Export-ScheduledTask -TaskName $taskName -TaskPath '\';Write-OfflineFile (Join-Path $operator 'backup-task.xml') $taskXml
        New-NetFirewallRule -Name $blockName -DisplayName $blockName -Group $blockName -Direction Inbound -Action Block -Profile Any -Protocol TCP -LocalPort $origin.Port -Program $node -EdgeTraversalPolicy Block | Out-Null
        $null=Get-OfflineInstallBlock $Plan
        Start-Service GSTBillingApi; (Get-Service GSTBillingApi).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
        $healthy=$false
        for($attempt=0;$attempt-lt 30;$attempt++){try{$ready=Invoke-DeploymentHttp ([Uri]::new($origin,'/api/v1/health/ready'));$body=$ready.Content|ConvertFrom-Json;if($ready.StatusCode-eq 200 -and $body.status-ceq 'ready' -and $body.database-ceq 'up'){$healthy=$true;break}}catch{};Start-Sleep -Seconds 1}
        if(-not $healthy){throw 'Trusted HTTPS readiness failed.'}
        $live=Invoke-DeploymentHttp ([Uri]::new($origin,'/api/v1/health'));$l=$live.Content|ConvertFrom-Json
        $front=Invoke-DeploymentHttp $origin
        if($live.StatusCode-ne 200 -or $l.status-cne 'ok' -or $l.service-cne 'gst-api' -or $l.apiVersion-cne '1' -or $front.StatusCode-ne 200 -or $front.ContentType-notmatch '^text/html' -or $front.Content-notmatch 'id="root"'){throw 'Application frontend/liveness validation failed.'}
        Assert-OfflineListener $Plan 'GSTBillingApi' $origin.Port $node
        & $node (Join-Path $app 'apps\api\dist\operations\offline-ready-cli.js') (Join-Path $operator 'native-installation.json') *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Pinned HTTPS admission probe failed.' }
        Write-OfflineEvent $events 'admitting'
        Set-Service GSTBillingPostgres -StartupType Automatic;Set-Service GSTBillingApi -StartupType Automatic
        New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Group ('GSTBilling-'+$config.installationId) -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort $origin.Port -RemoteAddress $config.privateSubnet -Program $node -EdgeTraversalPolicy Block | Out-Null
        Write-OfflineFile (Join-Path $operator 'installed.json') @{installationId=$config.installationId;state='installed';taskSha256=(Get-FileHash -LiteralPath (Join-Path $operator 'backup-task.xml') -Algorithm SHA256).Hash}
        Get-OfflineInstallBlock $Plan | Remove-NetFirewallRule -ErrorAction Stop
        Write-OfflineEvent $events 'installed'
        Remove-Item -LiteralPath (Join-Path $operator 'install.lock')
    } catch {
        try { Stop-OfflineOwnedInstallation $Plan } catch { }
        Write-OfflineEvent $events 'failed-isolated-inspection-required'
        throw 'Installation failed. Retain all files, data and private recovery material for inspection; no automatic reinstall or cleanup was attempted.'
    } finally {$admin=$null;$owner=$null;$api=$null;$auth=$null;$environment=$null;$credential=$null}
}
