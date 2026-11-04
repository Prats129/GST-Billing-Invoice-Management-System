// Static ZIP/PE inspection only. Vendor executables are never launched.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { z } from 'zod';
import type { offlineArtifactReviewSchema } from '../../apps/api/src/operations/offline-installer.js';
import { fileHash } from './windows-runtime.js';

export async function derivePostgresRuntime(
  source: string,
  target: string,
  expectedSourceSha256: string,
) {
  if (
    process.platform !== 'win32' ||
    (await fileHash(source)) !== expectedSourceSha256
  )
    throw new Error('Official PostgreSQL source pin required.');
  const script = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$inputZip=[IO.Compression.ZipFile]::OpenRead($env:GST_PG_SOURCE)
$file=New-Object IO.FileStream($env:GST_PG_TARGET,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$output=New-Object IO.Compression.ZipArchive($file,[IO.Compression.ZipArchiveMode]::Create,$true)
$count=0
try{
 foreach($entry in @($inputZip.Entries|Sort-Object FullName)){
  if($entry.FullName.EndsWith('/')){continue}
  if($entry.FullName-notmatch '^pgsql/(?:bin/|lib/|share/|server_license\.txt$|commandlinetools_3rd_party_licenses\.txt$)'){continue}
  if($entry.FullName-match '(^|/)\.\.?(/|$)|[:\x00-\x1f]'){throw 'Unsafe source archive.'}
  $created=$output.CreateEntry($entry.FullName,[IO.Compression.CompressionLevel]::Optimal)
  $created.LastWriteTime=[DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
  $from=$entry.Open();$to=$created.Open();try{$from.CopyTo($to)}finally{$from.Dispose();$to.Dispose()};$count++
 }
}finally{$output.Dispose();$file.Flush($true);$file.Dispose();$inputZip.Dispose()}
[Console]::Out.WriteLine(($count|ConvertTo-Json -Compress))
`;
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const { stdout } = await promisify(execFile)(
    join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 4096,
      env: {
        SystemRoot: system,
        WINDIR: system,
        GST_PG_SOURCE: source,
        GST_PG_TARGET: target,
      },
    },
  );
  if ((await fileHash(source)) !== expectedSourceSha256)
    throw new Error('PostgreSQL source changed during derivation.');
  return {
    format: 1,
    sourceSha256: expectedSourceSha256,
    derivedSha256: await fileHash(target),
    files: JSON.parse(stdout) as number,
    selection: [
      'pgsql/bin/',
      'pgsql/lib/',
      'pgsql/share/',
      'pgsql/server_license.txt',
      'pgsql/commandlinetools_3rd_party_licenses.txt',
    ],
    timestamp: '2000-01-01T00:00:00Z',
    executedVendorCode: false,
  };
}

export async function inspectWindowsVendor(input: {
  nodeArchive: string;
  nodeDirectory: string;
  postgresArchive: string;
  postgresDirectory: string;
  winswFile: string;
  nodeExecutables?: string[];
  postgresExecutables?: string[];
}) {
  if (process.platform !== 'win32')
    throw new Error(
      'Static Windows bundle inspection requires a Windows producer.',
    );
  const script = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$config=$env:GST_VENDOR_PROBE|ConvertFrom-Json
function PeMachine([byte[]]$bytes,[bool]$Managed=$false) {
 if($bytes.Length-lt 64 -or $bytes[0]-ne 77 -or $bytes[1]-ne 90){throw 'Not a Windows executable.'}
 $offset=[BitConverter]::ToInt32($bytes,60)
 if($offset-lt 64 -or $offset+256-gt $bytes.Length -or [BitConverter]::ToUInt32($bytes,$offset)-ne 17744){throw 'Invalid PE header.'}
 $machine=[BitConverter]::ToUInt16($bytes,$offset+4)
 if($Managed){if($machine-ne 332 -or [BitConverter]::ToUInt16($bytes,$offset+24)-ne 267 -or [BitConverter]::ToUInt32($bytes,$offset+232)-eq 0){throw 'Expected managed WinSW variant.'}}
 elseif($machine-ne 34404){throw 'Expected Windows x64 executable.'}
 return $machine
}
function Archive([string]$Path,[string]$Prefix,[string[]]$Required) {
 $zip=[IO.Compression.ZipFile]::OpenRead($Path);$total=[long]0;$maximum=0
 $names=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 try {
  if($zip.Entries.Count-gt 100000){throw 'Too many archive entries.'}
  foreach($entry in $zip.Entries){
   $name=$entry.FullName.Replace('\','/')
   if(-not $name.StartsWith($Prefix+'/') -or $name-match '(^|/)\.\.?(/|$)|[:\x00-\x1f]' -or -not $names.Add($name.TrimEnd('/')) -or (($entry.ExternalAttributes-shr 16)-band 61440)-eq 40960){throw 'Unsafe archive path.'}
   foreach($part in $name.TrimEnd('/').Split('/')){if(-not $part -or $part-match '[<>"|?*]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'){throw 'Unsafe Windows archive path.'}}
   $total+=$entry.Length;if($entry.Length-gt 1073741824 -or $total-gt 5368709120){throw 'Archive expansion limit.'}
   $maximum=[Math]::Max($maximum,$name.Length)
  }
  $files=[ordered]@{}
  foreach($relative in $Required){
   $entry=$zip.GetEntry($Prefix+'/'+$relative);if($null-eq $entry -or $entry.Length-lt 512){throw 'Reviewed executable missing.'}
   $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
   try{$files[$relative]=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
   $stream=$entry.Open();try{$header=New-Object byte[] ([int][Math]::Min($entry.Length,1048576));$used=0;while($used-lt $header.Length){$count=$stream.Read($header,$used,$header.Length-$used);if($count-eq 0){break};$used+=$count};$null=PeMachine $header}finally{$stream.Dispose()}
  }
  return @{executables=$files;entries=$zip.Entries.Count;uncompressedBytes=$total;maximumRelativePathLength=$maximum}
 }finally{$zip.Dispose()}
}
$nodeRequired=@('node.exe');if($config.nodeExecutables){$nodeRequired=@($config.nodeExecutables)}
$pgRequired=@('bin/postgres.exe','bin/initdb.exe','bin/pg_ctl.exe','bin/psql.exe','bin/pg_isready.exe','bin/pg_dump.exe','bin/pg_restore.exe');if($config.postgresExecutables){$pgRequired=@($config.postgresExecutables)}
$node=Archive $config.nodeArchive $config.nodeDirectory $nodeRequired
$postgres=Archive $config.postgresArchive $config.postgresDirectory $pgRequired
$wrapper=[IO.File]::ReadAllBytes($config.winswFile);$machine=PeMachine $wrapper $true
[Console]::Out.WriteLine((@{format=1;node=$node;postgres=$postgres;wrapperMachine=$machine;executedVendorCode=$false}|ConvertTo-Json -Depth 6 -Compress))
`;
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const { stdout } = await promisify(execFile)(
    join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 16384,
      env: {
        SystemRoot: system,
        WINDIR: system,
        GST_VENDOR_PROBE: JSON.stringify(input),
      },
    },
  );
  return JSON.parse(stdout) as {
    format: 1;
    node: {
      executables: Record<string, string>;
      entries: number;
      uncompressedBytes: number;
      maximumRelativePathLength: number;
    };
    postgres: {
      executables: Record<string, string>;
      entries: number;
      uncompressedBytes: number;
      maximumRelativePathLength: number;
    };
    wrapperMachine: number;
    executedVendorCode: false;
  };
}
export async function verifyWindowsVendor(
  root: string,
  review: z.infer<typeof offlineArtifactReviewSchema>,
) {
  const node = ['node.exe'],
    postgres = [
      'bin/postgres.exe',
      'bin/initdb.exe',
      'bin/pg_ctl.exe',
      'bin/psql.exe',
      'bin/pg_isready.exe',
      'bin/pg_dump.exe',
      'bin/pg_restore.exe',
    ];
  if (
    node.some((n) => !review.node.executables[n]) ||
    postgres.some((n) => !review.postgres.executables[n])
  )
    throw new Error('Required executable pins missing.');
  const result = await inspectWindowsVendor({
    nodeArchive: join(root, review.node.archive),
    nodeDirectory: review.node.directory,
    postgresArchive: join(root, review.postgres.archive),
    postgresDirectory: review.postgres.directory,
    winswFile: join(root, review.winsw.file),
    nodeExecutables: Object.keys(review.node.executables),
    postgresExecutables: Object.keys(review.postgres.executables),
  });
  for (const [declared, actual] of [
    [review.node.executables, result.node.executables],
    [review.postgres.executables, result.postgres.executables],
  ])
    for (const [name, digest] of Object.entries(declared!))
      if (actual![name] !== digest)
        throw new Error('Reviewed executable pin differs from archive.');
  return result;
}
