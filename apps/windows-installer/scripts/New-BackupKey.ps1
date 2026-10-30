param([Parameter(Mandatory = $true)][string] $Directory)
. "$PSScriptRoot/Common.ps1"

# A new private directory is required. Never overwrite an existing recovery key.
$privateDirectory = New-PrivateDirectory -Path $Directory
$key = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($key)
    $stream = [IO.File]::Open((Join-Path $privateDirectory 'backup.key'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($key, 0, $key.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $installation = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $privateDirectory 'installation-id.txt'), $installation)
    Write-Output 'Private backup key and installation-id.txt created. Store a protected off-device recovery copy separately from backups.'
} finally {
    [Array]::Clear($key, 0, $key.Length)
    $random.Dispose()
}
