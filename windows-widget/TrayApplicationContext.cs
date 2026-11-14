using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

internal sealed class SwissGridColorTable : ProfessionalColorTable
{
    private static readonly Color Bg = Color.FromArgb(18, 18, 21);          // #121215
    private static readonly Color SurfaceHover = Color.FromArgb(36, 36, 43); // #24242B
    private static readonly Color Border = Color.FromArgb(44, 44, 54);      // #2C2C36

    public override Color MenuBorder => Border;
    public override Color MenuItemBorder => Border;
    public override Color MenuItemSelected => SurfaceHover;
    public override Color MenuItemSelectedGradientBegin => SurfaceHover;
    public override Color MenuItemSelectedGradientEnd => SurfaceHover;
    public override Color MenuItemPressedGradientBegin => SurfaceHover;
    public override Color MenuItemPressedGradientEnd => SurfaceHover;
    public override Color ToolStripDropDownBackground => Bg;
    public override Color ImageMarginGradientBegin => Bg;
    public override Color ImageMarginGradientMiddle => Bg;
    public override Color ImageMarginGradientEnd => Bg;
    public override Color SeparatorDark => Border;
    public override Color SeparatorLight => Border;
}

internal sealed class SwissGridToolStripRenderer : ToolStripProfessionalRenderer
{
    public SwissGridToolStripRenderer() : base(new SwissGridColorTable())
    {
        RoundedEdges = false;
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        using var pen = new Pen(Color.FromArgb(44, 44, 54), 1);
        int y = e.Item.Height / 2;
        e.Graphics.DrawLine(pen, 8, y, e.Item.Width - 8, y);
    }
}

public class TrayApplicationContext : ApplicationContext
{
    private static readonly Color TextMain = Color.FromArgb(244, 244, 246);  // #F4F4F6
    private static readonly Color TextMuted = Color.FromArgb(161, 161, 170); // #A1A1AA

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

        // Create Custom Square Two-Tone Icon
        Icon appIcon = CreateAppIcon();
        string uiFont = LiquidGlassRenderer.ResolvePreferredFont("Inter", "Segoe UI");

        // Build Swiss Grid Context Menu (two-tone, 0px corners)
        _contextMenu = new ContextMenuStrip
        {
            BackColor = Color.FromArgb(18, 18, 21), // #121215
            ForeColor = TextMain,
            ShowImageMargin = false,
            Font = new Font(uiFont, 9f),
            Renderer = new SwissGridToolStripRenderer(),
            Padding = new Padding(2)
        };

        var itemTitle = new ToolStripMenuItem("BLACKBOARDER // WIDGET")
        {
            Enabled = false,
            Font = new Font(uiFont, 8.5f, FontStyle.Bold),
            ForeColor = TextMain
        };
        _contextMenu.Items.Add(itemTitle);

        _itemStatus = new ToolStripMenuItem("Status: Initializing...")
        {
            Enabled = false,
            ForeColor = TextMuted
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

    public static Icon CreateAppIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.None;
            // 0px square dark monochrome background (#121215) with crisp #F4F4F6 frame
            using var bgBrush = new SolidBrush(Color.FromArgb(18, 18, 21));
            g.FillRectangle(bgBrush, 0, 0, 32, 32);

            using var outerPen = new Pen(Color.FromArgb(244, 244, 246), 1.5f);
            g.DrawRectangle(outerPen, 1, 1, 29, 29);

            // Inner Swiss Grid calendar block
            using var cardBrush = new SolidBrush(Color.FromArgb(244, 244, 246));
            g.FillRectangle(cardBrush, 6, 7, 20, 19);

            // Top calendar bar + minimal checklist bars
            using var darkBrush = new SolidBrush(Color.FromArgb(18, 18, 21));
            g.FillRectangle(darkBrush, 6, 7, 20, 5);
            g.FillRectangle(darkBrush, 9, 15, 14, 2);
            g.FillRectangle(darkBrush, 9, 19, 10, 2);
            g.FillRectangle(darkBrush, 9, 23, 12, 2);
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
                _itemStatus.ForeColor = TextMain;
                _trayIcon.Text = $"Blackboarder Widget ({res.ActiveCount} deadlines)";
            }
            else
            {
                _itemStatus.Text = $"Sync paused (offline) • {time}";
                _itemStatus.ForeColor = TextMuted;
            }
        }
        catch { }
    }

    private async Task OnSyncNowClicked()
    {
        try
        {
            _itemStatus.Text = "Syncing with Blackboarder...";
            _itemStatus.ForeColor = TextMain;
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
            _itemStatus.ForeColor = TextMain;

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
