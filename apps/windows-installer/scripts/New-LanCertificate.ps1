# Offline private CA prototype. Does NOT install trust or modify firewall rules.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $OpenSslPath,
    [Parameter(Mandatory)][string] $OpenSslSha256,
    [Parameter(Mandatory)][ValidatePattern('^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$')][string] $DnsName,
    [Parameter(Mandatory)][string] $CaDirectory,
    [Parameter(Mandatory)][string] $ServerDirectory
)
. "$PSScriptRoot/Common.ps1"
$openssl = Get-VerifiedExecutable $OpenSslPath $OpenSslSha256
$caPath = New-PrivateDirectory $CaDirectory
$serverPath = New-PrivateDirectory $ServerDirectory
$caKey = Join-Path $caPath 'ca.key.pem'
$caCert = Join-Path $caPath 'ca.cert.pem'
$serverKey = Join-Path $serverPath 'server.key.pem'
$request = Join-Path $serverPath 'server.csr.pem'
$serverCert = Join-Path $serverPath 'server.cert.pem'
$extensions = Join-Path $serverPath 'server.ext'
@"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$DnsName
"@ | Set-Content -LiteralPath $extensions -Encoding ASCII
Write-Output 'OpenSSL will prompt for a strong CA key passphrase. Keep it offline; do not put it in a command argument.'
Invoke-Checked $openssl @('genrsa', '-aes256', '-out', $caKey, '4096')
Invoke-Checked $openssl @('req', '-x509', '-new', '-sha256', '-days', '730', '-key', $caKey, '-out', $caCert, '-subj', '/CN=GST Billing PoC Private CA', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
Invoke-Checked $openssl @('genrsa', '-out', $serverKey, '3072')
Invoke-Checked $openssl @('req', '-new', '-sha256', '-key', $serverKey, '-out', $request, '-subj', "/CN=$DnsName")
Invoke-Checked $openssl @('x509', '-req', '-sha256', '-days', '90', '-in', $request, '-CA', $caCert, '-CAkey', $caKey, '-CAcreateserial', '-extfile', $extensions, '-out', $serverCert)
Invoke-Checked $openssl @('verify', '-CAfile', $caCert, '-verify_hostname', $DnsName, $serverCert)
$publicCa = Join-Path $serverPath 'ca.cer'
Invoke-Checked $openssl @('x509', '-in', $caCert, '-outform', 'DER', '-out', $publicCa)
Write-Output 'Share ONLY ca.cer, its SHA-256 via an independent channel, and the HTTPS hostname with clients.'
Get-FileHash -LiteralPath $publicCa -Algorithm SHA256
Write-Output 'CA key remains in separate operator-only directory. Leaf key remains protected; grant only the API identity read access.'
