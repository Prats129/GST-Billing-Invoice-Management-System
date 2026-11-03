# Pure decision/contract tests. System and network probes below are mocked.
# Never installs a service, contacts a LAN target or imports a certificate.
[CmdletBinding()]
param()
. "$PSScriptRoot/DeploymentChecks.ps1"
foreach ($accountXml in @(
    '<service><serviceaccount><domain>NT SERVICE</domain><user>GSTBillingApi</user><password>unexpected</password></serviceaccount></service>',
    '<service><serviceaccount><domain>NT SERVICE</domain><user>GSTBillingApi</user><username>other</username></serviceaccount></service>',
    '<service><serviceaccount><domain>Other</domain><user>GSTBillingApi</user></serviceaccount></service>'
)) {
    $rejected=$false;try {$null=Get-DeploymentServiceAccount (ConvertFrom-DeploymentXml $accountXml)}catch{$rejected=$true}
    if(-not $rejected){throw 'Ambiguous service account accepted.'}
}
$parameters = @{
    Mode = 'Host'; Origin = 'https://gst-host:3443'; DatabasePort = 55432
    ServiceRoot = 'C:\GST\service'; NodePath = 'C:\GST\node.exe'; AppRoot = 'C:\GST\application'
    NodeSha256 = ('a' * 64); WinSwSha256 = ('b' * 64)
}
$validXml = @'
<service>
  <id>GSTBillingApiPoC</id><executable>C:\GST\node.exe</executable>
  <arguments>"C:\GST\application\apps\api\dist\main.js"</arguments>
  <workingdirectory>C:\GST\application</workingdirectory>
  <env name="ENV_FILE" value="C:\GST\service\service.env"/>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
</service>
'@
function Reset-Fixture {
    $script:fixture = @{
        addresses = @([Net.IPAddress]::Parse('192.168.10.10')); local = @('192.168.10.10')
        account = 'NT AUTHORITY\LocalService'; state = 'Running'; wrapper = '"C:\GST\service\GSTBillingApiPoC.exe"'
        nodePid = 101; listenerPid = 101; databaseAddress = '127.0.0.1'; missingDatabase = $false
        wrongHash = $false; xml = $validXml; databaseReachable = $false
        liveStatus = 200; liveBody = '{"status":"ok","service":"gst-api","apiVersion":"1"}'
        readyStatus = 200; readyBody = '{"status":"ready","database":"up"}'
        frontendType = 'text/html'; throwNetwork = $false; calls = 0; tcpCalls = 0
    }
}
function Resolve-DeploymentAddresses { param($Hostname) return $script:fixture.addresses }
function Get-NetIPAddress {
    param($AddressFamily, $ErrorAction)
    foreach ($address in $script:fixture.local) { [PSCustomObject]@{ IPAddress = $address } }
}
function Test-DeploymentTcp {
    param($Address, $Port)
    $script:fixture.tcpCalls++
    return $script:fixture.databaseReachable
}
function Invoke-DeploymentHttp {
    param($Uri)
    $script:fixture.calls++
    if ($script:fixture.throwNetwork) { throw 'SECRET_DRIVER_ERROR_NOT_FOR_REPORT' }
    if ($Uri.AbsolutePath -eq '/api/v1/health') {
        return [PSCustomObject]@{ StatusCode = $script:fixture.liveStatus; ContentType = 'application/json; charset=utf-8'; Content = $script:fixture.liveBody }
    }
    if ($Uri.AbsolutePath -eq '/api/v1/health/ready') {
        return [PSCustomObject]@{ StatusCode = $script:fixture.readyStatus; ContentType = 'application/json'; Content = $script:fixture.readyBody }
    }
    return [PSCustomObject]@{ StatusCode = 200; ContentType = $script:fixture.frontendType; Content = '<html><script type="module" src="/assets/index-fixture.js"></script></html>' }
}
function Get-FileHash {
    param($LiteralPath, $Algorithm)
    $hash = $parameters.NodeSha256
    if ($LiteralPath.EndsWith('GSTBillingApiPoC.exe')) { $hash = $parameters.WinSwSha256 }
    if ($script:fixture.wrongHash) { $hash = 'c' * 64 }
    return [PSCustomObject]@{ Hash = $hash }
}
function Read-DeploymentServiceXml { param($Path) return ConvertFrom-DeploymentXml $script:fixture.xml }
function Get-CimInstance {
    param($ClassName, $Filter)
    if ($ClassName -eq 'Win32_Service') {
        return [PSCustomObject]@{ State = $script:fixture.state; StartName = $script:fixture.account; PathName = $script:fixture.wrapper; ProcessId = 100 }
    }
    return [PSCustomObject]@{ ExecutablePath = $parameters.NodePath; ProcessId = $script:fixture.nodePid }
}
function Get-NetTCPConnection {
    param($LocalPort, $State, $ErrorAction)
    if ($LocalPort -eq 55432) {
        if ($script:fixture.missingDatabase) { return @() }
        return [PSCustomObject]@{ LocalAddress = $script:fixture.databaseAddress; OwningProcess = 200 }
    }
    return [PSCustomObject]@{ LocalAddress = '0.0.0.0'; OwningProcess = $script:fixture.listenerPid }
}
function Assert-Failed($Report, [string] $Name) {
    if ($Report.passed -or @($Report.checks | Where-Object { $_.name -eq $Name -and -not $_.passed }).Count -ne 1) {
        throw "Unsafe deployment accepted: $Name"
    }
}
Reset-Fixture
$normal = Get-DeploymentObservations @parameters
if (-not $normal.passed -or $normal.checks.Count -ne 10) { throw 'Expected healthy host observations.' }
foreach ($case in @(
    @{ field = 'account'; value = 'LocalSystem'; check = 'running_service_identity' },
    @{ field = 'state'; value = 'Stopped'; check = 'running_service_identity' },
    @{ field = 'wrapper'; value = 'C:\other\wrapper.exe'; check = 'running_service_identity' },
    @{ field = 'listenerPid'; value = 999; check = 'api_listener_owned_by_service_node' },
    @{ field = 'databaseAddress'; value = '0.0.0.0'; check = 'database_listener_loopback_only' },
    @{ field = 'databaseAddress'; value = '::'; check = 'database_listener_loopback_only' },
    @{ field = 'missingDatabase'; value = $true; check = 'database_listener_loopback_only' },
    @{ field = 'wrongHash'; value = $true; check = 'approved_executable_hashes' },
    @{ field = 'liveStatus'; value = 302; check = 'https_api_liveness' },
    @{ field = 'liveBody'; value = '{"status":"ok","service":"wrong","apiVersion":"1"}'; check = 'https_api_liveness' },
    @{ field = 'liveBody'; value = '{"status":true,"service":true,"apiVersion":true}'; check = 'https_api_liveness' },
    @{ field = 'liveBody'; value = '{"status":"ok","service":"gst-api","apiVersion":1}'; check = 'https_api_liveness' },
    @{ field = 'readyStatus'; value = 503; check = 'https_database_readiness' },
    @{ field = 'readyBody'; value = '{"status":"ready","database":"down"}'; check = 'https_database_readiness' },
    @{ field = 'readyBody'; value = '{"status":true,"database":true}'; check = 'https_database_readiness' },
    @{ field = 'frontendType'; value = 'application/json'; check = 'https_frontend_document' }
)) {
    Reset-Fixture
    $script:fixture[$case.field] = $case.value
    Assert-Failed (Get-DeploymentObservations @parameters) $case.check
}
foreach ($xml in @(
    $validXml.Replace('<user>LocalService</user>', '<user>LocalSystem</user>'),
    $validXml.Replace('service.env', 'other.env'),
    $validXml.Replace('GSTBillingApiPoC', 'AnotherService'),
    '<!DOCTYPE service [<!ENTITY external SYSTEM "file:///C:/private.txt">]><service>&external;</service>'
)) {
    Reset-Fixture
    $script:fixture.xml = $xml
    Assert-Failed (Get-DeploymentObservations @parameters) 'service_definition_identity'
}
foreach ($address in @('127.0.0.1', '8.8.8.8', '::1', '::ffff:192.168.10.10')) {
    Reset-Fixture
    $script:fixture.addresses = @([Net.IPAddress]::Parse($address))
    Assert-Failed (Get-DeploymentObservations @parameters) 'private_ipv4_lan_target'
    if ($script:fixture.calls -ne 0 -or $script:fixture.tcpCalls -ne 0) { throw 'Invalid target was contacted.' }
}
Reset-Fixture
$script:fixture.addresses = @()
Assert-Failed (Get-DeploymentObservations @parameters) 'private_ipv4_lan_target'
if ($script:fixture.calls -ne 0) { throw 'Unresolved target was contacted.' }
Reset-Fixture
$script:fixture.addresses = @([Net.IPAddress]::Parse('192.168.10.10'), [Net.IPAddress]::Parse('8.8.8.8'))
Assert-Failed (Get-DeploymentObservations @parameters) 'private_ipv4_lan_target'
if ($script:fixture.calls -ne 0) { throw 'Mixed public/private target was contacted.' }
Reset-Fixture
$script:fixture.throwNetwork = $true
$failed = Get-DeploymentObservations @parameters
Assert-Failed $failed 'https_api_liveness'
if (($failed | ConvertTo-Json -Depth 5) -match 'SECRET_DRIVER') { throw 'Raw diagnostic leaked into output.' }
Reset-Fixture
$script:fixture.local = @('192.168.10.20')
Assert-Failed (Get-DeploymentObservations @parameters) 'origin_resolves_to_this_host'
if ($script:fixture.calls -ne 0) { throw 'Host probe contacted a different machine.' }
$clientParameters = @{ Mode = 'Client'; Origin = $parameters.Origin; DatabasePort = 55432 }
Reset-Fixture
Assert-Failed (Get-DeploymentObservations @clientParameters) 'separate_lan_client'
if ($script:fixture.calls -ne 0 -or $script:fixture.tcpCalls -ne 0) { throw 'Same-machine check accepted as LAN client evidence.' }
Reset-Fixture
$script:fixture.local = @('192.168.10.20')
$clientReport = Get-DeploymentObservations @clientParameters
if (-not $clientReport.passed -or $clientReport.checks.Count -ne 6 -or $script:fixture.tcpCalls -ne 1) { throw 'Expected healthy separate-client observations.' }
$script:fixture.databaseReachable = $true
Assert-Failed (Get-DeploymentObservations @clientParameters) 'database_port_unreachable_from_client'
foreach ($origin in @('http://gst-host:3443', 'https://user:secret@gst-host:3443', 'https://gst-host:3443/', 'https://gst-host:3443/?secret=value', 'https://gst-host:3443/#x', 'https://gst-host:55432')) {
    $rejected = $false
    try { $null = Get-DeploymentOrigin $origin 55432 } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe origin accepted.' }
}
foreach ($path in @('relative\node.exe', '\\server\share\node.exe', 'C:\bad"path\node.exe')) {
    $rejected = $false
    try { $null = Get-DeploymentPath $path } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe host path accepted.' }
}
Write-Output 'PASS: deployment observation contracts, host/client topology, service/listener identity, unsafe-input and failure checks. All machine/network probes were mocked; native service/TLS/LAN/reboot acceptance remains unverified.'
