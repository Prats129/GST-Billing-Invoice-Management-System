using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GSTBillingMaintenance
{
    internal static class Bootstrap
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        private static readonly string CurrentSid = IdentitySid();
        private static string IdentitySid()
        {
            using (var identity = WindowsIdentity.GetCurrent()) return identity.User.Value;
        }
        private static Dictionary<string, object> Inventory()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("bootstrap.json")) {
                if (stream == null || stream.Length > 16 * 1024 * 1024) throw new InvalidOperationException();
                using (var reader = new StreamReader(stream)) return (Dictionary<string, object>)Json.DeserializeObject(reader.ReadToEnd());
            }
        }
        internal static string Hash(Stream input)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
        internal static bool InternalTest
        {
            get {
                object value;
                return Inventory().TryGetValue("signingPurpose", out value) && Convert.ToString(value) == "internal-test";
            }
        }
        internal static string FileHash(string file)
        {
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) return Hash(input);
        }
        internal static string Child(string root, string relative)
        {
            if (String.IsNullOrEmpty(relative) || relative.Contains(":") || relative.Contains("\\") || relative.StartsWith("/") ||
                relative.Contains("../") || relative.Contains("//") || relative.EndsWith("/") || relative.IndexOf('\0') >= 0) throw new InvalidOperationException();
            string result = Path.GetFullPath(Path.Combine(root, relative.Replace('/', '\\')));
            if (!result.StartsWith(Path.GetFullPath(root).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
            return result;
        }
        private static bool Trusted(string sid)
        {
            return sid == CurrentSid || sid == "S-1-5-18" ||
                sid == "S-1-5-32-544" || sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
        }
        internal static void Protected(string path, bool directory, HashSet<string> checkedDirectories = null)
        {
            FileSystemInfo item = directory ? (FileSystemInfo)new DirectoryInfo(path) : new FileInfo(path);
            bool first = true;
            while (item != null) {
                // An ancestor cache proves replacement resistance only. Every
                // directory is checked as a first item during the tree walk,
                // including its file-creation rights, even if already cached.
                if (!first && item is DirectoryInfo && checkedDirectories != null && checkedDirectories.Contains(item.FullName)) return;
                if (!item.Exists || (item.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
                FileSystemSecurity acl = item is DirectoryInfo ? (FileSystemSecurity)((DirectoryInfo)item).GetAccessControl() : ((FileInfo)item).GetAccessControl();
                if (!Trusted(((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value)) throw new InvalidOperationException();
                foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
                    if (rule.AccessControlType != AccessControlType.Allow || (!first && (rule.PropagationFlags & PropagationFlags.InheritOnly) != 0)) continue;
                    if (Trusted(((SecurityIdentifier)rule.IdentityReference).Value)) continue;
                    var rights = FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
                    if (first) rights |= FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.WriteAttributes | FileSystemRights.WriteExtendedAttributes;
                    if ((rule.FileSystemRights & rights) != 0) throw new InvalidOperationException();
                }
                if (item is DirectoryInfo && checkedDirectories != null) checkedDirectories.Add(item.FullName);
                first = false; item = item is DirectoryInfo ? ((DirectoryInfo)item).Parent : ((FileInfo)item).Directory;
            }
        }
        internal static void Verify()
        {
            if (!Program.Elevated) throw new InvalidOperationException();
            var inventory = Inventory();
            string expectedSigner = Convert.ToString(inventory["publisherCertificateSha256"]);
            if (expectedSigner.Length != 64) throw new InvalidOperationException();
            NativeTrust.Verify(Application.ExecutablePath);
            using (var signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(Application.ExecutablePath)))
            using (var bytes = new MemoryStream(signer.RawData))
                if (Hash(bytes) != expectedSigner) throw new InvalidOperationException();
            Protected(Application.ExecutablePath, false);
            var files = (object[])inventory["files"];
            if (files.Length == 0 || files.Length > 20000) throw new InvalidOperationException();
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var checkedDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> file in files) {
                string relative = Convert.ToString(file["path"]);
                if (!names.Add(relative)) throw new InvalidOperationException();
                string target = Child(Application.StartupPath, relative); Protected(target, false, checkedDirectories);
                if (new FileInfo(target).Length != Convert.ToInt64(file["bytes"]) || FileHash(target) != Convert.ToString(file["sha256"])) throw new InvalidOperationException();
            }
            var pending = new Stack<string>(); pending.Push(Application.StartupPath); int count = 0;
            while (pending.Count > 0) {
                string directory = pending.Pop(); Protected(directory, true, checkedDirectories);
                foreach (string item in Directory.GetFileSystemEntries(directory)) {
                    if (++count > 50000 || (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
                    if (Directory.Exists(item)) pending.Push(item);
                    else if (!String.Equals(item, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) {
                        string relative = item.Substring(Application.StartupPath.Length + 1).Replace('\\', '/');
                        if (!names.Contains(relative)) throw new InvalidOperationException();
                    }
                }
            }
        }
        internal static async Task<Dictionary<string, object>> Invoke(string command, Action<string> progress)
        {
            await Task.Run((Action)Verify);
            var start = CleanProcess(Path.Combine(Application.StartupPath, "node.exe"),
                Quote(Path.Combine(Application.StartupPath, "app", "apps", "api", "dist", "operations", "windows-lifecycle-cli.js")));
            start.RedirectStandardInput = true;
            using (var process = new Process { StartInfo = start }) {
                process.Start();
                var errors = ReadBounded(process.StandardError, 65536);
                var output = ReadEvents(process.StandardOutput, progress);
                await process.StandardInput.WriteAsync(command); process.StandardInput.Close();
                var result = await output; string error = await errors; await Task.Run((Action)process.WaitForExit);
                if (process.ExitCode != 0 || error.Length != 0 || result == null) {
                    if (result != null && Convert.ToString(result["event"]) == "failed") throw new RunnerFailure(Convert.ToString(result["message"]));
                    throw new RunnerFailure("The host ended without a verified result. Open Interrupted operation before retrying.");
                }
                return result;
            }
        }
        private static async Task<Dictionary<string, object>> ReadEvents(StreamReader reader, Action<string> progress)
        {
            // Read incrementally, with a total cap, so progress stays visible.
            var line = new StringBuilder(); char[] buffer = new char[1024]; int count, total = 0; bool oversized = false;
            Dictionary<string, object> last = null;
            while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) != 0) {
                total += count;
                if (total > 65536) { oversized = true; continue; }
                for (int i = 0; i < count; i++) {
                    if (buffer[i] != '\n') { line.Append(buffer[i]); continue; }
                    last = (Dictionary<string, object>)Json.DeserializeObject(line.ToString()); line.Clear();
                    if (Convert.ToString(last["event"]) == "progress") progress(Convert.ToString(last["phase"]).Replace('_', ' '));
                }
            }
            if (oversized || line.Length != 0) throw new RunnerFailure("Invalid host response. Inspect the saved operation.");
            return last;
        }
        private static async Task<string> ReadBounded(StreamReader reader, int maximum)
        {
            char[] buffer = new char[2048]; var result = new StringBuilder(); int count; bool oversized = false;
            while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) != 0) {
                if (result.Length + count > maximum) oversized = true; else if (!oversized) result.Append(buffer, 0, count);
            }
            if (oversized) throw new RunnerFailure("Invalid host response. Inspect the saved operation.");
            return result.ToString();
        }
        private static ProcessStartInfo CleanProcess(string executable, string args)
        {
            var start = new ProcessStartInfo { FileName = executable, Arguments = args, UseShellExecute = false,
                RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = Application.StartupPath };
            start.EnvironmentVariables.Clear(); string system = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            start.EnvironmentVariables["SystemRoot"] = system; start.EnvironmentVariables["WINDIR"] = system;
            start.EnvironmentVariables["PATH"] = Path.Combine(system, "System32");
            start.EnvironmentVariables["TEMP"] = Path.GetTempPath(); start.EnvironmentVariables["TMP"] = Path.GetTempPath();
            return start;
        }
        internal static string Helper(string name, string[] args)
        {
            if (name != "Capture-BackupCredential.ps1" && name != "Trust-LanCa.ps1") throw new InvalidOperationException();
            Verify();
            string system = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string script = Path.Combine(Application.StartupPath, "app", "apps", "windows-installer", "scripts", name);
            var command = new StringBuilder("-NoLogo -NoProfile -File " + Quote(script));
            foreach (string arg in args) command.Append(" " + Quote(arg));
            using (var process = Process.Start(CleanProcess(Path.Combine(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), command.ToString()))) {
                var output = ReadBounded(process.StandardOutput, 16384); var error = ReadBounded(process.StandardError, 16384);
                Task.WaitAll(output, error); process.WaitForExit();
                if (process.ExitCode != 0 || error.Result.Length != 0) throw new RunnerFailure(name == "Capture-BackupCredential.ps1" ?
                    "Backup identity was not prepared. Check the enabled LOCAL standard account and password, a new file in a protected destination, and Windows 'Log on as a batch job' / 'Deny log on as a batch job' policies. Ask the Windows administrator to resolve policy restrictions and retry. No policy was changed." :
                    "The Windows helper did not complete. Check the selected certificate, independently verified CA-file fingerprint and protected destination.");
                return output.Result;
            }
        }
        internal static string SaveOwnerInput(string parent, string json)
        {
            Verify(); Protected(parent, true);
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            foreach (var sid in new[] { new SecurityIdentifier(CurrentSid), new SecurityIdentifier("S-1-5-18"), new SecurityIdentifier("S-1-5-32-544") })
                security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            string folder = Path.Combine(parent, "gst-owner-" + Guid.NewGuid().ToString("N"));
            if (Directory.Exists(folder) || File.Exists(folder)) throw new InvalidOperationException();
            Directory.CreateDirectory(folder, security);
            string file = Path.Combine(folder, "owner.json");
            using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                try { output.Write(bytes, 0, bytes.Length); output.Flush(true); } finally { Array.Clear(bytes, 0, bytes.Length); }
            }
            return "Owner setup file prepared: " + file + "\r\nChoose this file during installation. Keep it private; remove it after successful setup and secure the separate recovery material.";
        }
        internal static string Quote(string value)
        {
            if (value == null || value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) throw new InvalidOperationException();
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); result.Append(c); slashes = 0;
            }
            result.Append('\\', slashes * 2); return result.Append('"').ToString();
        }
    }
    internal static class NativeTrust
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct FileInfo { internal uint Size; [MarshalAs(UnmanagedType.LPWStr)] internal string Path; internal IntPtr Handle; internal IntPtr Subject; }
        [StructLayout(LayoutKind.Sequential)]
        private struct TrustData {
            internal uint Size; internal IntPtr Callback, Client; internal uint UI, Revocation, Choice;
            internal IntPtr File; internal uint StateAction; internal IntPtr State, URL; internal uint Flags, Context; internal IntPtr Signature;
        }
        [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
        internal static void Verify(string path)
        {
            var file = new FileInfo { Size = (uint)Marshal.SizeOf(typeof(FileInfo)), Path = path };
            IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo))); Marshal.StructureToPtr(file, memory, false);
            var data = new TrustData { Size = (uint)Marshal.SizeOf(typeof(TrustData)), UI = 2, Choice = 1, File = memory, StateAction = 1, Flags = 0x1000 | 0x2000 | 0x10 };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            try { if (WinVerifyTrust(new IntPtr(-1), ref action, ref data) != 0) throw new InvalidOperationException(); }
            finally { data.StateAction = 2; WinVerifyTrust(new IntPtr(-1), ref action, ref data); Marshal.DestroyStructure(memory, typeof(FileInfo)); Marshal.FreeHGlobal(memory); }
        }
    }
    internal static class SelfTest
    {
        internal static void Run()
        {
            if (SetupCandidates.Subnet(System.Net.IPAddress.Parse("192.168.5.20"), System.Net.IPAddress.Parse("255.255.255.0")) != "192.168.5.0/24") throw new Exception("Subnet suggestion");
            foreach (string address in new[] { "127.0.0.1", "169.254.1.1", "8.8.8.8", "172.32.0.1", "::1" })
                if (SetupCandidates.Private(System.Net.IPAddress.Parse(address))) throw new Exception("Unsafe address suggestion");
            foreach (string mask in new[] { "255.0.255.0", "0.0.0.0" }) {
                try { SetupCandidates.Subnet(System.Net.IPAddress.Parse("192.168.5.20"), System.Net.IPAddress.Parse(mask)); throw new Exception("Unsafe subnet accepted"); } catch (InvalidOperationException) { }
            }
            if (Bootstrap.Quote("C:\\folder with space\\") != "\"C:\\folder with space\\\\\"") throw new Exception("Argument encoding");
            foreach (string path in new[] { "../escape", "x:stream", "/escape" }) {
                try { Bootstrap.Child("C:\\safe", path); throw new Exception("Unsafe child accepted"); } catch (InvalidOperationException) { }
            }
            if (Bootstrap.Child("C:\\safe", "app/index.js") != "C:\\safe\\app\\index.js") throw new Exception("Child path");
            try { NativeTrust.Verify(Application.ExecutablePath); throw new Exception("Unsigned launcher accepted"); } catch (InvalidOperationException) { }
        }
    }
}
