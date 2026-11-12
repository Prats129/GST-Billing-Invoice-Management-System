# Compilation, pure decision checks and off-screen form layout only.
# No elevation, services, databases, credentials or certificate trust changes.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$fixtureParent = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))) '.local'
if (-not (Test-Path -LiteralPath $fixtureParent)) { $null = New-Item -ItemType Directory -Path $fixtureParent }
$fixture = Join-Path $fixtureParent ('launcher-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixture
try {
    $inventory = Join-Path $fixture 'bootstrap.json'
    [IO.File]::WriteAllText($inventory, '{"signingPurpose":"internal-test","publisherCertificateSha256":"0000000000000000000000000000000000000000000000000000000000000000","files":[]}')
    $exe = Join-Path $fixture 'GSTBillingMaintenance.exe'
    & (Join-Path $PSScriptRoot 'Build-WindowsLauncher.ps1') -OutputPath $exe -InventoryPath $inventory
    $test = Start-Process -FilePath $exe -ArgumentList '--self-test' -WindowStyle Hidden -PassThru -Wait
    if ($test.ExitCode -ne 0) { throw 'Native pure checks failed.' }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $assembly = [Reflection.Assembly]::LoadFile($exe)
    $form = [Activator]::CreateInstance($assembly.GetType('GSTBillingMaintenance.MaintenanceForm'), $true)
    try {
        if ($form.Text -notlike '*INTERNAL TEST ONLY*') { throw 'Internal preview label missing.' }
        $form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
        $form.Location = New-Object Drawing.Point(-32000, -32000)
        $form.ShowInTaskbar = $false
        $form.Show()
        [Windows.Forms.Application]::DoEvents()
        $form.CreateControl()
        $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
        try {
            $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
            $bitmap.Save((Join-Path $fixture 'launcher.png'), [Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $bitmap.Dispose() }
    } finally { $form.Dispose() }
    Write-Output 'PASS: native launcher compiled; argument/path/signature rejection checks and off-screen form creation passed. No host mutations were executed.'
} finally {
    # Loaded .NET assemblies stay locked in this process. Retain this small
    # isolated build fixture; the test never deletes a caller-selected directory.
    Write-Output ('Test fixture retained: ' + $fixture)
}
