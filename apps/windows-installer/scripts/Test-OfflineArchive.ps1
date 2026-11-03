# Real ZIP/path checks in a generated temporary directory only. No executables
# are started, and no services, task, network, trust or database calls occur.
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DeploymentChecks.ps1"
. "$PSScriptRoot/OfflineInstaller.ps1"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$root=Join-Path $parent ('gst-archive-test-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($root)
function New-FixtureZip([string]$File,[string[]]$Names) {
    $zip=[IO.Compression.ZipFile]::Open($File,[IO.Compression.ZipArchiveMode]::Create)
    try {foreach($name in $Names){$entry=$zip.CreateEntry($name);$stream=$entry.Open();try{$bytes=[Text.Encoding]::UTF8.GetBytes('fixture');$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}}}finally{$zip.Dispose()}
}
try {
    $good=Join-Path $root 'good.zip';$destination=Join-Path $root 'good';$null=[IO.Directory]::CreateDirectory($destination)
    New-FixtureZip $good @('vendor/bin/tool.txt')
    Expand-OfflineArchive $good $destination 'vendor'
    if([IO.File]::ReadAllText((Join-Path $destination 'vendor\bin\tool.txt')) -cne 'fixture'){throw 'Safe archive failed.'}
    $counter=0
    foreach($names in @(@('vendor/../escape.txt'),@('elsewhere/file.txt'),@('vendor/name:stream'),@('vendor/nul.txt'),@('vendor/file.'),@('vendor/A.txt','vendor/a.txt'))) {
        $counter++;$archive=Join-Path $root ('bad'+$counter+'.zip');$output=Join-Path $root ('bad'+$counter)
        $null=[IO.Directory]::CreateDirectory($output);New-FixtureZip $archive $names
        $rejected=$false;try{Expand-OfflineArchive $archive $output 'vendor'}catch{$rejected=$true}
        if(-not $rejected){throw 'Unsafe archive accepted.'}
    }
    if([IO.File]::Exists((Join-Path $root 'escape.txt'))){throw 'Archive escaped its destination.'}
    Write-Output 'PASS: real bounded ZIP extraction, traversal/prefix/ADS/device/trailing-dot/case-collision refusal in temporary fixtures only.'
} finally {
    $target=[IO.Path]::GetFullPath($root)
    if([IO.Path]::GetDirectoryName($target) -ne $parent -or [IO.Path]::GetFileName($target) -notmatch '^gst-archive-test-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup.'}
    Remove-Item -LiteralPath $target -Recurse -Force
}
