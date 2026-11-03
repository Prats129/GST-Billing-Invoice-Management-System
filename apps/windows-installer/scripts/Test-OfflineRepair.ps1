# Real guard/fence and atomic file restoration in generated fixtures. Every
# service/process/network/identity observation and mutating native action mocked.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
. "$PSScriptRoot/OfflineRepair.ps1"
$parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$root=Join-Path $parent ('gst-repair-test-'+[Guid]::NewGuid().ToString('N'))
$operation=[Guid]::NewGuid().ToString();$installation=[Guid]::NewGuid().ToString()
$directory=Join-Path $root ('operations\gst-update-'+$operation);$lock=Join-Path $root 'operations\gst-update.lock'
$null=[IO.Directory]::CreateDirectory($directory);$null=[IO.Directory]::CreateDirectory($lock)
$script:effects=0;$script:alive=$false
function Assert-Administrator {}
function Assert-OfflinePath {param($Path,$Private,$ParentOnly)}
function Assert-OfflineRetainedInputs {param($Request)}
function Get-OfflineNativeObservation {param($Request)return @{fingerprint=('b'*64);actorAlive=$script:alive}}
function Invoke-OfflineUninstall {param($Plan,$Confirmation,$OperationId)$script:effects++}
function Invoke-OfflineRepair {param($Request,$Directory)$script:effects++}
function Assert-Rejected([scriptblock]$Action){$rejected=$false;try{&$Action}catch{$rejected=$true};if(-not $rejected){throw 'Unsafe repair accepted.'}}
try {
    $plan=[PSCustomObject]@{config=[PSCustomObject]@{root=$root;installationId=$installation}}
    $owner=Join-Path $lock 'owner.json';Write-OfflineFile $owner @{operationId=$operation;installationId=$installation;nonce=[Guid]::NewGuid().ToString()}
    Write-OfflineFile (Join-Path $directory 'events.jsonl') ((@{event='update_journal_created';operationKind='uninstall';installationId=$installation;operationId=$operation}|ConvertTo-Json -Compress)+"`n")
    $permit=Join-Path $directory 'native-permit.json';Write-OfflineFile $permit @{operationId=$operation;installationId=$installation;token=[Guid]::NewGuid().ToString();actorPid=999999;createdAt=[DateTime]::UtcNow.ToString('o')}
    $request=[PSCustomObject]@{plan=$plan;action='Run';operationId=$operation;kind='uninstall';ownerSha256=(Get-FileHash $owner -Algorithm SHA256).Hash;permitSha256=(Get-FileHash $permit -Algorithm SHA256).Hash;expectedNativeSha256=('b'*64)}
    $guardPath=Join-Path $directory 'native-execution.guard'
    $guard=New-Object IO.FileStream($guardPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {Assert-Rejected {Invoke-OfflineMaintenance $request}}finally{$guard.Dispose()}
    if($script:effects-ne 0){throw 'Busy execution guard allowed mutation.'}
    $request|Add-Member replacementPermit ((@{operationId=$operation;installationId=$installation;token=[Guid]::NewGuid().ToString();actorPid=999998;createdAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress)+"`n")
    $script:alive=$true;Assert-Rejected {Invoke-OfflineMaintenance $request};$script:alive=$false
    if($script:effects-ne 0){throw 'Live operator allowed recovery.'}
    $result=Invoke-OfflineMaintenance $request
    if(-not $result.ok -or $script:effects-ne 1){throw 'Recovery did not perform exactly one action.'}
    Assert-Rejected {Invoke-OfflineMaintenance $request}
    if($script:effects-ne 1){throw 'Superseded permit allowed a delayed original action.'}
    # Exercise the real replacement primitive, including retained originals and
    # its hard prohibition on writing customer data/configuration/key paths.
    $source=Join-Path $root 'source.txt';[IO.File]::WriteAllText($source,'verified replacement')
    $target=Join-Path $root 'releases\1.0.0\main.txt';$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target));[IO.File]::WriteAllText($target,'original damaged bytes')
    $evidence=Join-Path $root 'evidence';$null=[IO.Directory]::CreateDirectory($evidence)
    $hash=(Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
    Restore-OfflineFile $source $target $hash $root $evidence
    if([IO.File]::ReadAllText($target)-cne 'verified replacement'){throw 'Replacement failed.'}
    $receipts=@(Get-ChildItem -LiteralPath $evidence -Filter '*.json')
    if($receipts.Count-ne 1){throw 'Missing original receipt.'}
    $saved=Read-OfflineJson $receipts[0].FullName
    if($saved.target-cne $target -or [IO.File]::ReadAllText($saved.retained)-cne 'original damaged bytes'){throw 'Original bytes were lost.'}
    Restore-OfflineFile $source $target $hash $root $evidence
    if(@(Get-ChildItem -LiteralPath $evidence -Filter '*.json').Count-ne 1){throw 'Unchanged file was unnecessarily overwritten.'}
    foreach($relative in @('data\PG_VERSION','runtime\runtime.env','backup-key\backup.key','operator\owner-recovery.json','backups\archive.gstbackup')){Assert-Rejected {Restore-OfflineFile $source (Join-Path $root $relative) $hash $root $evidence}}
    Assert-Rejected {Restore-OfflineFile $source $target ('f'*64) $root $evidence}
    # Existing-cluster evidence is mandatory and is never recreated by repair.
    $data=Join-Path $root 'data';$init=Join-Path $root 'pg-init';$null=[IO.Directory]::CreateDirectory($data);$null=[IO.Directory]::CreateDirectory($init)
    $bin=Join-Path $root 'vendor\pgsql\bin';$hashes=[PSCustomObject]@{'bin/initdb.exe'=('a'*64);'bin/postgres.exe'=('a'*64);'bin/pg_ctl.exe'=('a'*64)}
    $cluster=@{installationId=$installation;data=$data;bin=$bin;port=55432;passwordFile=(Join-Path $init 'init-password.txt');hashes=@{'initdb.exe'=('a'*64);'postgres.exe'=('a'*64);'pg_ctl.exe'=('a'*64)}}
    Write-OfflineFile (Join-Path $init 'cluster.json') $cluster
    $marker=Join-Path $data 'gst-cluster.json';Write-OfflineFile $marker @{installationId=$installation;data=$data;bin=$bin;port=55432}
    [IO.File]::WriteAllText((Join-Path $data 'PG_VERSION'),'18')
    $check=[PSCustomObject]@{plan=[PSCustomObject]@{config=[PSCustomObject]@{root=$root;installationId=$installation;databasePort=55432};review=[PSCustomObject]@{postgres=[PSCustomObject]@{directory='pgsql';executables=$hashes}}}}
    Assert-OfflineRetainedCluster $check
    [IO.File]::Delete($marker)
    Assert-Rejected {Assert-OfflineRetainedCluster $check}
    if([IO.File]::Exists($marker) -or [IO.File]::ReadAllText((Join-Path $data 'PG_VERSION'))-cne '18'){throw 'Missing cluster evidence was recreated or data changed.'}
    & {
        $script:redirected=$false;$script:extraWriter=$false
        function Get-Item {param($LiteralPath,[switch]$Force)return [PSCustomObject]@{PSIsContainer=$true;Attributes=$(if($script:redirected){[IO.FileAttributes]::ReparsePoint}else{[IO.FileAttributes]::Directory});Parent=[PSCustomObject]@{FullName='C:\trusted'}}}
        function Get-Acl {
            param($LiteralPath)
            $sid=if($script:extraWriter){'S-1-5-32-545'}else{'S-1-5-21-1-2-3-1001'}
            $acl=[PSCustomObject]@{Access=@((New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]$sid),'Modify','Allow')))}
            $acl|Add-Member ScriptMethod GetOwner {param($Type)return [Security.Principal.SecurityIdentifier]'S-1-5-18'}
            return $acl
        }
        Assert-OfflineWritableDirectory 'C:\trusted\data' 'S-1-5-21-1-2-3-1001'
        $script:redirected=$true;Assert-Rejected {Assert-OfflineWritableDirectory 'C:\trusted\data' 'S-1-5-21-1-2-3-1001'}
        $script:redirected=$false;$script:extraWriter=$true;Assert-Rejected {Assert-OfflineWritableDirectory 'C:\trusted\data' 'S-1-5-21-1-2-3-1001'}
    }
    Write-Output 'PASS: real exclusive maintenance guard, live/stale permit refusal, atomic retained-file repair and customer-data/config/key protection. Machine effects mocked.'
} finally {
    $target=[IO.Path]::GetFullPath($root)
    if([IO.Path]::GetDirectoryName($target)-ne $parent -or [IO.Path]::GetFileName($target)-notmatch '^gst-repair-test-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup.'}
    Remove-Item -LiteralPath $target -Recurse -Force
}
