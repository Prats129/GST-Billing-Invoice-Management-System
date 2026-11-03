[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Stop','Select','Start','Ready','Admit','Restore','StartOriginal','ReadyOriginal','AdmitOriginal','TlsInspect')][string] $Action)
try {
    . "$PSScriptRoot/UpdateService.ps1"
    if (-not $env:GST_UPDATE_SERVICE -or $env:GST_UPDATE_SERVICE.Length -gt 16384) { throw 'Configuration required.' }
    $configuration = $env:GST_UPDATE_SERVICE | ConvertFrom-Json
    Invoke-UpdateService $Action $configuration
    Write-Output '{"ok":true}'
} catch {
    [Console]::Error.WriteLine('{"event":"windows_update_service_failed","message":"Keep maintenance active and inspect the protected recovery record."}')
    exit 1
}
