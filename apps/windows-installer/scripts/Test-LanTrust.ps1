# Exercise real certificate parsing/fingerprint validation with WhatIf.
# No certificate is added to or removed from a Windows store.
$ErrorActionPreference = 'Stop'
$parent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\.local'))
if (-not (Test-Path -LiteralPath $parent)) { $null = New-Item -ItemType Directory -Path $parent }
$fixture = Join-Path $parent ('trust-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixture
$openssl = if ($env:TEST_OPENSSL_PATH) { $env:TEST_OPENSSL_PATH } else { 'C:\Program Files\Git\usr\bin\openssl.exe' }
try {
    $key = Join-Path $fixture 'ephemeral.key'
    $ca = Join-Path $fixture 'ephemeral.cer'
    $arguments = @('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', ('"' + $key + '"'), '-out', ('"' + $ca + '"'), '-outform', 'DER', '-days', '1', '-subj', '"/CN=Ephemeral lifecycle trust test"', '-addext', 'basicConstraints=critical,CA:TRUE')
    $process = Start-Process -FilePath $openssl -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $fixture 'openssl.out') -RedirectStandardError (Join-Path $fixture 'openssl.err')
    if ($process.ExitCode -ne 0) { throw 'Ephemeral certificate fixture generation failed.' }
    $fingerprint = (Get-FileHash -LiteralPath $ca -Algorithm SHA256).Hash
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-LifecycleBackup.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw 'Certificate identity helper syntax invalid.' }
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-LifecycleCertificateIdentity' }, $false)
    . ([ScriptBlock]::Create($definition.Extent.Text))
    # Only the generated disposable file is read; production path validation is tested separately.
    function Assert-OfflinePath { param($Path, $Private) }
    $identity = Get-LifecycleCertificateIdentity $ca
    if ($identity.subject -notmatch 'Ephemeral lifecycle trust test' -or $identity.serverCertificateSha256 -cne $fingerprint.ToLowerInvariant()) { throw 'Wrong server certificate identity.' }
    $pem = Join-Path $fixture 'chain.pem'
    [IO.File]::WriteAllText($pem, ("-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String([IO.File]::ReadAllBytes($ca)) + "`n-----END CERTIFICATE-----"))
    if ((Get-LifecycleCertificateIdentity $pem).serverCertificateSha256 -cne $identity.serverCertificateSha256) { throw 'PEM and DER identity mismatch.' }
    $before = @(Get-ChildItem Cert:\LocalMachine\Root | ForEach-Object { $_.Thumbprint } | Sort-Object) -join ','
    & (Join-Path $PSScriptRoot 'Trust-LanCa.ps1') -CertificatePath $ca -ExpectedSha256 $fingerprint -ApprovalConfirmed -WhatIf
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'Trust-LanCa.ps1') -CertificatePath $ca -ExpectedSha256 ('0' * 64) -WhatIf } catch { $rejected = $true }
    if (-not $rejected) { throw 'Wrong fingerprint accepted.' }
    $after = @(Get-ChildItem Cert:\LocalMachine\Root | ForEach-Object { $_.Thumbprint } | Sort-Object) -join ','
    if ($after -cne $before) { throw 'Certificate store changed during a WhatIf-only test.' }
    Write-Output 'PASS: real CA parsing and exact-byte fingerprint checks; WhatIf left the Windows trust store unchanged.'
} finally {
    $target = [IO.Path]::GetFullPath($fixture)
    if ([IO.Path]::GetDirectoryName($target) -cne $parent -or [IO.Path]::GetFileName($target) -notmatch '^trust-test-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup.' }
    Remove-Item -LiteralPath $target -Recurse -Force
}
