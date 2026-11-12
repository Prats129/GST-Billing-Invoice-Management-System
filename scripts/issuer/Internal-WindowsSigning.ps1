# Publisher/test-operator tooling only. Never included in a customer bundle.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidateSet('Create','Sign','Verify','Trust','RemoveTrust')][string] $Action,
    [string] $CertificateDirectory,
    [string] $OutputDirectory,
    [ValidatePattern('^[a-fA-F0-9]{40}$')][string] $Thumbprint,
    [string] $CertificateFile,
    [switch] $TestMachine,
    [ValidatePattern('^[a-fA-F0-9]{64}$')][string] $ExpectedSha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$required = @{
    Create = @('CertificateDirectory'); Sign = @('OutputDirectory','Thumbprint','ExpectedSha256')
    Verify = @('OutputDirectory','ExpectedSha256'); Trust = @('CertificateFile','ExpectedSha256','TestMachine')
    RemoveTrust = @('CertificateFile','ExpectedSha256','TestMachine')
}[$Action]
foreach ($name in $required) {
    if (-not $PSBoundParameters.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$PSBoundParameters[$name])) { throw ('Missing required parameter: ' + $name) }
}
foreach ($name in @('CertificateDirectory','OutputDirectory','Thumbprint','CertificateFile','TestMachine','ExpectedSha256')) {
    if ($PSBoundParameters.ContainsKey($name) -and $name -notin $required) { throw ('Unexpected parameter for this action: ' + $name) }
}
. "$PSScriptRoot/../../apps/windows-installer/scripts/Common.ps1"
. "$PSScriptRoot/../../apps/windows-installer/scripts/DeploymentChecks.ps1"
. "$PSScriptRoot/../../apps/windows-installer/scripts/OfflineInstaller.ps1"

function Get-InternalCertificateHash($Certificate) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Certificate.RawData))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Assert-InternalCertificate($Certificate, [string] $Expected, [bool] $CheckDates = $true) {
    if ((Get-InternalCertificateHash $Certificate) -cne $Expected.ToLowerInvariant() -or
        $Certificate.Subject -cne 'CN=GST Billing INTERNAL TEST ONLY' -or $Certificate.Issuer -cne $Certificate.Subject) { throw 'Wrong internal test certificate or fingerprint.' }
    $eku = @($Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
    if ($eku.Count -ne 1 -or $eku[0].EnhancedKeyUsages.Count -ne 1 -or $eku[0].EnhancedKeyUsages[0].Value -cne '1.3.6.1.5.5.7.3.3') { throw 'Exclusive code-signing usage is required.' }
    foreach ($extension in $Certificate.Extensions) {
        if ($extension.Oid.Value -eq '2.5.29.19' -and $extension.CertificateAuthority) { throw 'Use an end-entity code-signing certificate, not a certificate authority.' }
    }
    if ($CheckDates -and ($Certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $Certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow)) { throw 'Internal test certificate is not currently valid. Rebuild with a new certificate.' }
}
function Read-InternalJson([string] $Path) {
    Assert-OfflinePath $Path $true
    if ((Get-Item -LiteralPath $Path).Length -gt 16777216) { throw 'Oversized signing input.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
function Read-EmbeddedInventory([string] $Exe) {
    # A short-lived, clean process avoids reflection assembly caching across
    # reviews/signing and releases file handles before Authenticode writes.
    $source = @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$assembly = [Reflection.Assembly]::ReflectionOnlyLoad([IO.File]::ReadAllBytes($env:GST_INTERNAL_LAUNCHER))
$stream = $assembly.GetManifestResourceStream('bootstrap.json')
if ($null -eq $stream -or $stream.Length -gt 16777216) { throw 'Missing inventory.' }
$reader = New-Object IO.StreamReader($stream)
try { [Console]::Out.Write($reader.ReadToEnd()) } finally { $reader.Dispose() }
'@
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $system 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $start.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.EnvironmentVariables.Clear(); $start.EnvironmentVariables['SystemRoot'] = $system
    $start.EnvironmentVariables['GST_INTERNAL_LAUNCHER'] = $Exe
    $process = New-Object Diagnostics.Process; $process.StartInfo = $start
    try {
        $null = $process.Start()
        $output = $process.StandardOutput.ReadToEndAsync(); $errorOutput = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0 -or $errorOutput.Result.Length -ne 0 -or $output.Result.Length -gt 16777216) { throw 'Cannot inspect the native launcher inventory.' }
        return $output.Result | ConvertFrom-Json
    } finally { $process.Dispose() }
}
function Get-InternalLauncher([string] $Directory, [string] $Expected) {
    $directory = Get-DeploymentPath $Directory
    if ($directory -cne $Directory) { throw 'Canonical publisher output path required.' }
    Assert-OfflinePath $directory $true
    $runtime = Join-Path $directory 'maintenance'
    $exe = Join-Path $runtime 'GSTBillingMaintenance.exe'
    Assert-OfflinePath $runtime $true; Assert-OfflinePath $exe $true
    if ((Get-Item -LiteralPath $exe).Length -gt 67108864) { throw 'Oversized launcher.' }
    # Reflection-only reading cannot run the launcher's code or static initializers.
    $inventory = Read-EmbeddedInventory $exe
    if ($inventory.signingPurpose -cne 'internal-test' -or $inventory.publisherCertificateSha256 -cne $Expected.ToLowerInvariant() -or @($inventory.files).Count -eq 0) { throw 'The embedded internal-test label or certificate pin does not match. Rebuild using the internal public certificate.' }
    $names = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $inventory.files) {
        if ([string]::IsNullOrWhiteSpace($file.path) -or $file.path.Contains(':') -or $file.path.Contains('\') -or $file.path.Contains([char]0) -or $file.path -match '(^/|//|(^|/)\.\.?(/|$)|/$)' -or -not $names.Add($file.path)) { throw 'Unsafe runtime inventory path.' }
        $target = Get-OfflineChild $runtime $file.path
        Assert-OfflinePath $target $true
        if ((Get-Item -LiteralPath $target).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw 'Runtime inventory mismatch.' }
    }
    # Check reparse points before recursion; never follow an untrusted subtree.
    $pending = New-Object 'Collections.Generic.Stack[string]'; $pending.Push($runtime)
    $count = 0
    while ($pending.Count -gt 0) {
        $folder = $pending.Pop(); Assert-OfflinePath $folder $true
        foreach ($item in Get-ChildItem -LiteralPath $folder -Force) {
            $count++; if ($count -gt 50000 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe runtime tree.' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            elseif ($item.FullName -cne $exe -and -not $names.Contains($item.FullName.Substring($runtime.Length + 1).Replace('\','/'))) { throw 'Unexpected runtime file.' }
        }
    }
    return $exe
}

if ($Action -eq 'Create') {
    $directory = Get-DeploymentPath $CertificateDirectory
    if ($directory -cne $CertificateDirectory -or (Test-Path -LiteralPath $directory)) { throw 'Choose a new canonical certificate-output directory.' }
    Assert-OfflinePath ([IO.Path]::GetDirectoryName($directory)) $true
    if (-not $PSCmdlet.ShouldProcess('CurrentUser My certificate store and new public output directory', 'Create a NON-EXPORTABLE internal test code-signing key (not production)')) { return }
    $null = New-PrivateDirectory $directory
    $certificate = $null
    try {
        $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=GST Billing INTERNAL TEST ONLY' -FriendlyName 'GST Billing INTERNAL TEST ONLY - not production' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter ([DateTime]::Now.AddMonths(6))
        $public = Join-Path $directory 'internal-code-signing.cer'
        [IO.File]::WriteAllBytes($public, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        $record = @{ purpose = 'INTERNAL TEST ONLY'; thumbprint = $certificate.Thumbprint; certificateSha256 = Get-InternalCertificateHash $certificate; publicCertificate = $public; privateKey = 'Non-exportable Windows CurrentUser My store; no PFX created'; expiresUtc = $certificate.NotAfter.ToUniversalTime().ToString('o') }
        $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'internal-signing.json') -Encoding UTF8
        $record | ConvertTo-Json
    } catch {
        if ($null -ne $certificate) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $certificate.Thumbprint) -DeleteKey -Force }
        throw 'Internal certificate preparation failed. Retain partial output for inspection; no trust was installed.'
    } finally { if ($null -ne $certificate) { $certificate.Dispose() } }
    return
}

if ($Action -in @('Trust','RemoveTrust')) {
    if (-not $TestMachine) { throw 'Explicit test-machine acknowledgement required.' }
    $item = Get-Item -LiteralPath $CertificateFile
    if ($item.Length -gt 65536 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Use an ordinary public certificate file.' }
    $bytes = [IO.File]::ReadAllBytes($item.FullName)
    if ([Security.Cryptography.X509Certificates.X509Certificate2]::GetCertContentType($bytes) -ne [Security.Cryptography.X509Certificates.X509ContentType]::Cert) { throw 'A public DER certificate is required, not a private-key container.' }
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2(,$bytes)
    try {
        Assert-InternalCertificate $certificate $ExpectedSha256 ($Action -eq 'Trust')
        if (-not $PSCmdlet.ShouldProcess(('CurrentUser Root, exact internal certificate ' + $ExpectedSha256), ($Action + ': internal test account only; changes code-signing trust'))) { return }
        $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            if ($Action -eq 'Trust') { $store.Add($certificate) } else { $store.Remove($certificate) }
            $present = $store.Certificates.Contains($certificate)
            if (($Action -eq 'Trust' -and -not $present) -or ($Action -eq 'RemoveTrust' -and $present)) { throw 'Certificate trust change was not confirmed. Inspect this exact test-account certificate before retrying.' }
        } finally { $store.Dispose() }
        Write-Output ($Action + ' completed for this Windows user only. Other accounts and LocalMachine trust were not changed.')
    } finally { $certificate.Dispose() }
    return
}

$exe = Get-InternalLauncher $OutputDirectory $ExpectedSha256
if ($Action -eq 'Verify') {
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw 'Windows did not verify this launcher. Check exact test-certificate trust, expiry and file integrity. Do not bypass verification.' }
    Assert-InternalCertificate $signature.SignerCertificate $ExpectedSha256
    Write-Output 'PASS: Windows Authenticode, internal publisher pin and runtime inventory verified for this account. Not production approval or real installation acceptance.'
    return
}

$certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $Thumbprint)
try {
    Assert-InternalCertificate $certificate $ExpectedSha256
    if (-not $certificate.HasPrivateKey) { throw 'The internal private key is not available to this Windows user.' }
    $key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
    try {
        if ($key -isnot [Security.Cryptography.RSACng] -or $key.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) { throw 'A non-exportable Windows CNG internal signing key is required.' }
    } finally { if ($null -ne $key) { $key.Dispose() } }
    $report = Read-InternalJson (Join-Path $OutputDirectory 'build-report.json')
    if ($report.status -cne 'unsigned-candidate' -or $report.publisherCertificateSha256 -cne $ExpectedSha256.ToLowerInvariant() -or
        (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $report.executableSha256 -or
        (Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'NotSigned') { throw 'Use the original unsigned candidate built with this certificate. Existing signatures or changed candidates are refused.' }
    $receipt = Join-Path $OutputDirectory 'internal-signing.jsonl'
    if (Test-Path -LiteralPath $receipt) { throw 'A signing attempt already exists. Inspect retained evidence; do not sign again automatically.' }
    if (-not $PSCmdlet.ShouldProcess($exe, 'Authenticode-sign with the non-exportable INTERNAL TEST key; no timestamp or trust installation')) { return }
    $journal = New-Object IO.FileStream($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $line = @{ state = 'started'; unsignedSha256 = $report.executableSha256; publisherSha256 = $ExpectedSha256.ToLowerInvariant(); atUtc = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
        $data = [Text.Encoding]::UTF8.GetBytes($line + "`n"); $journal.Write($data,0,$data.Length); $journal.Flush($true)
        $signature = Set-AuthenticodeSignature -LiteralPath $exe -Certificate $certificate -HashAlgorithm SHA256 -IncludeChain Signer
        if ($null -eq $signature.SignerCertificate -or $signature.Status -in @('HashMismatch','NotSigned','NotSupported','Incompatible')) { throw 'Signature creation was not confirmed. Retain the candidate and signing evidence.' }
        Assert-InternalCertificate $signature.SignerCertificate $ExpectedSha256
        $line = @{ state = 'signature-created-verification-required'; signedSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant(); windowsStatus = [string]$signature.Status; atUtc = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
        $data = [Text.Encoding]::UTF8.GetBytes($line + "`n"); $journal.Write($data,0,$data.Length); $journal.Flush($true)
    } finally { $journal.Dispose() }
    Write-Output 'Internal signature created. Windows trust is NOT installed. Run Verify on the explicitly trusted test account before any host action. Production signing and real Windows acceptance remain open.'
} finally { $certificate.Dispose() }
