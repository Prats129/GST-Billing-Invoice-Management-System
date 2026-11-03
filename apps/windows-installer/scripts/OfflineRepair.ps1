# Trusted operator definitions. All mutating calls are fenced by the shared
# operation's exclusive execution handle. Tests replace machine effects.
function Get-OfflineBytesHash([byte[]]$Bytes) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try {return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
}
function Read-OfflineJson([string]$Path,[int]$Maximum=32768) {
    $item=Get-Item -LiteralPath $Path -Force
    if($item.PSIsContainer -or $item.Length -gt $Maximum -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Invalid maintenance input.'}
    $text=[IO.File]::ReadAllText($Path)
    if([Text.Encoding]::UTF8.GetByteCount($text)-gt $Maximum){throw 'Oversized maintenance input.'}
    return $text|ConvertFrom-Json
}
function Get-OfflineOperationDirectory($Request) {
    $id=[Guid]::Empty
    if(-not [Guid]::TryParseExact([string]$Request.operationId,'D',[ref]$id)){throw 'Operation UUID required.'}
    return Join-Path $Request.plan.config.root ('operations\gst-update-'+$Request.operationId)
}
function Test-OfflineActorAlive($Permit) {
    $actor=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$Permit.actorPid) -ErrorAction Stop
    if($null -eq $actor){return $false}
    # A reused PID born after the saved permit is not the original operator.
    return $actor.CreationDate.ToUniversalTime() -le [DateTime]::Parse($Permit.createdAt).ToUniversalTime()
}
function Get-OfflineNativeObservation($Request) {
    $plan=$Request.plan
    Assert-OfflinePath (Join-Path $plan.config.root 'operator') $true
    $services=@()
    foreach($name in @('GSTBillingApi','GSTBillingPostgres')) {
        $service=Get-OfflineOwnedService $plan $name
        if($null -eq $service){$services+=[ordered]@{name=$name;present=$false}}
        else {$services+=[ordered]@{name=$name;present=$true;state=[string]$service.State;mode=[string]$service.StartMode;pid=[int]$service.ProcessId}}
    }
    $task=Get-OfflineOwnedTask $plan;$rule=Get-OfflineOwnedFirewall $plan;$block=Get-OfflineInstallBlock $plan
    $alive=$false;$permitHash=$null
    if($Request.operationId) {
        $directory=Get-OfflineOperationDirectory $Request
        Assert-OfflinePath $directory $true
        $permitPath=Join-Path $directory 'native-permit.json';Assert-OfflinePath $permitPath $true
        $permit=Read-OfflineJson $permitPath 2048
        if($permit.installationId -cne $plan.config.installationId -or $permit.operationId -cne $Request.operationId){throw 'Wrong native permit.'}
        $alive=Test-OfflineActorAlive $permit
        $permitHash=(Get-FileHash -LiteralPath $permitPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $value=[ordered]@{services=$services;task=$null;firewall=($null-ne $rule);blocked=($null-ne $block);actorAlive=[bool]$alive;permit=$permitHash}
    if($null-ne $task){$value.task=[ordered]@{state=[string]$task.State;enabled=[bool]$task.Settings.Enabled}}
    return @{fingerprint=(Get-OfflineBytesHash ([Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 10 -Compress))));actorAlive=[bool]$alive}
}
function Invoke-OfflineMaintenance($Request) {
    Assert-Administrator
    if($Request.action -eq 'Inspect') {
        $guard=$null
        try {
            if($Request.operationId) {
                $guardPath=Join-Path (Get-OfflineOperationDirectory $Request) 'native-execution.guard'
                if(Test-Path -LiteralPath $guardPath){$guard=New-Object IO.FileStream($guardPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
            }
            return Get-OfflineNativeObservation $Request
        } finally {if($null-ne $guard){$guard.Dispose()}}
    }
    if($Request.action -cne 'Run' -or $Request.kind -notin @('uninstall','repair')){throw 'Unknown maintenance action.'}
    $directory=Get-OfflineOperationDirectory $Request;Assert-OfflinePath $directory $true
    $guardPath=Join-Path $directory 'native-execution.guard'
    $guard=New-Object IO.FileStream($guardPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        $ownerPath=Join-Path $Request.plan.config.root 'operations\gst-update.lock\owner.json'
        Assert-OfflinePath $ownerPath $true
        if((Get-FileHash -LiteralPath $ownerPath -Algorithm SHA256).Hash -ne $Request.ownerSha256){throw 'Shared lock changed.'}
        $owner=Read-OfflineJson $ownerPath 1024
        if($owner.installationId -cne $Request.plan.config.installationId -or $owner.operationId -cne $Request.operationId){throw 'Wrong shared lock.'}
        $header=(Get-Content -LiteralPath (Join-Path $directory 'events.jsonl') -TotalCount 1)|ConvertFrom-Json
        if($header.operationKind -cne $Request.kind -or $header.installationId -cne $owner.installationId -or $header.operationId -cne $owner.operationId){throw 'Wrong maintenance journal.'}
        $permitPath=Join-Path $directory 'native-permit.json';Assert-OfflinePath $permitPath $true
        if((Get-FileHash -LiteralPath $permitPath -Algorithm SHA256).Hash -ne $Request.permitSha256){throw 'Superseded operator.'}
        $observed=Get-OfflineNativeObservation $Request
        if($observed.fingerprint -cne $Request.expectedNativeSha256){throw 'Native state changed after inspection.'}
        if($null-ne $Request.PSObject.Properties['replacementPermit']) {
            if($observed.actorAlive){throw 'Previous operator still running.'}
            $replacement=$Request.replacementPermit|ConvertFrom-Json
            $newToken=[Guid]::Empty
            if($replacement.installationId -cne $owner.installationId -or $replacement.operationId -cne $owner.operationId -or -not [Guid]::TryParseExact([string]$replacement.token,'D',[ref]$newToken)){throw 'Invalid recovery permit.'}
            $temporary=Join-Path $directory ('permit-'+$replacement.token+'.json')
            Write-OfflineFile $temporary ([string]$Request.replacementPermit)
            [IO.File]::Replace($temporary,$permitPath,(Join-Path $directory ('permit-before-'+$replacement.token+'.json')))
        }
        Assert-OfflineRetainedInputs $Request
        if($Request.kind -eq 'uninstall'){Invoke-OfflineUninstall $Request.plan $owner.installationId $owner.operationId}
        else {Invoke-OfflineRepair $Request $directory}
        return @{ok=$true}
    } finally {$guard.Dispose()}
}
function Get-OfflineServiceSid([string]$Name) {
    if($Name -notin @('GSTBillingApi','GSTBillingPostgres')){throw 'Unknown service SID.'}
    $output=& (Join-Path $env:SystemRoot 'System32\sc.exe') 'showsid' $Name
    if($LASTEXITCODE-ne 0){throw 'Cannot derive dedicated service identity.'}
    $matches=[regex]::Matches(($output -join "`n"),'S-1-5-80-(?:\d+-){4}\d+')
    if($matches.Count-ne 1){throw 'Ambiguous service SID.'}
    return $matches[0].Value
}
function Assert-OfflineRetainedInputs($Request) {
    $root=$Request.plan.config.root
    $apiSid=Get-OfflineServiceSid 'GSTBillingApi';$backupSid=$Request.plan.config.backupAccountSid
    foreach($entry in $Request.protectedFiles.PSObject.Properties) {
        $path=Get-OfflineChild $root $entry.Name
        Assert-OfflinePath $path
        if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.Value){throw 'Retained configuration or keys changed.'}
        $readers=@()
        if($entry.Name -like 'runtime/*'){$readers+=@($apiSid)}
        if($entry.Name -like 'backup-key/*' -or $entry.Name -in @('operator/backup.env','operations/installation.json')){$readers+=@($backupSid)}
        $trusted=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')+$readers
        foreach($rule in (Get-Acl -LiteralPath $path).Access) {
            if($rule.AccessControlType-ne 'Allow' -or ($rule.PropagationFlags-band [Security.AccessControl.PropagationFlags]::InheritOnly)-ne 0){continue}
            $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if($sid-notin $trusted -and ($rule.FileSystemRights-band [Security.AccessControl.FileSystemRights]::ReadData)-ne 0){throw 'Private retained input exposed.'}
        }
    }
}
function Restore-OfflineFile([string]$Source,[string]$Target,[string]$Sha256,[string]$Root,[string]$Evidence) {
    if($Sha256 -notmatch '^[a-f0-9]{64}$' -or [IO.Path]::GetFullPath($Target)-cne $Target -or -not $Target.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid repair file.'}
    $allowed=$false
    foreach($prefix in @('releases','vendor','services','payload\installer')){if($Target.StartsWith((Join-Path $Root $prefix)+'\',[StringComparison]::OrdinalIgnoreCase)){$allowed=$true}}
    if(-not $allowed){throw 'Repair cannot overwrite customer data, configuration or keys.'}
    Assert-OfflinePath $Source
    if((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash-ne $Sha256){throw 'Signed repair source changed.'}
    $parent=[IO.Path]::GetDirectoryName($Target);$ancestor=$parent
    while(-not (Test-Path -LiteralPath $ancestor)){$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
    Assert-OfflinePath $ancestor
    $null=[IO.Directory]::CreateDirectory($parent)
    $temporary=Join-Path $parent ('repair-'+[Guid]::NewGuid().ToString('N')+'.tmp')
    if(Test-Path -LiteralPath $Target) {
        Assert-OfflinePath $Target
        if((Get-Item -LiteralPath $Target -Force).PSIsContainer){throw 'Expected repair file.'}
        if((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash-eq $Sha256){return}
    }
    [IO.File]::Copy($Source,$temporary,$false)
    if((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash-ne $Sha256){throw 'Repair copy changed.'}
    if(Test-Path -LiteralPath $Target){
        $id=[Guid]::NewGuid().ToString('N');$backup=Join-Path $Evidence ('retained-'+$id+'.bin')
        Write-OfflineFile (Join-Path $Evidence ('retained-'+$id+'.json')) @{target=$Target;originalSha256=(Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash;retained=$backup;replacementSha256=$Sha256}
        [IO.File]::Replace($temporary,$Target,$backup)
    }
    else {[IO.File]::Move($temporary,$Target)}
    if((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash-ne $Sha256){throw 'Repair replacement failed.'}
}
function Assert-OfflineRetainedCluster($Request) {
    $plan=$Request.plan;$root=$plan.config.root
    $cluster=Read-OfflineJson (Join-Path $root 'pg-init\cluster.json')
    $bin=Join-Path $root ('vendor\'+$plan.review.postgres.directory+'\bin')
    if($cluster.installationId -cne $plan.config.installationId -or $cluster.data -cne (Join-Path $root 'data') -or $cluster.bin -cne $bin -or $cluster.port-ne $plan.config.databasePort -or $cluster.passwordFile-cne (Join-Path $root 'pg-init\init-password.txt')){throw 'Retained cluster configuration mismatch.'}
    foreach($name in @('initdb.exe','postgres.exe','pg_ctl.exe')){if($cluster.hashes.$name -cne $plan.review.postgres.executables.('bin/'+$name)){throw 'Retained cluster tool mismatch.'}}
    $marker=Read-OfflineJson (Join-Path $root 'data\gst-cluster.json')
    if($marker.installationId -cne $cluster.installationId -or $marker.data -cne $cluster.data -or $marker.bin -cne $cluster.bin -or $marker.port-ne $cluster.port -or ([IO.File]::ReadAllText((Join-Path $root 'data\PG_VERSION'))).Trim()-cne '18'){throw 'Existing initialized cluster required.'}
}
function Assert-OfflineWritableDirectory([string]$Path,[string]$Writer) {
    $item=Get-Item -LiteralPath $Path -Force
    if(-not $item.PSIsContainer -or ($item.Attributes-band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Writable data directory must not be redirected.'}
    Assert-OfflinePath $item.Parent.FullName
    $acl=Get-Acl -LiteralPath $Path
    $trusted=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
    if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value-notin $trusted){throw 'Unknown retained directory owner.'}
    foreach($rule in $acl.Access) {
        if($rule.AccessControlType-ne 'Allow' -or ($rule.PropagationFlags-band [Security.AccessControl.PropagationFlags]::InheritOnly)-ne 0){continue}
        $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if($sid-in $trusted){continue}
        if($sid-cne $Writer -and ($rule.FileSystemRights-band [Security.AccessControl.FileSystemRights]'ReadData,Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership')-ne 0){throw 'Unexpected retained data access.'}
        if(($rule.FileSystemRights-band [Security.AccessControl.FileSystemRights]'ChangePermissions,TakeOwnership')-ne 0){throw 'Writer can change retained data permissions.'}
    }
}
function Assert-OfflineRepairDefinitions($Request) {
    $root=$Request.plan.config.root;$node=Join-Path $root ('vendor\'+$Request.plan.review.node.directory+'\node.exe')
    foreach($name in @('GSTBillingApi','GSTBillingPostgres')) {
        $service=Get-OfflineOwnedService $Request.plan $name
        if($null-eq $service -or $service.State-eq 'Stopped'){continue}
        $directory=if($name-eq 'GSTBillingApi'){'api'}else{'postgres'}
        $xml=Read-DeploymentServiceXml (Join-Path $root ('services\'+$directory+'\'+$name+'.xml'))
        if((Get-DeploymentServiceAccount $xml)-cne ('NT SERVICE\'+$name) -or $xml.service.id-cne $name){throw 'Running service definition changed.'}
        if($name-eq 'GSTBillingApi') {
            if($xml.service.executable-cne $node -or $xml.service.workingdirectory-cne $Request.repair.appRoot -or $xml.service.arguments-cne ('"'+(Join-Path $Request.repair.appRoot 'apps\api\dist\main.js')+'"')){throw 'Running API definition changed.'}
        }
        foreach($element in $xml.service.ChildNodes){if($element.get_Name()-notin @('id','name','description','executable','arguments','startarguments','workingdirectory','startmode','stoptimeout','logpath','log','serviceaccount','env','depend','stopexecutable','stoparguments')){throw 'Unknown running service hook.'}}
        if($name-eq 'GSTBillingApi' -and ($xml.service.SelectNodes('stopexecutable|stoparguments|startarguments').Count-ne 0)){throw 'Unexpected API start/stop hook.'}
        if($name-eq 'GSTBillingPostgres') {
            $pg=Join-Path $root ('vendor\'+$Request.plan.review.postgres.directory+'\bin')
            $expected='-NoLogo -NoProfile -NonInteractive -File "'+(Join-Path $root 'payload\installer\Start-OfflinePostgres.ps1')+'" -Configuration "'+(Join-Path $root 'pg-init\cluster.json')+'"'
            if($xml.service.executable-cne (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -or $xml.service.startarguments-notin @($expected,($expected+' -ExistingClusterOnly')) -or $xml.service.stopexecutable-cne (Join-Path $pg 'pg_ctl.exe') -or $xml.service.stoparguments-cne ('-D "'+(Join-Path $root 'data')+'" -m fast -w stop')){throw 'Running PostgreSQL definition changed.'}
        }
    }
}
function Save-OfflineRepairXml([Xml.XmlDocument]$Xml,[string]$Path,[string]$Evidence) {
    $source=Join-Path $Evidence ('definition-'+[Guid]::NewGuid().ToString('N')+'.xml')
    $Xml.Save($source)
    Restore-OfflineFile $source $Path ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) ([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($Path)))) $Evidence
}
function Invoke-OfflineRepair($Request,[string]$Directory) {
    $plan=$Request.plan;$repair=$Request.repair;$root=$plan.config.root
    if($null-eq $repair){throw 'Verified repair inputs required.'}
    Assert-OfflineFirewall
    $pgSid=Get-OfflineServiceSid 'GSTBillingPostgres';$apiSid=Get-OfflineServiceSid 'GSTBillingApi';$backupSid=$plan.config.backupAccountSid
    foreach($entry in @(@{path='data';sid=$pgSid},@{path='pg-init';sid=$pgSid},@{path='logs-postgres';sid=$pgSid},@{path='logs-api';sid=$apiSid},@{path='backups';sid=$backupSid},@{path='backup-work';sid=$backupSid})) {
        $path=Join-Path $root $entry.path
        if(Test-Path -LiteralPath $path){Assert-OfflineWritableDirectory $path $entry.sid}
        elseif($entry.path-in @('data','pg-init')){throw 'Retained database directories required.'}
    }
    Assert-OfflineRetainedCluster $Request;Assert-OfflineRepairDefinitions $Request
    $origin=[Uri]$plan.config.origin;$addresses=@(Resolve-DeploymentAddresses $origin.DnsSafeHost)
    if($addresses.Count-ne 1 -or $addresses[0].AddressFamily-ne [Net.Sockets.AddressFamily]::InterNetwork -or $addresses[0].ToString()-cne $repair.host -or $repair.host-notin @(Get-NetIPAddress|ForEach-Object {$_.IPAddress}) -or (-not [Net.IPAddress]::IsLoopback($addresses[0]) -and -not (Test-DeploymentPrivateAddress $addresses[0]))){throw 'Retained HTTPS network binding changed.'}
    if(-not [Net.IPAddress]::IsLoopback($addresses[0])) {
        $interfaces=@(Get-NetIPAddress -IPAddress $repair.host -ErrorAction Stop)
        if($interfaces.Count-ne 1 -or (Get-NetConnectionProfile -InterfaceIndex $interfaces[0].InterfaceIndex -ErrorAction Stop).NetworkCategory-ne 'Private'){throw 'Private LAN profile required.'}
    }
    foreach($input in $repair.inputHashes.PSObject.Properties){Assert-OfflinePath $input.Name $true;if((Get-FileHash -LiteralPath $input.Name -Algorithm SHA256).Hash-ne $input.Value){throw 'Repair input changed.'}}
    $credential=Import-Clixml -LiteralPath $repair.config.backupCredentialFile
    if($credential-isnot [PSCredential]){throw 'Dedicated backup credential required.'};Assert-OfflineBackupAccount $plan.config $credential
    Stop-OfflineOwnedInstallation $plan
    Set-OfflineIsolation $plan
    $attempt=Join-Path $Directory ('repair-'+[Guid]::NewGuid().ToString('N'));$null=New-PrivateDirectory $attempt
    Write-OfflineFile (Join-Path $attempt 'state.json') @{phase='stopped';installationId=$plan.config.installationId;version=$repair.version}
    try {
        foreach($file in $repair.files){Restore-OfflineFile $file.source $file.destination $file.sha256 $root $attempt}
        $vendor=Join-Path $attempt 'vendor';$null=New-PrivateDirectory $vendor
        foreach($entry in @(@{artifact=$plan.review.node;record=$repair.nodeArchive},@{artifact=$plan.review.postgres;record=$repair.postgresArchive})) {
            $archive=Get-OfflineChild $repair.config.bundleRoot $entry.record.path
            if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash-ne $entry.record.sha256){throw 'Approved repair archive changed.'}
            Expand-OfflineArchive $archive $vendor $entry.artifact.directory
        }
        $expectedVendor=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach($file in Get-ChildItem -LiteralPath $vendor -Recurse -File -Force) {
            $relative=$file.FullName.Substring($vendor.Length+1)
            $null=$expectedVendor.Add($relative)
            Restore-OfflineFile $file.FullName (Join-Path $root ('vendor\'+$relative)) ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) $root $attempt
        }
        foreach($tree in @($plan.review.node.directory,$plan.review.postgres.directory)) {
            $pending=New-Object 'Collections.Generic.Stack[string]';$pending.Push((Join-Path $root ('vendor\'+$tree)));$count=0
            while($pending.Count-gt 0) {
                $parent=$pending.Pop();Assert-OfflinePath $parent
                foreach($child in Get-ChildItem -LiteralPath $parent -Force) {
                    if(++$count-gt 100000){throw 'Oversized retained vendor tree.'};Assert-OfflinePath $child.FullName
                    if($child.PSIsContainer){$pending.Push($child.FullName)}
                    elseif(-not $expectedVendor.Contains($child.FullName.Substring((Join-Path $root 'vendor').Length+1))){throw 'Unlisted retained vendor file; preserve and inspect.'}
                }
            }
        }
        $wrapper=Get-OfflineChild $repair.config.bundleRoot $repair.wrapper.path
        foreach($entry in @(@{directory='api';name='GSTBillingApi'},@{directory='postgres';name='GSTBillingPostgres'})) {
            $path=Join-Path $root ('services\'+$entry.directory);if(-not(Test-Path -LiteralPath $path)){$null=New-PrivateDirectory $path}
            Restore-OfflineFile $wrapper (Join-Path $path ($entry.name+'.exe')) $repair.wrapper.sha256 $root $attempt
        }
        foreach($file in $Request.tools.helpers){Restore-OfflineFile $file.source $file.destination $file.sha256 $root $attempt}
        $nodeRoot=Join-Path $root ('vendor\'+$plan.review.node.directory);$node=Join-Path $nodeRoot 'node.exe'
        $pgRoot=Join-Path $root ('vendor\'+$plan.review.postgres.directory);$pgBin=Join-Path $pgRoot 'bin'
        $powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $pgXml=New-OfflineServiceXml 'GSTBillingPostgres' $powerShell ('-NoLogo -NoProfile -NonInteractive -File "'+(Join-Path $root 'payload\installer\Start-OfflinePostgres.ps1')+'" -Configuration "'+(Join-Path $root 'pg-init\cluster.json')+'" -ExistingClusterOnly') $pgRoot (Join-Path $root 'logs-postgres')
        $old=$pgXml.service.SelectSingleNode('arguments');$start=$pgXml.CreateElement('startarguments');$start.InnerText=$old.InnerText;$null=$pgXml.service.ReplaceChild($start,$old)
        foreach($entry in @{stopexecutable=(Join-Path $pgBin 'pg_ctl.exe');stoparguments=('-D "'+(Join-Path $root 'data')+'" -m fast -w stop')}.GetEnumerator()){$element=$pgXml.CreateElement($entry.Key);$element.InnerText=$entry.Value;$null=$pgXml.service.AppendChild($element)}
        Save-OfflineRepairXml $pgXml (Join-Path $root 'services\postgres\GSTBillingPostgres.xml') $attempt
        $apiXml=New-OfflineServiceXml 'GSTBillingApi' $node ('"'+(Join-Path $repair.appRoot 'apps\api\dist\main.js')+'"') $repair.appRoot (Join-Path $root 'logs-api') (Join-Path $root 'runtime\runtime.env') 'GSTBillingPostgres'
        # WEB_ROOT overrides the original environment after a supported update.
        $web=$apiXml.CreateElement('env');$web.SetAttribute('name','WEB_ROOT');$web.SetAttribute('value',(Join-Path $repair.appRoot 'apps\web\dist'));$null=$apiXml.service.AppendChild($web)
        Save-OfflineRepairXml $apiXml (Join-Path $root 'services\api\GSTBillingApi.xml') $attempt
        foreach($entry in @(@{name='GSTBillingApi';directory='api'},@{name='GSTBillingPostgres';directory='postgres'})) {
            if($null-eq (Get-OfflineOwnedService $plan $entry.name)){Register-OfflineService $entry.name (Join-Path $root ('services\'+$entry.directory+'\'+$entry.name+'.exe'))}
            Set-Service $entry.name -StartupType Manual
        }
        foreach($sid in @($pgSid,$apiSid,$backupSid)) {
            Grant-OfflineAccess $root $sid 'ReadAndExecute'
            foreach($parent in @('vendor','releases','payload','services')){Grant-OfflineAccess (Join-Path $root $parent) $sid 'Traverse'}
        }
        foreach($entry in @(@{path=$pgRoot;sid=$pgSid},@{path=$pgRoot;sid=$backupSid},@{path=$nodeRoot;sid=$apiSid},@{path=$nodeRoot;sid=$backupSid},@{path=$repair.appRoot;sid=$apiSid},@{path=$repair.appRoot;sid=$backupSid},@{path=(Join-Path $root 'services\api');sid=$apiSid},@{path=(Join-Path $root 'services\postgres');sid=$pgSid},@{path=(Join-Path $root 'payload\installer');sid=$pgSid},@{path=(Join-Path $root 'payload\installer');sid=$backupSid})) {Grant-OfflineAccess $entry.path $entry.sid 'ReadAndExecute' $true}
        Grant-OfflineAccess (Join-Path $root 'runtime') $apiSid 'ReadAndExecute' $true
        foreach($entry in @(@{path='data';sid=$pgSid},@{path='pg-init';sid=$pgSid},@{path='logs-postgres';sid=$pgSid},@{path='logs-api';sid=$apiSid},@{path='backups';sid=$backupSid},@{path='backup-work';sid=$backupSid})) {
            $path=Join-Path $root $entry.path
            if(-not(Test-Path -LiteralPath $path)){
                if($entry.path-in @('data','pg-init')){throw 'Retained database directories must already exist.'}
                $null=New-PrivateDirectory $path
            }
            Assert-OfflineWritableDirectory $path $entry.sid
            Grant-OfflineAccess $path $entry.sid 'Modify' $true
        }
        foreach($path in @('operator','operations')){Grant-OfflineAccess (Join-Path $root $path) $backupSid 'Traverse'}
        foreach($path in @('operator\backup.env','operations\installation.json')){Grant-OfflineAccess (Join-Path $root $path) $backupSid 'Read'}
        Grant-OfflineAccess (Join-Path $root 'backup-key') $backupSid 'ReadAndExecute' $true
        Start-Service GSTBillingPostgres;Wait-OfflineDatabase $plan.config $pgBin
        Assert-OfflineListener $plan 'GSTBillingPostgres' $plan.config.databasePort (Join-Path $pgBin 'postgres.exe')
        Assert-OfflinePath $Request.tools.node;Assert-OfflinePath $Request.tools.verifier
        $null=Get-VerifiedExecutable $Request.tools.node $Request.tools.nodeSha256
        if((Get-FileHash -LiteralPath $Request.tools.verifier -Algorithm SHA256).Hash-ne $Request.tools.verifierSha256){throw 'Trusted read-only verifier changed.'}
        Assert-OfflinePath $Request.tools.appVerifier
        if((Get-FileHash -LiteralPath $Request.tools.appVerifier -Algorithm SHA256).Hash-ne $Request.tools.appVerifierSha256){throw 'Trusted tree verifier changed.'}
        & $Request.tools.node $Request.tools.appVerifier $repair.appRoot $repair.config.releaseTrustFile $repair.inputHashes.($repair.config.releaseTrustFile) $repair.version $repair.schemaDigest *> $null
        if($LASTEXITCODE-ne 0){throw 'Repaired application signature/inventory verification failed.'}
        & $Request.tools.node $Request.tools.verifier $root $repair.schemaDigest *> $null
        if($LASTEXITCODE-ne 0){throw 'Retained database verification failed.'}
        Restore-OfflineBackupTask $plan $credential
        Assert-OfflineRetainedInputs $Request
        Start-Service GSTBillingApi;(Get-Service GSTBillingApi).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
        Assert-OfflineRepairReady $Request $node
        Set-Service GSTBillingPostgres -StartupType Automatic;Set-Service GSTBillingApi -StartupType Automatic
        Enable-ScheduledTask -TaskName ('GSTBilling-Backup-'+$plan.config.installationId) -TaskPath '\'|Out-Null
        $name='GSTBilling-HTTPS-'+$plan.config.installationId
        New-NetFirewallRule -Name $name -DisplayName $name -Group ('GSTBilling-'+$plan.config.installationId) -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort ([Uri]$plan.config.origin).Port -RemoteAddress $plan.config.privateSubnet -Program $node -EdgeTraversalPolicy Block|Out-Null
        $null=Get-OfflineOwnedFirewall $plan
        Write-OfflineEvent (Join-Path $attempt 'events.jsonl') 'repaired-data-retained'
        Get-OfflineInstallBlock $plan|Remove-NetFirewallRule -ErrorAction Stop
    } catch {
        try{Stop-OfflineOwnedInstallation $plan}catch{}
        throw 'Repair failed; retain data, originals and maintenance evidence for explicit recovery.'
    } finally {$credential=$null}
}
function Restore-OfflineBackupTask($Plan,[PSCredential]$Credential) {
    $existing=Get-OfflineOwnedTask $Plan
    $xml=Get-Content -LiteralPath (Join-Path $Plan.config.root 'operator\backup-task.xml') -Raw
    $document=ConvertFrom-DeploymentXml $xml
    $ns=New-Object Xml.XmlNamespaceManager($document.NameTable);$ns.AddNamespace('t',$document.DocumentElement.NamespaceURI)
    $working=$document.SelectSingleNode('//t:WorkingDirectory',$ns).InnerText
    $parent=Join-Path $Plan.config.root 'releases'
    if([IO.Path]::GetDirectoryName($working)-cne $parent -or [IO.Path]::GetFileName($working)-notmatch '^\d+\.\d+\.\d+$'){throw 'Unknown retained backup working directory.'}
    if(-not(Test-Path -LiteralPath $working)){$null=New-PrivateDirectory $working}
    Grant-OfflineAccess $working $Plan.config.backupAccountSid 'ReadAndExecute'
    if($null-ne $existing){return}
    $password=$Credential.GetNetworkCredential().Password
    try {$null=Register-ScheduledTask -TaskName ('GSTBilling-Backup-'+$Plan.config.installationId) -TaskPath '\' -Xml $xml -User $Credential.UserName -Password $password -ErrorAction Stop}
    finally {$password=$null}
    $null=Get-OfflineOwnedTask $Plan
    Disable-ScheduledTask -TaskName ('GSTBilling-Backup-'+$Plan.config.installationId) -TaskPath '\'|Out-Null
}
function Assert-OfflineRepairReady($Request,[string]$Node) {
    $origin=[Uri]$Request.plan.config.origin;$ready=$false
    for($attempt=0;$attempt-lt 60;$attempt++){try{$response=Invoke-DeploymentHttp ([Uri]::new($origin,'/api/v1/health/ready'));$body=$response.Content|ConvertFrom-Json;if($response.StatusCode-eq 200 -and $body.status-ceq 'ready' -and $body.database-ceq 'up'){$ready=$true;break}}catch{};Start-Sleep -Seconds 1}
    if(-not $ready){throw 'Repair HTTPS readiness failed.'}
    Assert-OfflineListener $Request.plan 'GSTBillingApi' $origin.Port $Node
    $live=Invoke-DeploymentHttp ([Uri]::new($origin,'/api/v1/health'));$body=$live.Content|ConvertFrom-Json;$front=Invoke-DeploymentHttp $origin
    if($live.StatusCode-ne 200 -or $body.status-cne 'ok' -or $body.service-cne 'gst-api' -or $body.apiVersion-cne '1' -or $front.StatusCode-ne 200 -or $front.ContentType-notmatch '^text/html' -or $front.Content-notmatch 'id="root"'){throw 'Repair frontend/liveness failed.'}
    # The trusted operator probe is supplied separately, so an older retained
    # application does not need a new maintenance CLI injected into its signature.
    Assert-OfflinePath $Request.tools.readyVerifier
    if((Get-FileHash -LiteralPath $Request.tools.readyVerifier -Algorithm SHA256).Hash-ne $Request.tools.readyVerifierSha256){throw 'Trusted HTTPS verifier changed.'}
    & $Request.tools.node $Request.tools.readyVerifier $Request.plan.config.origin $Request.repair.config.certificateTrustFile $Request.repair.config.certificateTrustSha256 $Request.repair.leafSha256 *> $null
    if($LASTEXITCODE-ne 0){throw 'Pinned repair HTTPS probe failed.'}
}
