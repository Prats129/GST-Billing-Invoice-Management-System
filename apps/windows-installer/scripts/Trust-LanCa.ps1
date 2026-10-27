[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string] $CertificatePath,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string] $ExpectedSha256
)
. "$PSScriptRoot/Common.ps1"
$certificateFile = (Resolve-Path -LiteralPath $CertificatePath).Path
if ((Get-FileHash -LiteralPath $certificateFile -Algorithm SHA256).Hash -ne $ExpectedSha256) {
    throw 'CA fingerprint mismatch. Obtain the fingerprint independently from the host administrator.'
}
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($certificateFile)
$basicConstraints = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
if (-not $basicConstraints -or -not $basicConstraints.CertificateAuthority -or $certificate.HasPrivateKey) {
    throw 'Expected a public CA certificate without its private key.'
}
if ($certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'Certificate is outside its validity period.' }
if ($PSCmdlet.ShouldProcess("LocalMachine Root: $($certificate.Subject), expires $($certificate.NotAfter), SHA256 $ExpectedSha256", 'Trust this private certificate authority for all users')) {
    Assert-Administrator
    Import-Certificate -FilePath $certificateFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
}
