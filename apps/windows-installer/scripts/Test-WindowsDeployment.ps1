# Inspect only. Never imports trust, changes firewall/service state or reboots.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Host', 'Client')][string] $Mode,
    [Parameter(Mandatory)][string] $Origin,
    [ValidateRange(1024, 65535)][int] $DatabasePort = 55432,
    [string] $ServiceRoot, [string] $NodePath, [string] $AppRoot,
    [string] $NodeSha256, [string] $WinSwSha256
)
. "$PSScriptRoot/DeploymentChecks.ps1"
try {
    $result = Get-DeploymentObservations -Mode $Mode -Origin $Origin -DatabasePort $DatabasePort -ServiceRoot $ServiceRoot -NodePath $NodePath -AppRoot $AppRoot -NodeSha256 $NodeSha256 -WinSwSha256 $WinSwSha256
    $result | ConvertTo-Json -Depth 5
    if (-not $result.passed) { exit 1 }
} catch {
    Write-Output '{"event":"windows_deployment_check_failed","message":"Check the exact private-LAN HTTPS origin and host parameters. No machine configuration was changed."}'
    exit 1
}
