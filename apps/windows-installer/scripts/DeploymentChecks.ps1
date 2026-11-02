# Read-only observations. No service/firewall/trust/configuration changes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DeploymentOrigin([string] $Origin, [int] $DatabasePort) {
    $uri = $null
    if (-not [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.GetLeftPart([UriPartial]::Authority) -ne $Origin -or $uri.Port -eq $DatabasePort) {
        throw 'Use an exact HTTPS origin without credentials, path, query or fragment and a separate database port.'
    }
    return $uri
}
function Get-DeploymentPath([string] $Path) {
    if ($Path -notmatch '^[a-zA-Z]:\\' -or $Path -match '["%\r\n]') { throw 'Use absolute local deployment paths.' }
    return [IO.Path]::GetFullPath($Path)
}
function Resolve-DeploymentAddresses([string] $Hostname) {
    return [Net.Dns]::GetHostAddresses($Hostname)
}
function Test-DeploymentPrivateAddress([Net.IPAddress] $Address) {
    if ($Address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $bytes = $Address.GetAddressBytes()
    return $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}
function Test-DeploymentTcp([Net.IPAddress] $Address, [int] $Port) {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $pending = $tcp.ConnectAsync($Address, $Port)
        if (-not $pending.Wait(2000)) { return $false }
        $pending.GetAwaiter().GetResult()
        return $tcp.Connected
    } catch { return $false }
    finally { $tcp.Dispose() }
}
function Invoke-DeploymentHttp([Uri] $Uri) {
    # Preserve platform hostname/chain validation. No proxy, redirects, credentials
    # or certificate-validation overrides. Bound response size and read time.
    if ($Uri.Scheme -ne 'https' -or $null -ne [Net.ServicePointManager]::ServerCertificateValidationCallback) {
        throw 'Remove certificate-validation overrides before deployment checks.'
    }
    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 5000
    $request.ReadWriteTimeout = 5000
    $response = $null
    $stream = $null
    $body = New-Object IO.MemoryStream
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $buffer = New-Object byte[] 4096
        while ($true) {
            if ($deadline.ElapsedMilliseconds -gt 10000) { throw 'Deployment response exceeded its time budget.' }
            $count = $stream.Read($buffer, 0, $buffer.Length)
            if ($count -eq 0) { break }
            if ($body.Length + $count -gt 65536) { throw 'Unexpectedly large deployment response.' }
            $body.Write($buffer, 0, $count)
        }
        return [PSCustomObject]@{ StatusCode = [int]$response.StatusCode; ContentType = $response.ContentType; Content = [Text.Encoding]::UTF8.GetString($body.ToArray()) }
    } catch {
        if ($_.Exception -is [Net.WebException] -and $null -ne $_.Exception.Response) { $_.Exception.Response.Close() }
        throw 'HTTPS deployment probe failed.'
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $response) { $response.Close() }
        $body.Dispose()
    }
}
function ConvertFrom-DeploymentXml([string] $Content) {
    if ($Content.Length -gt 65536) { throw 'Unexpectedly large service definition.' }
    $settings = New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $text = New-Object IO.StringReader($Content)
    $reader = [Xml.XmlReader]::Create($text, $settings)
    try {
        $document = New-Object Xml.XmlDocument
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose(); $text.Dispose() }
}
function Read-DeploymentServiceXml([string] $Path) {
    if ((Get-Item -LiteralPath $Path).Length -gt 65536) { throw 'Unexpectedly large service definition.' }
    return ConvertFrom-DeploymentXml (Get-Content -LiteralPath $Path -Raw)
}
function Add-DeploymentObservation($Checks, [string] $Name, [scriptblock] $Probe) {
    $passed = $false
    try { $passed = [bool](& $Probe) } catch { $passed = $false }
    $Checks.Add([PSCustomObject]@{ name = $Name; passed = $passed })
}
function Get-DeploymentObservations {
    param(
        [ValidateSet('Host', 'Client')][string] $Mode,
        [string] $Origin,
        [ValidateRange(1024, 65535)][int] $DatabasePort = 55432,
        [string] $ServiceRoot, [string] $NodePath, [string] $AppRoot,
        [string] $NodeSha256, [string] $WinSwSha256
    )
    $uri = Get-DeploymentOrigin $Origin $DatabasePort
    if ($Mode -eq 'Host') {
        $root = Get-DeploymentPath $ServiceRoot
        $node = Get-DeploymentPath $NodePath
        $application = Get-DeploymentPath $AppRoot
        if ($NodeSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $WinSwSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Independently verified executable hashes are required.' }
    }
    $checks = New-Object 'Collections.Generic.List[object]'
    $addresses = @()
    try { $addresses = @(Resolve-DeploymentAddresses $uri.DnsSafeHost) } catch { $addresses = @() }
    $privateTarget = $addresses.Count -gt 0 -and $addresses.Count -le 8
    foreach ($address in $addresses) {
        if (-not (Test-DeploymentPrivateAddress $address)) { $privateTarget = $false }
    }
    $checks.Add([PSCustomObject]@{ name = 'private_ipv4_lan_target'; passed = $privateTarget })
    $localAddresses = @()
    try { $localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.IPAddress }) } catch { $localAddresses = @() }
    $topology = $privateTarget -and $localAddresses.Count -gt 0
    foreach ($address in $addresses) {
        if ($Mode -eq 'Host' -and $address.ToString() -notin $localAddresses) { $topology = $false }
        if ($Mode -eq 'Client' -and $address.ToString() -in $localAddresses) { $topology = $false }
    }
    $topologyName = 'origin_resolves_to_this_host'
    if ($Mode -eq 'Client') { $topologyName = 'separate_lan_client' }
    $checks.Add([PSCustomObject]@{ name = $topologyName; passed = $topology })
    # Never contact public/unresolved targets or quietly turn localhost into LAN evidence.
    if ($privateTarget -and $topology) {
        Add-DeploymentObservation $checks 'https_api_liveness' {
            $response = Invoke-DeploymentHttp ([Uri]($Origin + '/api/v1/health'))
            $value = $response.Content | ConvertFrom-Json
            return $response.StatusCode -eq 200 -and $response.ContentType -match '^application/json(?:;|$)' -and
                $value.status -is [string] -and $value.service -is [string] -and $value.apiVersion -is [string] -and
                $value.status -ceq 'ok' -and $value.service -ceq 'gst-api' -and $value.apiVersion -ceq '1'
        }
        Add-DeploymentObservation $checks 'https_database_readiness' {
            $response = Invoke-DeploymentHttp ([Uri]($Origin + '/api/v1/health/ready'))
            $value = $response.Content | ConvertFrom-Json
            return $response.StatusCode -eq 200 -and $response.ContentType -match '^application/json(?:;|$)' -and
                $value.status -is [string] -and $value.database -is [string] -and
                $value.status -ceq 'ready' -and $value.database -ceq 'up'
        }
        Add-DeploymentObservation $checks 'https_frontend_document' {
            $response = Invoke-DeploymentHttp ([Uri]($Origin + '/'))
            return $response.StatusCode -eq 200 -and $response.ContentType -match '^text/html(?:;|$)' -and
                $response.Content -match '<script\b' -and $response.Content -match '/assets/[^\s"<>]+\.js'
        }
        if ($Mode -eq 'Client') {
            Add-DeploymentObservation $checks 'database_port_unreachable_from_client' {
                foreach ($address in $addresses) { if (Test-DeploymentTcp $address $DatabasePort) { return $false } }
                return $true
            }
        }
    }
    if ($Mode -eq 'Host') {
        $wrapper = Join-Path $root 'GSTBillingApiPoC.exe'
        Add-DeploymentObservation $checks 'approved_executable_hashes' {
            return (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -eq $NodeSha256 -and
                (Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash -eq $WinSwSha256
        }
        Add-DeploymentObservation $checks 'service_definition_identity' {
            $xml = Read-DeploymentServiceXml (Join-Path $root 'GSTBillingApiPoC.xml')
            $environments = @($xml.service.env)
            return $xml.service.id -eq 'GSTBillingApiPoC' -and $xml.service.executable -eq $node -and
                $xml.service.arguments -eq ('"' + (Join-Path $application 'apps/api/dist/main.js') + '"') -and
                $xml.service.workingdirectory -eq $application -and
                $xml.service.serviceaccount.username -eq 'NT AUTHORITY\LocalService' -and
                $environments.Count -eq 1 -and $environments[0].name -eq 'ENV_FILE' -and
                $environments[0].value -eq (Join-Path $root 'service.env')
        }
        $registered = $null
        try { $registered = Get-CimInstance Win32_Service -Filter "Name='GSTBillingApiPoC'" } catch { $registered = $null }
        Add-DeploymentObservation $checks 'running_service_identity' {
            return $null -ne $registered -and $registered.State -eq 'Running' -and
                $registered.StartName -eq 'NT AUTHORITY\LocalService' -and
                $registered.PathName.Trim('"') -eq $wrapper -and $registered.ProcessId -gt 0
        }
        Add-DeploymentObservation $checks 'api_listener_owned_by_service_node' {
            if ($null -eq $registered -or $registered.ProcessId -le 0) { return $false }
            $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($registered.ProcessId)")
            $nodeIds = @($children | Where-Object { $_.ExecutablePath -eq $node } | ForEach-Object { $_.ProcessId })
            $listeners = @(Get-NetTCPConnection -LocalPort $uri.Port -State Listen -ErrorAction Stop)
            return $listeners.Count -gt 0 -and @($listeners | Where-Object { $_.OwningProcess -notin $nodeIds }).Count -eq 0
        }
        Add-DeploymentObservation $checks 'database_listener_loopback_only' {
            $listeners = @(Get-NetTCPConnection -LocalPort $DatabasePort -State Listen -ErrorAction Stop)
            return $listeners.Count -gt 0 -and @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -eq 0
        }
    }
    return [PSCustomObject]@{
        schemaVersion = 1; mode = $Mode; origin = $Origin; observedAtUtc = [DateTime]::UtcNow.ToString('o')
        passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0; checks = @($checks.ToArray())
    }
}
