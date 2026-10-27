[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$files = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1'
$failures = @()
foreach ($file in $files) {
    $tokens = $null
    $parseErrors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    $failures += $parseErrors
}
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_.Message -ErrorAction Continue }
    throw 'PowerShell syntax check failed.'
}
Write-Output "PASS: parsed $($files.Count) PowerShell files. No certificates, firewall rules, services or databases were changed."
