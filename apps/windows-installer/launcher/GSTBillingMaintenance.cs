// .NET Framework 4.8 / Windows Forms. No browser server or installer framework.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GSTBillingMaintenance
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--self-test") {
                try { SelfTest.Run(); } catch { Environment.Exit(1); }
                return;
            }
            if (args.Length != 0 && !(args.Length == 1 && args[0] == "--elevated")) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MaintenanceForm());
        }
        internal static bool Elevated
        {
            get { using (var identity = WindowsIdentity.GetCurrent()) return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); }
        }
    }
    internal sealed class RunnerFailure : Exception { internal RunnerFailure(string message) : base(message) { } }
    internal sealed class MaintenanceForm : Form
    {
        private readonly TextBox root = new TextBox();
        private readonly ComboBox action = new ComboBox();
        private readonly Button run = new Button();
        private readonly TextBox feedback = new TextBox();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 65536 };
        private bool busy;
        private readonly Dictionary<string, Dictionary<string, string>> drafts = new Dictionary<string, Dictionary<string, string>>();
        private static readonly string[] Actions = {
            "Check installation", "Install a new host", "Install signed license", "Run verified backup",
            "Update from signed bundle", "Replace HTTPS certificate", "Repair existing installation",
            "Inspect interrupted operation", "Recover inspected operation", "Uninstall and keep data",
            "Prepare backup account credential", "Trust a verified LAN certificate", "Prepare initial owner account",
            "Connection guide"
        };
        internal MaintenanceForm()
        {
            Text = "GST Billing — Setup & Recovery";
            if (Bootstrap.InternalTest) Text += " [INTERNAL TEST ONLY]";
            ClientSize = new Size(720, 510); MinimumSize = new Size(620, 460);
            StartPosition = FormStartPosition.CenterScreen; Font = SystemFonts.MessageBoxFont; AutoScaleMode = AutoScaleMode.Dpi;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 2, RowCount = 8 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);
            var title = new Label { Text = "Offline setup and maintenance", AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
            layout.Controls.Add(title, 0, 0); layout.SetColumnSpan(title, 2);
            var authority = new Button { Text = Program.Elevated ? "Administrator mode enabled" : "Enable administrator mode", AutoSize = true, Enabled = !Program.Elevated };
            authority.Click += delegate {
                try {
                    using (var child = Process.Start(new ProcessStartInfo { FileName = Application.ExecutablePath, Arguments = "--elevated", UseShellExecute = true, Verb = "runas", WorkingDirectory = Application.StartupPath })) { }
                    Close();
                } catch { feedback.Text = "Windows approval was cancelled. No maintenance action was started."; }
            };
            layout.Controls.Add(authority, 0, 1); layout.SetColumnSpan(authority, 2);
            layout.Controls.Add(new Label { Text = "Installation folder", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
            var host = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Fill, AutoSize = true };
            host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); host.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            root.Dock = DockStyle.Fill; root.AccessibleName = "Installation folder"; host.Controls.Add(root);
            var choose = new Button { Text = "Browse…", AutoSize = true };
            choose.Click += delegate { using (var d = new FolderBrowserDialog { ShowNewFolderButton = false }) if (d.ShowDialog(this) == DialogResult.OK) root.Text = d.SelectedPath; };
            host.Controls.Add(choose); layout.Controls.Add(host, 1, 2);
            layout.Controls.Add(new Label { Text = "Task", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
            action.DropDownStyle = ComboBoxStyle.DropDownList; action.Items.AddRange(Actions); action.SelectedIndex = 0; action.Dock = DockStyle.Fill; layout.Controls.Add(action, 1, 3);
            run.Text = "Review task"; run.AutoSize = true; run.Enabled = Program.Elevated;
            run.Click += async delegate { await Run(); }; layout.Controls.Add(run, 1, 4);
            progress.Dock = DockStyle.Fill; progress.Visible = false; progress.Style = ProgressBarStyle.Marquee; layout.Controls.Add(progress, 0, 5); layout.SetColumnSpan(progress, 2);
            feedback.Multiline = true; feedback.ReadOnly = true; feedback.ScrollBars = ScrollBars.Vertical; feedback.Dock = DockStyle.Fill;
            feedback.AccessibleName = "Task progress and result"; layout.Controls.Add(feedback, 0, 6); layout.SetColumnSpan(feedback, 2);
            for (int i = 0; i < 6; i++) layout.RowStyles.Add(new RowStyle());
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var note = new Label { Text = "Keep this publisher-supplied tool outside the installation being repaired. Your data, backups and keys are retained during uninstall.", AutoSize = true, MaximumSize = new Size(660, 0), Padding = new Padding(0, 12, 0, 0) };
            layout.Controls.Add(note, 0, 7); layout.SetColumnSpan(note, 2);
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (busy) { e.Cancel = true; MessageBox.Show(this, "An operation is running. Keep this window open until its result is recorded.", Text); }
            };
        }
        private async Task Run()
        {
            if (busy || !Program.Elevated) return;
            busy = true; run.Enabled = false; action.Enabled = false; progress.Visible = true;
            try {
                feedback.Text = "Checking publisher signature and maintenance runtime…";
                int index = action.SelectedIndex;
                if (index >= 10 && index != 13) { await Helper(index); return; }
                if (index == 13) index = 0;
                var request = BuildRequest(index); if (request == null) return;
                feedback.Text = "Checking selected installation and inputs…";
                var preview = await Invoke("preview", request, null);
                if (Convert.ToString(preview["event"]) != "preview") throw new InvalidOperationException();
                string review = Describe(preview["summary"]); feedback.Text = review;
                if (action.SelectedIndex == 13) feedback.AppendText("\r\n\r\nOn each client: use the exact HTTPS address above. Confirm the host certificate identity with the host administrator through a separate channel. If a private CA is used, obtain its public CA file and independently confirmed CA-file SHA-256, then run 'Trust a verified LAN certificate' on that client. The server certificate fingerprint is NOT the CA-file fingerprint. Never ignore browser certificate warnings. If connection fails, check host readiness, private LAN/DNS and the configured firewall subnet. This guide does not prove another computer can connect.");
                if (index == 0 || index == 7) return;
                if (MessageBox.Show(this, review + "\r\n\r\nProceed with this task?", "Review task", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
                var result = await Invoke("execute", request, Convert.ToString(preview["approval"]));
                if (Convert.ToString(result["event"]) != "completed") throw new InvalidOperationException();
                feedback.AppendText("\r\n\r\nCompleted and verified.\r\n" + Describe(result["result"]));
            } catch (Exception error) {
                feedback.AppendText("\r\n\r\n" + (error is RunnerFailure ? error.Message :
                    "This task could not be verified as complete. Keep existing data and operation records. Check the publisher package and protected installation, then inspect any interrupted operation."));
            } finally { busy = false; run.Enabled = Program.Elevated; action.Enabled = true; progress.Visible = false; }
        }
        private Dictionary<string, object> BuildRequest(int index)
        {
            if (index == 1) {
                Dictionary<string, object> defaults;
                try { defaults = SetupCandidates.Detect(); }
                catch (NetworkInformationException) { throw new RunnerFailure("Windows could not inspect the network. Check the network adapter and retry; no installation was started."); }
                if (!String.IsNullOrWhiteSpace(root.Text)) defaults["root"] = root.Text.Trim();
                if (MessageBox.Show(this, "Detected suggestions (review and edit before installation):\r\n" + Describe(defaults) +
                    "\r\n\r\nA blank address means no unambiguous private interface was found; select the intended LAN with your network administrator. The detected IP can change. Use a reserved address or stable DNS name covered by your TLS certificate. Select only the intended client subnet; suggestions do not change Windows settings. Ports and paths are rechecked by installation preflight.",
                    "Installation suggestions", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return null;
                var fields = Dialog("New installation — publisher and host inputs", new[] {
                    "root|New installation folder", "bundleRoot|Signed bundle folder", "releaseTrustFile|Release public-key file",
                    "origin|Exact HTTPS address (https://host:3443)", "databasePort|Unused database port", "privateSubnet|Private client subnet",
                    "tlsKeyFile|TLS private-key file", "tlsCertFile|TLS certificate-chain file", "certificateTrustFile|Public CA file",
                    "certificateTrustSha256|Independently verified CA SHA-256", "entitlementTrustFile|License public-key file",
                    "ownerInputFile|Protected owner setup file", "backupCredentialFile|Prepared backup credential file",
                    "backupAccountSid|Backup account SID", "backupDailyAt|Daily backup time (HH:mm)"
                }, defaults);
                if (fields == null) return null;
                fields["format"] = 1; fields["installationId"] = Guid.NewGuid().ToString();
                int port; if (!Int32.TryParse(Convert.ToString(fields["databasePort"]), out port)) throw new RunnerFailure("Enter a valid database port.");
                fields["databasePort"] = port;
                return new Dictionary<string, object> { { "action", "install" }, { "configuration", fields } };
            }
            if (String.IsNullOrWhiteSpace(root.Text)) throw new RunnerFailure("Choose the existing installation folder first.");
            string[] names = { "status", "", "license", "backup", "update", "certificate", "repair", "inspect", "recover", "uninstall" };
            var request = new Dictionary<string, object> { { "action", names[index] }, { "root", root.Text.Trim() } };
            if (index == 2) {
                string file = PickFile("Choose signed license"); if (file == null) return null; request["file"] = file;
            } else if (index == 4 || index == 5 || index == 6) {
                string[] fields = index == 4 ? new[] { "bundleRoot|Signed target bundle folder", "releaseTrustFile|Approved release public-key file" } :
                    index == 5 ? new[] { "keyFile|Replacement private-key file", "certFile|Replacement certificate chain", "trustFile|Approved public CA file", "trustSha256|Independently verified CA SHA-256" } :
                    new[] { "bundleRoot|Exact installed signed bundle folder", "releaseTrustFile|Approved release public-key file", "certificateTrustFile|Current public CA file", "certificateTrustSha256|Independently verified CA SHA-256", "backupCredentialFile|Prepared backup credential file" };
                var f = Dialog(Actions[index], fields); if (f == null) return null;
                if (index == 6) request["configuration"] = f; else foreach (var p in f) request[p.Key] = p.Value;
            } else if (index == 8) {
                if (MessageBox.Show(this, "Have you stopped the previous operator and helper processes? Update recovery can return to an older data point. Review the inspection before continuing.", "Recovery confirmation", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return null;
                var f = Dialog("Certificate recovery only", new[] { "selection|For certificates: previous or replacement; otherwise leave empty" }); if (f == null) return null;
                string selection = Convert.ToString(f["selection"]); if (selection.Length != 0) request["selection"] = selection;
                request["operatorStopped"] = true; request["acceptRecoveryPoint"] = true;
            }
            return request;
        }
        private async Task Helper(int index)
        {
            if (index == 12) {
                var fields = Dialog("Initial offline owner", new[] { "organizationName|Business name", "name|Owner name", "email|Owner email", "password|Initial password (at least 15 characters)", "repeatPassword|Repeat password" });
                if (fields == null) return;
                if (Convert.ToString(fields["password"]).Length < 15 || Convert.ToString(fields["password"]) != Convert.ToString(fields["repeatPassword"]))
                    throw new RunnerFailure("Use a password of at least 15 characters and repeat it exactly.");
                fields.Remove("repeatPassword");
                using (var destination = new FolderBrowserDialog { Description = "Choose a protected operator folder for the initial owner setup file" }) {
                    if (destination.ShowDialog(this) != DialogResult.OK) return;
                    feedback.Text = Bootstrap.SaveOwnerInput(destination.SelectedPath, json.Serialize(fields));
                }
            } else if (index == 10) {
                if (MessageBox.Show(this, "Use a dedicated ordinary LOCAL account, not your administrator account.\r\n\r\nIf needed, create one in Windows Settings > Accounts > Other users > Add account > Add a user without a Microsoft account. Keep its account type Standard and use a strong password. Return here afterward.\r\n\r\nWindows must permit 'Log on as a batch job' and must not deny batch logon. This tool tests that right without granting it. On managed computers ask your administrator to configure policy; Windows Home may require administrator-assisted policy preparation.\r\n\r\nReady to select and validate that account?", "Prepare backup identity", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
                string destination;
                using (var save = new SaveFileDialog { Title = "New backup credential in a protected operator folder", Filter = "Credential files|*.xml" }) {
                    if (save.ShowDialog(this) != DialogResult.OK) return; destination = save.FileName;
                }
                feedback.Text = "Windows will ask for the existing ordinary local backup account's credentials.";
                feedback.Text = await Task.Run(() => Bootstrap.Helper("Capture-BackupCredential.ps1", new[] { "-Destination", destination }));
                var match = System.Text.RegularExpressions.Regex.Match(feedback.Text, @"Backup account SID: (S-1-5-21-\d+-\d+-\d+-\d+)");
                if (match.Success) {
                    const string title = "New installation — publisher and host inputs";
                    Dictionary<string, string> saved;
                    if (!drafts.TryGetValue(title, out saved)) { saved = new Dictionary<string, string>(); drafts[title] = saved; }
                    saved["backupCredentialFile"] = destination; saved["backupAccountSid"] = match.Groups[1].Value;
                    feedback.AppendText("\r\nThe credential path and SID will be prefilled in the installation form for your review.");
                }
            } else {
                string ca = PickFile("Choose the public LAN CA certificate"); if (ca == null) return;
                var fields = Dialog("Trust this CA on this Windows computer", new[] { "sha|SHA-256 verified independently with the host administrator" }); if (fields == null) return;
                if (MessageBox.Show(this, "Trusting a CA affects all users of this computer. Confirm its fingerprint through a separate channel before proceeding.", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
                feedback.Text = await Task.Run(() => Bootstrap.Helper("Trust-LanCa.ps1", new[] { "-CertificatePath", ca, "-ExpectedSha256", Convert.ToString(fields["sha"]), "-ApprovalConfirmed" }));
            }
        }
        private async Task<Dictionary<string, object>> Invoke(string mode, Dictionary<string, object> request, string approval)
        {
            var command = new Dictionary<string, object> { { "mode", mode }, { "request", request } };
            if (approval != null) command["approval"] = approval;
            return await Bootstrap.Invoke(json.Serialize(command), delegate(string phase) {
                if (!IsDisposed) BeginInvoke((Action)delegate { feedback.AppendText("\r\n" + phase); });
            });
        }
        private string PickFile(string title)
        {
            using (var d = new OpenFileDialog { Title = title, CheckFileExists = true, Multiselect = false })
                return d.ShowDialog(this) == DialogResult.OK ? d.FileName : null;
        }
        private Dictionary<string, object> Dialog(string title, string[] fields, Dictionary<string, object> defaults = null)
        {
            using (var form = new Form { Text = title, Width = 760, Height = Math.Min(700, 150 + fields.Length * 68), StartPosition = FormStartPosition.CenterParent, AutoScaleMode = AutoScaleMode.Dpi }) {
                var content = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(12) };
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 45, FlowDirection = FlowDirection.RightToLeft };
                var ok = new Button { Text = "Review", DialogResult = DialogResult.OK, AutoSize = true };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
                buttons.Controls.Add(ok); buttons.Controls.Add(cancel); form.Controls.Add(content); form.Controls.Add(buttons);
                var inputs = new Dictionary<string, TextBox>();
                for (int i = 0; i < fields.Length; i++) {
                    string[] field = fields[i].Split('|');
                    content.Controls.Add(new Label { Text = field[1], Top = 12 + i * 68, Left = 12, Width = 660, Height = 20 });
                    var input = new TextBox { Top = 35 + i * 68, Left = 12, Width = 660, AccessibleName = field[1] };
                    if (field[0].EndsWith("password", StringComparison.OrdinalIgnoreCase)) input.UseSystemPasswordChar = true;
                    if (field[0] == "databasePort") input.Text = "55432";
                    if (field[0] == "backupDailyAt") input.Text = "03:00";
                    object suggestion;
                    if (defaults != null && defaults.TryGetValue(field[0], out suggestion)) input.Text = Convert.ToString(suggestion);
                    Dictionary<string, string> saved; string previous;
                    if (!input.UseSystemPasswordChar && drafts.TryGetValue(title, out saved) && saved.TryGetValue(field[0], out previous)) input.Text = previous;
                    content.Controls.Add(input); inputs.Add(field[0], input);
                }
                form.AcceptButton = ok; form.CancelButton = cancel;
                var result = form.ShowDialog(this);
                drafts[title] = inputs.Where(p => !p.Value.UseSystemPasswordChar).ToDictionary(p => p.Key, p => p.Value.Text);
                if (result != DialogResult.OK) return null;
                return inputs.ToDictionary(p => p.Key, p => (object)(p.Value.UseSystemPasswordChar ? p.Value.Text : p.Value.Text.Trim()));
            }
        }
        private static string Describe(object value)
        {
            var d = value as Dictionary<string, object>;
            return d == null ? Convert.ToString(value) : String.Join("\r\n", d.Select(p => p.Key + ": " + Describe(p.Value)));
        }
    }
    // Suggestions only: no directory creation, port binding, DNS or policy changes.
    internal static class SetupCandidates
    {
        internal static bool Private(IPAddress ip)
        {
            byte[] b = ip.GetAddressBytes();
            return ip.AddressFamily == AddressFamily.InterNetwork &&
                (b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168));
        }
        internal static string Subnet(IPAddress ip, IPAddress mask)
        {
            byte[] b = ip.GetAddressBytes(), m = mask.GetAddressBytes();
            if (b.Length != 4 || m.Length != 4) throw new InvalidOperationException();
            int prefix = 0; bool zero = false;
            for (int i = 0; i < 4; i++) for (int bit = 7; bit >= 0; bit--) {
                bool one = (m[i] & (1 << bit)) != 0;
                if (one && zero) throw new InvalidOperationException();
                if (one) prefix++; else zero = true;
            }
            for (int i = 0; i < 4; i++) b[i] &= m[i];
            // Never suggest a subnet extending outside private address space.
            if (!Private(new IPAddress(b)) || prefix < (b[0] == 10 ? 8 : b[0] == 172 ? 12 : 16)) throw new InvalidOperationException();
            return new IPAddress(b) + "/" + prefix;
        }
        internal static Dictionary<string, object> Detect()
        {
            var result = new Dictionary<string, object>();
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "GST Billing");
            if (!Directory.Exists(folder) && !File.Exists(folder)) result["root"] = folder;
            var properties = IPGlobalProperties.GetIPGlobalProperties();
            var ports = new HashSet<int>(properties.GetActiveTcpListeners().Select(p => p.Port)
                .Concat(properties.GetActiveTcpConnections().Select(p => p.LocalEndPoint.Port)));
            int db = Enumerable.Range(55432, 100).FirstOrDefault(p => !ports.Contains(p));
            if (db != 0) result["databasePort"] = db;
            var addresses = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses).Where(u => Private(u.Address)).ToArray();
            // Multiple interfaces (including VPNs) require an explicit operator choice.
            int https = Enumerable.Range(3443, 100).FirstOrDefault(p => !ports.Contains(p));
            if (addresses.Length == 1 && https != 0) {
                result["origin"] = "https://" + addresses[0].Address + ":" + https;
                try { result["privateSubnet"] = Subnet(addresses[0].Address, addresses[0].IPv4Mask); } catch (InvalidOperationException) { }
            }
            result["backupDailyAt"] = "03:00";
            return result;
        }
    }
}
