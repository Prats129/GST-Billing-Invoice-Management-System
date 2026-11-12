# Real ephemeral Authenticode creation, WITHOUT trusting a certificate or executing
# the signed launcher. The exact test private key is removed in finally.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. "$repo/apps/windows-installer/scripts/Common.ps1"
$parent = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$fixture = New-PrivateDirectory (Join-Path $parent ('internal-signing-test-' + [Guid]::NewGuid().ToString('N')))
$tool = Join-Path $PSScriptRoot 'Internal-WindowsSigning.ps1'
$certificate = $null
$rootsBefore = @(Get-ChildItem Cert:\CurrentUser\Root | ForEach-Object { $_.Thumbprint } | Sort-Object) -join ','
function Reject([scriptblock] $Operation) {
    $failed = $false; try { & $Operation | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw 'Unsafe internal-signing action was accepted.' }
}
try {
    & $tool -Action Create -CertificateDirectory (Join-Path $fixture 'certificate') -Confirm:$false | Out-Null
    $record = Get-Content -LiteralPath (Join-Path $fixture 'certificate/internal-signing.json') -Raw | ConvertFrom-Json
    $certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $record.thumbprint)
    $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
    try { if ($rsa.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) { throw 'Test private key is exportable.' } }
    finally { $rsa.Dispose() }
    Reject { & $tool -Action Create -CertificateDirectory (Join-Path $fixture 'certificate') -Confirm:$false }
    Reject { & $tool -Action Trust -CertificateFile $record.publicCertificate -ExpectedSha256 ('0' * 64) -TestMachine -WhatIf }
    & $tool -Action Trust -CertificateFile $record.publicCertificate -ExpectedSha256 $record.certificateSha256 -TestMachine -WhatIf
    & $tool -Action RemoveTrust -CertificateFile $record.publicCertificate -ExpectedSha256 $record.certificateSha256 -TestMachine -WhatIf

    $output = New-PrivateDirectory (Join-Path $fixture 'candidate')
    $runtime = New-PrivateDirectory (Join-Path $output 'maintenance')
    [IO.File]::WriteAllText((Join-Path $runtime 'node.exe'), 'inert runtime - never executed')
    $inventory = @{ format = 1; signingPurpose = 'internal-test'; publisherCertificateSha256 = $record.certificateSha256; files = @(@{ path = 'node.exe'; bytes = (Get-Item (Join-Path $runtime 'node.exe')).Length; sha256 = (Get-FileHash (Join-Path $runtime 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() }) }
    $inventoryFile = Join-Path $output 'bootstrap.json'
    $inventory | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $inventoryFile -Encoding UTF8
    $exe = Join-Path $runtime 'GSTBillingMaintenance.exe'
    & "$repo/apps/windows-installer/launcher/Build-WindowsLauncher.ps1" -OutputPath $exe -InventoryPath $inventoryFile | Out-Null
    @{ status = 'unsigned-candidate'; publisherCertificateSha256 = $record.certificateSha256; executableSha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build-report.json') -Encoding UTF8
    Reject { & $tool -Action Sign -OutputDirectory $output -Thumbprint $record.thumbprint -ExpectedSha256 ('0' * 64) -Confirm:$false }
    [IO.File]::WriteAllText((Join-Path $runtime 'unexpected.txt'), 'unlisted fixture')
    Reject { & $tool -Action Sign -OutputDirectory $output -Thumbprint $record.thumbprint -ExpectedSha256 $record.certificateSha256 -Confirm:$false }
    Remove-Item -LiteralPath (Join-Path $runtime 'unexpected.txt')
    & $tool -Action Sign -OutputDirectory $output -Thumbprint $record.thumbprint -ExpectedSha256 $record.certificateSha256 -WhatIf
    if ((Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'NotSigned') { throw 'WhatIf signed the candidate.' }
    & $tool -Action Sign -OutputDirectory $output -Thumbprint $record.thumbprint -ExpectedSha256 $record.certificateSha256 -Confirm:$false
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -cne $record.thumbprint -or $signature.Status -eq 'Valid') { throw 'Expected exact signer with untrusted status on this account.' }
    $events = @(Get-Content -LiteralPath (Join-Path $output 'internal-signing.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
    if ($events.Count -ne 2 -or $events[1].state -cne 'signature-created-verification-required') { throw 'Signing receipt missing.' }
    Reject { & $tool -Action Verify -OutputDirectory $output -ExpectedSha256 $record.certificateSha256 }
    # Positive policy decision only; this does NOT establish real Windows trust.
    $mockCertificate = $certificate
    Set-Item Function:\Get-AuthenticodeSignature -Value ({ param($LiteralPath) return [PSCustomObject]@{ Status = 'Valid'; SignerCertificate = $mockCertificate } }.GetNewClosure())
    try { & $tool -Action Verify -OutputDirectory $output -ExpectedSha256 $record.certificateSha256 | Out-Null }
    finally { Remove-Item Function:\Get-AuthenticodeSignature }
    Reject { & $tool -Action Sign -OutputDirectory $output -Thumbprint $record.thumbprint -ExpectedSha256 $record.certificateSha256 -Confirm:$false }
    [IO.File]::AppendAllText((Join-Path $runtime 'node.exe'), 'tampered')
    Reject { & $tool -Action Verify -OutputDirectory $output -ExpectedSha256 $record.certificateSha256 }
    $rootsAfter = @(Get-ChildItem Cert:\CurrentUser\Root | ForEach-Object { $_.Thumbprint } | Sort-Object) -join ','
    if ($rootsBefore -cne $rootsAfter) { throw 'Test changed certificate trust.' }
    Write-Output 'PASS: ephemeral non-exportable key, real signing, pin/overwrite/tamper rejection, untrusted verification denial and WhatIf trust actions. No root trust or host actions.'
} finally {
    if ($null -ne $certificate) {
        $thumbprint = $certificate.Thumbprint; $certificate.Dispose()
        Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint) -DeleteKey -Force
        if (Test-Path -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint)) { throw 'Ephemeral test key cleanup was not confirmed.' }
    }
    # Keep small signed evidence fixtures; no broad recursive filesystem cleanup.
    Write-Output ('Evidence retained (no private key): ' + $fixture)
}
