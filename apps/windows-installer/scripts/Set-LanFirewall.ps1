[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidateSet('Add', 'Remove')][string] $Action,
    [Parameter(Mandatory)][ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}/(?:[1-9]|[12]\d|3[0-2])$')][string] $PrivateSubnet,
    [Parameter(Mandatory)][string] $NodePath,
    [ValidateRange(1024, 65535)][int] $Port = 3443
)
. "$PSScriptRoot/Common.ps1"
$node = (Resolve-Path -LiteralPath $NodePath).Path
$subnetAddress = [Net.IPAddress]::Parse($PrivateSubnet.Split('/')[0]).GetAddressBytes()
$prefix = [int]$PrivateSubnet.Split('/')[1]
$isPrivate = ($subnetAddress[0] -eq 10 -and $prefix -ge 8) -or
    ($subnetAddress[0] -eq 172 -and $subnetAddress[1] -ge 16 -and $subnetAddress[1] -le 31 -and $prefix -ge 12) -or
    ($subnetAddress[0] -eq 192 -and $subnetAddress[1] -eq 168 -and $prefix -ge 16)
if (-not $isPrivate) { throw 'Use an explicit RFC1918 private subnet, never Any or a public address.' }
$ruleName = "GSTBilling-PoC-HTTPS-$Port"
if ($PSCmdlet.ShouldProcess("$ruleName on Private profile for $PrivateSubnet only", $Action)) {
    Assert-Administrator
    if ($Action -eq 'Add') {
        if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'Rule already exists; review it rather than overwriting.' }
        New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Group 'GST Billing PoC' -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort $Port -RemoteAddress $PrivateSubnet -Program $node -EdgeTraversalPolicy Block | Out-Null
    } else {
        $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
        if ($rule.Group -ne 'GST Billing PoC') { throw 'Refusing to remove a rule not owned by this PoC.' }
        $rule | Remove-NetFirewallRule
    }
}
