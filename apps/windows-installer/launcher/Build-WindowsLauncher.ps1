[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $OutputPath,
    [Parameter(Mandatory = $true)][string] $InventoryPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath($OutputPath)
$inventory = [IO.Path]::GetFullPath($InventoryPath)
if ($output -cne $OutputPath -or $inventory -cne $InventoryPath -or
    $output -match '["%\r\n]' -or $inventory -match '["%\r\n]' -or
    (Test-Path -LiteralPath $output) -or -not (Test-Path -LiteralPath $inventory -PathType Leaf) -or
    -not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($output)) -PathType Container)) {
    throw 'Use canonical paths, an existing inventory and a new output file.'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The Windows .NET Framework compiler is required on the publisher build machine.' }
$arguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+', '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll', ("/resource:" + $inventory + ',bootstrap.json'), ("/out:" + $output), (Join-Path $PSScriptRoot 'GSTBillingMaintenance.cs'), (Join-Path $PSScriptRoot 'Bootstrap.cs'))
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Native maintenance launcher compilation failed.' }
Write-Output 'Unsigned maintenance launcher compiled. Authenticode signing and verification are required before host actions.'
