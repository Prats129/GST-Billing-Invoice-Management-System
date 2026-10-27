Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this operation in an elevated PowerShell console on the disposable PoC host.'
    }
}

function Get-VerifiedExecutable([string] $Path, [string] $Sha256) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'An independently verified SHA-256 is required.' }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ([IO.Path]::GetExtension($resolved) -ne '.exe') { throw 'Expected an executable.' }
    if ((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash -ne $Sha256) {
        throw 'Executable checksum mismatch. Nothing was executed.'
    }
    return $resolved
}

function Invoke-Checked([string] $Executable, [string[]] $Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "External command failed (exit $LASTEXITCODE)." }
}

function New-PrivateDirectory([string] $Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (Test-Path -LiteralPath $resolved) { throw "Refusing to overwrite existing path: $resolved" }
    $directory = New-Item -ItemType Directory -Path $resolved
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($currentSid, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $directory.FullName -AclObject $acl
    return $directory.FullName
}
