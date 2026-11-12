[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string] $CertificatePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string] $ExpectedSha256,
    [switch] $ApprovalConfirmed
)
. "$PSScriptRoot/Common.ps1"
$certificateFile = (Resolve-Path -LiteralPath $CertificatePath).Path
$item = Get-Item -LiteralPath $certificateFile -Force
if ($item.Length -gt 262144 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Use a bounded ordinary public CA file.' }
$stream = New-Object IO.FileStream($certificateFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    if ($stream.Length -gt 262144) { throw 'CA file is too large.' }
    $bytes = New-Object byte[] ([int]$stream.Length)
    $used = 0
    while ($used -lt $bytes.Length) {
        $count = $stream.Read($bytes, $used, $bytes.Length - $used)
        if ($count -eq 0) { throw 'CA file was truncated.' }
        $used += $count
    }
} finally { $stream.Dispose() }
$sha = [Security.Cryptography.SHA256]::Create()
try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
if ($actual -ne $ExpectedSha256) { throw 'CA fingerprint mismatch. Obtain it independently from the host administrator.' }
if ([Security.Cryptography.X509Certificates.X509Certificate2]::GetCertContentType($bytes) -ne [Security.Cryptography.X509Certificates.X509ContentType]::Cert) {
    throw 'Use a single public certificate, not a private-key container or certificate bundle.'
}
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2(,$bytes)
$basicConstraints = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
if (-not $basicConstraints -or -not $basicConstraints.CertificateAuthority -or $certificate.HasPrivateKey) {
    throw 'Expected a public CA certificate without its private key.'
}
if ($certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'Certificate is outside its validity period.' }
if ($ApprovalConfirmed) { $ConfirmPreference = 'None' }
if ($PSCmdlet.ShouldProcess("LocalMachine Root: $($certificate.Subject), expires $($certificate.NotAfter), SHA256 $ExpectedSha256", 'Trust this private certificate authority for all users')) {
    Assert-Administrator
    # Import the exact checked bytes, never reopen a replaceable input file.
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Add($certificate)
        if ($store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false).Count -eq 0) { throw 'CA installation was not verified.' }
    } finally { $store.Close(); $certificate.Dispose() }
    Write-Output 'The verified public CA is trusted on this computer.'
}
