using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

public class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _contextMenu;
    private readonly ToolStripMenuItem _itemStatus;
    private readonly AppConfig _config;
    private readonly SyncEngine _syncEngine;
    private System.Threading.Timer? _updateTimer;
    private SettingsForm? _settingsForm;

    public TrayApplicationContext(AppConfig config, SyncEngine syncEngine, bool openSettingsOnLaunch, bool showUpdatedNotice = false)
    {
        _config = config;
        _syncEngine = syncEngine;

        // Create Custom Dark Icon
        Icon appIcon = GenerateTrayIcon();

        // Build Context Menu
        _contextMenu = new ContextMenuStrip
        {
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(248, 250, 252),
            ShowImageMargin = false,
            Font = new Font("Segoe UI", 9f)
        };

        var itemTitle = new ToolStripMenuItem("Blackboarder Deadlines Widget")
        {
            Enabled = false,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248)
        };
        _contextMenu.Items.Add(itemTitle);

        _itemStatus = new ToolStripMenuItem("Status: Initializing...")
        {
            Enabled = false,
            ForeColor = Color.FromArgb(148, 163, 184)
        };
        _contextMenu.Items.Add(_itemStatus);

        _contextMenu.Items.Add(new ToolStripSeparator());

        var itemSyncNow = new ToolStripMenuItem("Sync Now", null, async (s, e) => await OnSyncNowClicked());
        _contextMenu.Items.Add(itemSyncNow);

        var itemSettings = new ToolStripMenuItem("Settings & Live Preview...", null, (s, e) => ShowSettings());
        _contextMenu.Items.Add(itemSettings);

        var itemUpdate = new ToolStripMenuItem($"Check for Updates (v{SelfUpdater.CurrentVersionString})", null, async (s, e) => await OnCheckUpdatesClicked());
        _contextMenu.Items.Add(itemUpdate);

        var itemOpenWeb = new ToolStripMenuItem("Open Blackboarder Web Companion", null, (s, e) => OpenWebCompanion());
        _contextMenu.Items.Add(itemOpenWeb);

        var itemRestore = new ToolStripMenuItem("Restore Original Wallpaper", null, async (s, e) => await OnRestoreClicked());
        _contextMenu.Items.Add(itemRestore);

        _contextMenu.Items.Add(new ToolStripSeparator());

        var itemExit = new ToolStripMenuItem("Exit", null, (s, e) => ExitApplication());
        _contextMenu.Items.Add(itemExit);

        // Build NotifyIcon
        _trayIcon = new NotifyIcon
        {
            Icon = appIcon,
            ContextMenuStrip = _contextMenu,
            Text = "Blackboarder Widget (Active)",
            Visible = true
        };

        _trayIcon.DoubleClick += (s, e) => ShowSettings();

        // Subscribe to SyncEngine updates
        _syncEngine.SyncCompleted += OnSyncCompleted;
        _syncEngine.Start();

        try
        {
            string logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Blackboarder", "startup.log");
            File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss.fff}] TrayApplicationContext initialized. openSettingsOnLaunch={openSettingsOnLaunch}{Environment.NewLine}");
        }
        catch { }

        if (openSettingsOnLaunch)
        {
            ShowSettings();
        }

        if (showUpdatedNotice)
        {
            try
            {
                _trayIcon.ShowBalloonTip(
                    3500,
                    "Blackboarder Widget Updated",
                    $"Now running v{SelfUpdater.CurrentVersionString}.",
                    ToolTipIcon.Info
                );
            }
            catch { }
        }

        // Background GitHub self-update check (12s after boot, then every 3 hours)
        _updateTimer = new System.Threading.Timer(
            _ => _ = Task.Run(async () => await BackgroundAutoUpdateCheckAsync()),
            null,
            TimeSpan.FromSeconds(12),
            TimeSpan.FromHours(3)
        );
    }

    private Icon GenerateTrayIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(Color.FromArgb(15, 23, 42)); // #0F172A
            g.FillEllipse(brush, 1, 1, 30, 30);

            using var pen = new Pen(Color.FromArgb(56, 189, 248), 2.5f);
            g.DrawEllipse(pen, 2, 2, 28, 28);

            // Inner accent dot / square
            using var fill = new SolidBrush(Color.FromArgb(56, 189, 248));
            g.FillRectangle(fill, 10, 10, 12, 12);
        }
        IntPtr hIcon = bmp.GetHicon();
        return Icon.FromHandle(hIcon);
    }

    private void OnSyncCompleted(SyncResult res)
    {
        try
        {
            if (_contextMenu.IsDisposed) return;
            if (_contextMenu.InvokeRequired)
            {
                _contextMenu.BeginInvoke(() => OnSyncCompleted(res));
                return;
            }

            string time = DateTime.Now.ToString("h:mm tt");
            if (res.Success)
            {
                _itemStatus.Text = $"Active: {res.ActiveCount} deadlines • {time}";
                _itemStatus.ForeColor = Color.FromArgb(74, 222, 128); // Green
                _trayIcon.Text = $"Blackboarder Widget ({res.ActiveCount} deadlines)";
            }
            else
            {
                _itemStatus.Text = $"Sync paused (offline) • {time}";
                _itemStatus.ForeColor = Color.FromArgb(251, 191, 36); // Yellow
            }
        }
        catch { }
    }

    private async Task OnSyncNowClicked()
    {
        try
        {
            _itemStatus.Text = "Syncing with Blackboarder...";
            _itemStatus.ForeColor = Color.FromArgb(56, 189, 248);
            var res = await _syncEngine.UpdateWidgetAsync(force: true);
            OnSyncCompleted(res);
        }
        catch { }
    }

    public void ShowSettings()
    {
        if (_settingsForm == null || _settingsForm.IsDisposed)
        {
            _settingsForm = new SettingsForm(_config, _syncEngine);
            _settingsForm.FormClosed += (s, e) => _settingsForm = null;
            _settingsForm.Show();
        }
        else
        {
            if (_settingsForm.WindowState == FormWindowState.Minimized)
            {
                _settingsForm.WindowState = FormWindowState.Normal;
            }
            _settingsForm.BringToFront();
            _settingsForm.Activate();
        }
    }

    private void OpenWebCompanion()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "https://blackboarder.pages.dev/companion/",
                UseShellExecute = true
            });
        }
        catch { }
    }

    private async Task OnRestoreClicked()
    {
        var res = MessageBox.Show(
            "Restore original wallpaper on your Lock Screen and Desktop?",
            "Restore Wallpaper",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question
        );
        if (res == DialogResult.Yes)
        {
            await WallpaperManager.RestoreOriginalAsync();
            MessageBox.Show("Original wallpaper restored successfully!", "Done", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private async Task BackgroundAutoUpdateCheckAsync()
    {
        try
        {
            if (!_config.AutoUpdate) return;
            if (!SelfUpdater.CanSelfUpdate(out _)) return;

            var release = await SelfUpdater.CheckForUpdateAsync().ConfigureAwait(false);
            if (release == null) return;

            // Avoid interrupting while the user has the Settings window open
            if (_settingsForm != null && !_settingsForm.IsDisposed) return;

            var applied = await SelfUpdater.DownloadAndApplyUpdateAsync(
                release,
                relaunchMinimized: true,
                Program.ReleaseInstanceMutex
            ).ConfigureAwait(false);

            if (applied.Relaunching && !_contextMenu.IsDisposed)
            {
                _contextMenu.BeginInvoke(ExitApplication);
            }
        }
        catch { }
    }

    private async Task OnCheckUpdatesClicked()
    {
        try
        {
            var release = await SelfUpdater.CheckForUpdateAsync();
            if (release == null)
            {
                MessageBox.Show(
                    $"You're up to date!\n\nInstalled version: v{SelfUpdater.CurrentVersionString}",
                    "Blackboarder Widget",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            if (!SelfUpdater.CanSelfUpdate(out string reason))
            {
                MessageBox.Show(
                    $"Blackboarder {release.TagName} is available on GitHub (installed: v{SelfUpdater.CurrentVersionString}).\n\nAuto-replace is disabled here: {reason}",
                    "Update Available",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            var choice = MessageBox.Show(
                $"A new version ({release.TagName}) is available on GitHub!\nInstalled: v{SelfUpdater.CurrentVersionString}\n\nDownload and restart now?",
                "Update Available",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (choice != DialogResult.Yes) return;

            _itemStatus.Text = $"Downloading {release.TagName}...";
            _itemStatus.ForeColor = Color.FromArgb(56, 189, 248);

            var applied = await SelfUpdater.DownloadAndApplyUpdateAsync(
                release,
                relaunchMinimized: false,
                Program.ReleaseInstanceMutex
            );

            if (applied.Relaunching)
            {
                ExitApplication();
            }
            else
            {
                MessageBox.Show(applied.Message, "Update Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Could not check for updates: {ex.Message}", "Update Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ExitApplication()
    {
        _updateTimer?.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _syncEngine.Dispose();
        Application.Exit();
    }
}
