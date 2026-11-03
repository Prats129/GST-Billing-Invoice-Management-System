# WinSW proof of concept, not an installer. No download, auto-upgrade or data deletion.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidateSet('Prepare', 'Install', 'Start', 'Stop', 'Uninstall')][string] $Action,
    [Parameter(Mandatory)][string] $ServiceRoot,
    [string] $WinSwPath,
    [string] $WinSwSha256,
    [string] $NodePath,
    [string] $AppRoot,
    [string] $EnvironmentFile
)
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
$root = [IO.Path]::GetFullPath($ServiceRoot)
$wrapper = Join-Path $root 'GSTBillingApiPoC.exe'
$markerPath = Join-Path $root 'gst-billing-poc-service.json'
if ($Action -eq 'Prepare') {
    $verifiedWrapper = Get-VerifiedExecutable $WinSwPath $WinSwSha256
    $node = (Resolve-Path -LiteralPath $NodePath).Path
    $application = (Resolve-Path -LiteralPath $AppRoot).Path
    $entry = Join-Path $application 'apps/api/dist/main.js'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Build the API first; expected apps/api/dist/main.js.' }
    $sourceEnv = (Resolve-Path -LiteralPath $EnvironmentFile).Path
    $config = Get-Content -LiteralPath $sourceEnv -Raw
    foreach ($required in @('(?m)^NODE_ENV=production\s*$', '(?m)^DEPLOYMENT_EDITION=offline\s*$', '(?m)^TLS_KEY_PATH=.+$', '(?m)^TLS_CERT_PATH=.+$', '(?m)^APP_ORIGIN=https://.+$', '(?m)^ALLOWED_HOSTS=.+$', '(?m)^WEB_ROOT=.+$')) {
        if ($config -notmatch $required) { throw 'Use a production offline environment file with explicit TLS, host/origin allowlist and built web root.' }
    }
    foreach ($value in @($node, $application, $entry, $root, $sourceEnv)) {
        if ($value -match '["%\r\n]') { throw 'Paths containing quotes, percent signs or newlines are unsupported by this PoC.' }
    }
    if (-not $PSCmdlet.ShouldProcess($root, 'Create protected WinSW PoC service files (no service installation)')) { return }
    $null = New-PrivateDirectory $root
    $logs = New-Item -ItemType Directory -Path (Join-Path $root 'logs')
    Copy-Item -LiteralPath $verifiedWrapper -Destination $wrapper
    $serviceEnv = Join-Path $root 'service.env'
    Copy-Item -LiteralPath $sourceEnv -Destination $serviceEnv
    $localService = [Security.Principal.SecurityIdentifier]'S-1-5-19'
    $acl = Get-Acl -LiteralPath $root
    $readRule = New-Object Security.AccessControl.FileSystemAccessRule($localService, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($readRule)
    Set-Acl -LiteralPath $root -AclObject $acl
    $logAcl = Get-Acl -LiteralPath $logs.FullName
    $writeRule = New-Object Security.AccessControl.FileSystemAccessRule($localService, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $logAcl.AddAccessRule($writeRule)
    Set-Acl -LiteralPath $logs.FullName -AclObject $logAcl
    # Escape every value through XmlDocument; environment secrets are NOT embedded.
    $xml = New-Object Xml.XmlDocument
    $service = $xml.CreateElement('service')
    $null = $xml.AppendChild($service)
    $values = [ordered]@{
        id = 'GSTBillingApiPoC'; name = 'GST Billing API PoC'; description = 'Phase 1 feasibility test only'
        executable = $node; arguments = ('"' + $entry + '"'); workingdirectory = $application
        startmode = 'Manual'; stoptimeout = '30sec'; logpath = $logs.FullName
    }
    foreach ($key in $values.Keys) {
        $element = $xml.CreateElement($key)
        $element.InnerText = $values[$key]
        $null = $service.AppendChild($element)
    }
    $envElement = $xml.CreateElement('env')
    $envElement.SetAttribute('name', 'ENV_FILE')
    $envElement.SetAttribute('value', $serviceEnv)
    $null = $service.AppendChild($envElement)
    $account = $xml.CreateElement('serviceaccount')
    foreach ($entry in @{ domain = 'NT AUTHORITY'; user = 'LocalService' }.GetEnumerator()) {
        $element = $xml.CreateElement($entry.Key); $element.InnerText = $entry.Value; $null = $account.AppendChild($element)
    }
    $null = $service.AppendChild($account)
    $log = $xml.CreateElement('log')
    $log.SetAttribute('mode', 'roll-by-size')
    foreach ($setting in @{ sizeThreshold = '1024'; keepFiles = '5' }.GetEnumerator()) {
        $element = $xml.CreateElement($setting.Key)
        $element.InnerText = $setting.Value
        $null = $log.AppendChild($element)
    }
    $null = $service.AppendChild($log)
    $xml.Save((Join-Path $root 'GSTBillingApiPoC.xml'))
    @{ product = 'gst-billing-poc'; root = $root; sha256 = $WinSwSha256 } |
        ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding UTF8
    Write-Output 'Prepared only. Grant LocalService read access to application, TLS leaf files and required parent directories. Install/start are separate explicit operations.'
    return
}
if (-not (Test-Path -LiteralPath $markerPath)) { throw 'PoC service identity marker missing.' }
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
if ($marker.product -ne 'gst-billing-poc' -or $marker.root -ne $root) { throw 'Service identity mismatch.' }
$verified = Get-VerifiedExecutable $wrapper $marker.sha256
$preparedConfig = [xml](Get-Content -LiteralPath (Join-Path $root 'GSTBillingApiPoC.xml') -Raw)
if ($preparedConfig.service.id -ne 'GSTBillingApiPoC' -or (Get-DeploymentServiceAccount $preparedConfig) -ne 'NT AUTHORITY\LocalService') {
    throw 'PoC service configuration identity changed; review before installation or service control.'
}
if ($PSCmdlet.ShouldProcess('GSTBillingApiPoC only; uninstall preserves all files and customer data', $Action)) {
    Assert-Administrator
    if ($Action -eq 'Install' -and (Get-Service -Name 'GSTBillingApiPoC' -ErrorAction SilentlyContinue)) {
        throw 'Service already exists; refusing to modify it.'
    }
    if ($Action -ne 'Install') {
        $registered = Get-CimInstance Win32_Service -Filter "Name='GSTBillingApiPoC'"
        if (-not $registered -or $registered.PathName.Trim('"') -ne $verified) {
            throw 'Registered service executable does not match this protected PoC. No action taken.'
        }
        if ($Action -eq 'Start' -and $registered.StartName -ne 'NT AUTHORITY\LocalService') {
            throw 'Refusing to start a service whose identity is not LocalService.'
        }
    }
    Invoke-Checked $verified @($Action.ToLowerInvariant())
}
