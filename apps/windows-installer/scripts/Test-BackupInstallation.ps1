# Installed-pointer selection with mocked file/ACL observations only.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/BackupInstallation.ps1"
$script:identity='25a3a48f-7f24-4b65-ae13-b55cd3d5fa31'
$script:state=@{format=1;installationId=$script:identity;schemaDigest=('a'*64);version='1.2.3';appRoot='C:\GST\releases\1.2.3';operationId=$null}
$script:reparse=$false;$script:writable=$false
function Get-Item {
    param($LiteralPath,[switch]$Force)
    return [PSCustomObject]@{FullName=$LiteralPath;PSIsContainer=$false;Length=100;Attributes=$(if($script:reparse){[IO.FileAttributes]::ReparsePoint}else{[IO.FileAttributes]::Normal});Directory=$null}
}
function Get-Acl {
    $value=[PSCustomObject]@{Access=@()}
    if($script:writable){$value.Access=@((New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]'S-1-5-32-545'),'Write','Allow')))}
    $value|Add-Member ScriptMethod GetOwner {param($Type)return [Security.Principal.SecurityIdentifier]'S-1-5-18'}
    return $value
}
function Get-Content {param($LiteralPath,[switch]$Raw) return $script:state|ConvertTo-Json}
function Assert-Rejected([scriptblock]$Action){$failed=$false;try{&$Action}catch{$failed=$true};if(-not $failed){throw 'Unsafe installed pointer accepted.'}}
$file='C:\GST\operations\installation.json'
if((Get-BackupInstalledRelease $file $script:identity) -cne 'C:\GST\releases\1.2.3'){throw 'Current release not selected.'}
$script:state.version='1.2.4';$script:state.appRoot='C:\GST\releases\1.2.4'
if((Get-BackupInstalledRelease $file $script:identity) -cne 'C:\GST\releases\1.2.4'){throw 'Updated release not selected.'}
$script:state.appRoot='C:\Other\1.2.4';Assert-Rejected {Get-BackupInstalledRelease $file $script:identity}
$script:state.appRoot='C:\GST\releases\1.2.4';Assert-Rejected {Get-BackupInstalledRelease $file ([Guid]::NewGuid().ToString())}
$script:reparse=$true;Assert-Rejected {Get-BackupInstalledRelease $file $script:identity}
$script:reparse=$false;$script:writable=$true;Assert-Rejected {Get-BackupInstalledRelease $file $script:identity}
Write-Output 'PASS: mocked backup follows installed release and refuses wrong identity, escaped roots, reparse and writable state. No machine changes.'
