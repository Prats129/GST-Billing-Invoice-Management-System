# Read the protected pointer after each update, rather than pinning the first
# release's backup CLI forever. This account may read but never change the state.
function Get-BackupInstalledRelease([string] $StateFile, [string] $InstallationId) {
    $path = [IO.Path]::GetFullPath($StateFile)
    if ($path -ne $StateFile -or $path -notmatch '^[A-Za-z]:\\' -or $path -match '["%\r\n]') { throw 'Canonical installed state required.' }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or $item.Length -gt 16384) { throw 'Invalid installed state.' }
    $current = $item
    $trusted = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    # The installer may own the files, but the ordinary backup identity must not.
    while ($null -ne $current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse installed state.' }
        $acl = Get-Acl -LiteralPath $current.FullName
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
        if ($owner.Value -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Backup account cannot own its executable selection.' }
        if ($owner.Value -notin $trusted) {
            $members = @(Get-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]'S-1-5-32-544'))
            if (@($members | Where-Object {$_.SID.Value -eq $owner.Value}).Count -ne 1) { throw 'Untrusted installed-state owner.' }
        }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -eq $owner.Value -or $sid -in $trusted) { continue }
            $rights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
            if ($current.FullName -eq $path) { $rights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
            if (($rule.FileSystemRights -band $rights) -ne 0) { throw 'Writable installed state.' }
        }
        if ($current.PSIsContainer) {$current=$current.Parent} else {$current=$current.Directory}
    }
    $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($state.format -ne 1 -or $state.installationId -cne $InstallationId -or $state.schemaDigest -notmatch '^[a-f0-9]{64}$' -or $state.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Installed state identity mismatch.' }
    $root = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($path))
    $expected = Join-Path $root ('releases\'+$state.version)
    if ($state.appRoot -cne $expected) { throw 'Installed release escaped the installation.' }
    return $expected
}
