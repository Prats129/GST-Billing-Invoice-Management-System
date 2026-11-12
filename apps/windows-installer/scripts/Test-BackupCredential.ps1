# Decision tests only: never authenticate an account, change policy or save credentials.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Capture-BackupCredential.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Credential helper syntax invalid.' }
$native = $ast.Find({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.StartsWith('using System;') }, $true)
if ($null -eq $native) { throw 'Batch-logon native binding missing.' }
Add-Type -TypeDefinition $native.Value
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([ScriptBlock]::Create($function.Extent.Text))
}
$script:code = 0
function Get-BackupBatchLogonError { param($Username, $Password) return $script:code }
$password = ConvertTo-SecureString 'inert-test-only' -AsPlainText -Force
try {
    Assert-BackupBatchLogon 'fixture' $password
    foreach ($code in @(1385, 1326, 1331, 1909, 5)) {
        $script:code = $code; $rejected = $false
        try { Assert-BackupBatchLogon 'fixture' $password } catch {
            $rejected = $true
            if ($code -eq 1385 -and $_.Exception.Message -notmatch 'batch job') { throw 'Missing policy guidance.' }
        }
        if (-not $rejected) { throw 'Unverified batch identity accepted.' }
    }
} finally { $password.Dispose() }
Write-Output 'PASS: credential preparation rejects denied batch logon, incorrect passwords, disabled/locked accounts and privileged identities. No real logon or host changes.'
