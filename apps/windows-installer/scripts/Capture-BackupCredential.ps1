# Native credential dialog; passwords never enter arguments or this script's output.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Destination)
. "$PSScriptRoot/Common.ps1"
Assert-Administrator
$path = [IO.Path]::GetFullPath($Destination)
if ($path -cne $Destination -or $path -notmatch '^[A-Za-z]:\\' -or $path -match '["%\r\n]' -or (Test-Path -LiteralPath $path)) {
    throw 'Choose a new credential file in an existing protected operator folder.'
}
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
function Get-BackupBatchLogonError([string] $Username, [Security.SecureString] $Password) {
    if (-not ('GSTBackupLogon' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GSTBackupLogon {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    public static extern bool LogonUser(string user, string domain, IntPtr password, int type, int provider, out IntPtr token);
    [DllImport("kernel32.dll", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    public static extern bool CloseHandle(IntPtr token);
}
'@
    }
    $secret = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Password)
    $token = [IntPtr]::Zero
    try {
        # Batch logon tests the effective allow/deny policy, including group policy.
        if (-not [GSTBackupLogon]::LogonUser($Username, '.', $secret, 4, 0, [ref]$token)) {
            return [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        }
        $identity = New-Object Security.Principal.WindowsIdentity($token)
        try {
            if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return 5 }
        } finally { $identity.Dispose() }
        return 0
    } finally {
        if ($token -ne [IntPtr]::Zero) { $null = [GSTBackupLogon]::CloseHandle($token) }
        [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($secret)
    }
}
function Assert-BackupBatchLogon([string] $Username, [Security.SecureString] $Password) {
    $code = Get-BackupBatchLogonError $Username $Password
    if ($code -eq 1385) { throw 'The backup account cannot log on as a batch job. Ask the Windows administrator to allow batch logon and remove any applicable deny policy; then retry credential preparation. No policy was changed.' }
    if ($code -ne 0) { throw 'Backup account batch-logon verification failed. Check the local standard account password, account restrictions and Windows security policy, then retry. No credential was saved.' }
}
Assert-OfflinePath ([IO.Path]::GetDirectoryName($path)) $true
$credential = Get-Credential -Message 'Existing enabled local backup account (not an administrator)'
if ($null -eq $credential) { throw 'Credential capture cancelled.' }
try {
    $sid = (New-Object Security.Principal.NTAccount($credential.UserName)).Translate([Security.Principal.SecurityIdentifier]).Value
    Assert-OfflineBackupAccount ([PSCustomObject]@{ backupAccountSid = $sid }) $credential
    $local = Get-LocalUser -SID ([Security.Principal.SecurityIdentifier]$sid)
    Assert-BackupBatchLogon $local.Name $credential.Password
    $file = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $xml = [Management.Automation.PSSerializer]::Serialize($credential)
        $bytes = [Text.Encoding]::UTF8.GetBytes($xml)
        $file.Write($bytes, 0, $bytes.Length); $file.Flush($true)
    } finally { $file.Dispose() }
    [Console]::Out.WriteLine(('Credential saved with Windows protection; batch logon verified now (policy may change). Backup account SID: ' + $sid))
} finally { $credential = $null; $xml = $null; $bytes = $null }
