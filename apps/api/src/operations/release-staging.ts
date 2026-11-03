import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, rm, chmod } from 'node:fs/promises';
import { dirname, join, resolve, sep, basename } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { EntitlementTrust } from '../licensing/entitlement.js';
import { ReleaseError, verifyReleasePackage } from './release-package.js';
import type { ReleaseFile } from './release-package.js';

// Shared by update journals: protect a newly created operator directory before
// writing, and reject unsafe owners/reparse points/replaceable ancestors.
export async function secureDirectory(path: string, protect = true) {
  if (process.platform === 'win32') {
    // ACL protection precedes every package write. Check ancestors as well:
    // DeleteChild on a parent can defeat a private child directory's ACL.
    const script = `
$ErrorActionPreference='Stop'
$p=$env:GST_RELEASE_STAGE
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted=@($current.Value,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($s in @($current,[Security.Principal.SecurityIdentifier]'S-1-5-18',[Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
if($env:GST_RELEASE_PROTECT -eq 'yes') { Set-Acl -LiteralPath $p -AclObject $acl }
$item=Get-Item -LiteralPath $p -Force
$first=$true
while($null -ne $item) {
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse path' }
  $acl=Get-Acl -LiteralPath $item.FullName
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Untrusted owner' }
  foreach($rule in $acl.Access) {
    if($rule.AccessControlType -ne 'Allow') { continue }
    if(-not $first -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if($sid -in $trusted) { continue }
    $rights=[Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
    if($first) { $rights=[Security.AccessControl.FileSystemRights]'ReadData,Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
    if(($rule.FileSystemRights -band $rights) -ne 0) { throw 'Untrusted access' }
  }
  $first=$false
  $item=$item.Parent
}`;
    await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: {
          ...process.env,
          GST_RELEASE_STAGE: path,
          GST_RELEASE_PROTECT: protect ? 'yes' : 'no',
        },
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 16384,
      },
    );
  } else {
    if (protect) await chmod(path, 0o700);
    const uid = process.getuid!();
    let current = path;
    while (true) {
      const info = await lstat(current);
      if (current === path && (info.mode & 0o077) !== 0)
        throw new ReleaseError();
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        ![0, uid].includes(info.uid)
      )
        throw new ReleaseError();
      // A root-owned sticky temporary directory protects existing children.
      if (
        (info.mode & 0o022) !== 0 &&
        !(info.uid === 0 && (info.mode & 0o1000) !== 0)
      )
        throw new ReleaseError();
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

// Read-only audit of existing recovery evidence; never repair its ACL implicitly.
export async function assertPrivateDirectory(path: string) {
  await secureDirectory(path, false);
}

async function copyBounded(
  source: string,
  target: string,
  expected?: ReleaseFile,
) {
  const info = await lstat(source);
  const maximum = expected?.bytes ?? 2 * 1024 * 1024;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > maximum ||
    (expected && info.size !== expected.bytes)
  )
    throw new ReleaseError();
  const hash = createHash('sha256');
  let bytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) return callback(new ReleaseError());
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      const digest = hash.digest('hex');
      if (expected && (bytes !== expected.bytes || digest !== expected.sha256))
        return callback(new ReleaseError());
      callback();
    },
  });
  await pipeline(
    createReadStream(source),
    guard,
    createWriteStream(target, { flags: 'wx', mode: 0o600 }),
  );
}

export async function stageReleasePackage(
  source: string,
  stagingParent: string,
  trust: EntitlementTrust,
  installed: { version: string; schemaDigest: string },
) {
  source = resolve(source);
  stagingParent = resolve(stagingParent);
  let staged: string | undefined;
  try {
    const sourceKey =
      process.platform === 'win32' ? source.toLowerCase() : source;
    const parentKey =
      process.platform === 'win32'
        ? stagingParent.toLowerCase()
        : stagingParent;
    if (
      parentKey === sourceKey ||
      parentKey.startsWith(
        sourceKey.endsWith(sep) ? sourceKey : sourceKey + sep,
      )
    )
      throw new ReleaseError();
    const parent = await lstat(stagingParent);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new ReleaseError();
    const manifest = await verifyReleasePackage(source, trust, installed);
    staged = await mkdtemp(join(stagingParent, 'gst-release-'));
    await secureDirectory(staged);
    for (const file of manifest.files) {
      const target = join(staged, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyBounded(join(source, ...file.path.split('/')), target, file);
    }
    await copyBounded(
      join(source, 'release.json'),
      join(staged, 'release.json'),
    );
    const verified = await verifyReleasePackage(staged, trust, installed);
    if (JSON.stringify(verified) !== JSON.stringify(manifest))
      throw new ReleaseError();
    return {
      directory: staged,
      version: verified.version,
      files: verified.files.length,
      schemaDigest: verified.toSchemaDigest,
    };
  } catch {
    // Only a newly generated child is eligible for cleanup, never caller paths.
    if (
      staged &&
      dirname(staged) === stagingParent &&
      basename(staged).startsWith('gst-release-')
    ) {
      const info = await lstat(staged);
      if (!info.isSymbolicLink())
        await rm(staged, { recursive: true, force: true });
    }
    throw new ReleaseError();
  }
}
