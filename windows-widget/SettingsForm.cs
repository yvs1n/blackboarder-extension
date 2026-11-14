using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

public class SettingsForm : Form
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private readonly AppConfig _config;
    private readonly SyncEngine _syncEngine;

    // UI Controls
    private TextBox _txtSyncKey = null!;
    private Button _btnTestConnection = null!;
    private Label _lblConnectionStatus = null!;

    private CheckBox _chkLockScreen = null!;
    private CheckBox _chkDesktop = null!;

    private ComboBox _cboPosition = null!;
    private ComboBox _cboMaxTasks = null!;
    private TrackBar _trackBlur = null!;
    private Label _lblBlurValue = null!;

    private RadioButton _rbDefaultWallpaper = null!;
    private RadioButton _rbCustomWallpaper = null!;
    private TextBox _txtCustomWallpaper = null!;
    private Button _btnBrowseWallpaper = null!;

    private CheckBox _chkStartup = null!;
    private ComboBox _cboInterval = null!;

    private Button _btnSaveApply = null!;
    private Button _btnRestore = null!;

    private PictureBox _previewBox = null!;
    private System.Windows.Forms.Timer _previewDebounceTimer = null!;

    private List<TaskItem> _cachedTasks = new();
    private List<CourseItem> _cachedCourses = new();
    private StudentProfile? _cachedProfile;
    private WidgetStyleConfig? _cachedWidgetConfig;
    private bool _cachedIsOffline;
    private bool _hasFetchedPreviewData;
    private int _previewRenderVersion;

    public SettingsForm(AppConfig config, SyncEngine syncEngine)
    {
        _config = config;
        _syncEngine = syncEngine;

        InitializeComponent();
        ApplyDarkTitleBar();
        LoadValues();
        TriggerPreviewUpdate();
    }

    private void ApplyDarkTitleBar()
    {
        try
        {
            int darkMode = 1;
            DwmSetWindowAttribute(this.Handle, 20, ref darkMode, sizeof(int));
        }
        catch { }
    }

    private void InitializeComponent()
    {
        this.Text = "Blackboarder - Lock Screen & Desktop Widget Settings";
        this.Size = new Size(1060, 680);
        this.MinimumSize = new Size(980, 620);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = Color.FromArgb(15, 23, 42); // #0F172A
        this.ForeColor = Color.FromArgb(248, 250, 252);
        this.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);

        // Main Layout: Split into Left Settings Panel and Right Preview Panel
        var mainTable = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(16)
        };
        mainTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48f));
        mainTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52f));
        this.Controls.Add(mainTable);

        // --- LEFT PANEL (Settings Controls) ---
        var leftScroll = new Panel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            Padding = new Padding(0, 0, 12, 0)
        };
        mainTable.Controls.Add(leftScroll, 0, 0);

        var leftStack = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Width = 470
        };
        leftScroll.Controls.Add(leftStack);

        // 1. Connection Group
        var grpConnection = CreateCardGroup("ACCOUNT & SYNC PAIRING", 120);
        var lblSyncKey = new Label { Text = "Pairing Sync Key:", Location = new Point(14, 28), AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
        _txtSyncKey = new TextBox
        {
            Location = new Point(16, 50),
            Width = 320,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Segoe UI", 9.5f)
        };
        _txtSyncKey.TextChanged += (s, e) => { TriggerPreviewUpdate(); };

        _btnTestConnection = CreateButton("Test Connection", new Point(344, 48), 110, 28, isAccent: false);
        _btnTestConnection.Click += async (s, e) => await OnTestConnectionClicked();

        _lblConnectionStatus = new Label
        {
            Text = "Enter your sync key from Blackboarder Settings > Sync.",
            Location = new Point(16, 84),
            AutoSize = true,
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8.5f)
        };
        grpConnection.Controls.AddRange(new Control[] { lblSyncKey, _txtSyncKey, _btnTestConnection, _lblConnectionStatus });
        leftStack.Controls.Add(grpConnection);

        // 2. Display Targets Group
        var grpTargets = CreateCardGroup("DISPLAY TARGETS", 95);
        _chkLockScreen = new CheckBox
        {
            Text = "Update Windows Lock Screen",
            Location = new Point(16, 30),
            AutoSize = true,
            Checked = true,
            ForeColor = Color.White
        };
        _chkLockScreen.CheckedChanged += (s, e) => TriggerPreviewUpdate();

        _chkDesktop = new CheckBox
        {
            Text = "Update Windows Desktop (Home Screen)",
            Location = new Point(16, 58),
            AutoSize = true,
            Checked = false,
            ForeColor = Color.White
        };
        _chkDesktop.CheckedChanged += (s, e) => TriggerPreviewUpdate();

        grpTargets.Controls.AddRange(new Control[] { _chkLockScreen, _chkDesktop });
        leftStack.Controls.Add(grpTargets);

        // 3. Card Customization Group
        var grpStyle = CreateCardGroup("WIDGET CUSTOMIZATION", 155);

        var lblPos = new Label { Text = "Screen Position:", Location = new Point(14, 30), AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
        _cboPosition = new ComboBox
        {
            Location = new Point(16, 52),
            Width = 200,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        _cboPosition.Items.AddRange(new object[] { "BottomCenter", "BottomRight", "BottomLeft", "TopCenter", "TopRight", "TopLeft" });
        _cboPosition.SelectedIndexChanged += (s, e) => TriggerPreviewUpdate();

        var lblTasks = new Label { Text = "Max Deadlines:", Location = new Point(236, 30), AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
        _cboMaxTasks = new ComboBox
        {
            Location = new Point(238, 52),
            Width = 200,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        _cboMaxTasks.Items.AddRange(new object[] { "1 deadline", "2 deadlines", "3 deadlines", "4 deadlines", "5 deadlines", "6 deadlines" });
        _cboMaxTasks.SelectedIndexChanged += (s, e) => TriggerPreviewUpdate();

        var lblBlur = new Label { Text = "Glass Bokeh Blur:", Location = new Point(14, 90), AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
        _lblBlurValue = new Label { Text = "24px", Location = new Point(135, 90), AutoSize = true, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
        _trackBlur = new TrackBar
        {
            Location = new Point(16, 112),
            Width = 422,
            Minimum = 8,
            Maximum = 40,
            Value = 24,
            TickStyle = TickStyle.None
        };
        _trackBlur.ValueChanged += (s, e) =>
        {
            _lblBlurValue.Text = $"{_trackBlur.Value}px";
            TriggerPreviewUpdate();
        };

        grpStyle.Controls.AddRange(new Control[] { lblPos, _cboPosition, lblTasks, _cboMaxTasks, lblBlur, _lblBlurValue, _trackBlur });
        leftStack.Controls.Add(grpStyle);

        // 4. Wallpaper Source Group
        var grpWallpaper = CreateCardGroup("WALLPAPER SOURCE", 130);
        _rbDefaultWallpaper = new RadioButton
        {
            Text = "Use current Windows Wallpaper (auto-detects changes)",
            Location = new Point(16, 28),
            AutoSize = true,
            Checked = true,
            ForeColor = Color.White
        };
        _rbDefaultWallpaper.CheckedChanged += (s, e) =>
        {
            _txtCustomWallpaper.Enabled = !_rbDefaultWallpaper.Checked;
            _btnBrowseWallpaper.Enabled = !_rbDefaultWallpaper.Checked;
            TriggerPreviewUpdate();
        };

        _rbCustomWallpaper = new RadioButton
        {
            Text = "Use custom image file:",
            Location = new Point(16, 56),
            AutoSize = true,
            ForeColor = Color.White
        };

        _txtCustomWallpaper = new TextBox
        {
            Location = new Point(36, 84),
            Width = 300,
            Enabled = false,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle
        };
        _txtCustomWallpaper.TextChanged += (s, e) => TriggerPreviewUpdate();

        _btnBrowseWallpaper = CreateButton("Browse...", new Point(344, 82), 94, 26, isAccent: false);
        _btnBrowseWallpaper.Enabled = false;
        _btnBrowseWallpaper.Click += (s, e) => OnBrowseWallpaperClicked();

        grpWallpaper.Controls.AddRange(new Control[] { _rbDefaultWallpaper, _rbCustomWallpaper, _txtCustomWallpaper, _btnBrowseWallpaper });
        leftStack.Controls.Add(grpWallpaper);

        // 5. Startup & Frequency Group
        var grpStartup = CreateCardGroup("SYSTEM INTEGRATION", 100);
        _chkStartup = new CheckBox
        {
            Text = "Start automatically when Windows boots (runs in system tray)",
            Location = new Point(16, 28),
            AutoSize = true,
            Checked = true,
            ForeColor = Color.White
        };

        var lblInterval = new Label { Text = "Background sync interval:", Location = new Point(14, 60), AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
        _cboInterval = new ComboBox
        {
            Location = new Point(185, 57),
            Width = 150,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        _cboInterval.Items.AddRange(new object[] { "1 minute", "2 minutes (Recommended)", "5 minutes", "15 minutes" });
        grpStartup.Controls.AddRange(new Control[] { _chkStartup, lblInterval, _cboInterval });
        leftStack.Controls.Add(grpStartup);

        // 6. Action Buttons Bar
        var pnlActions = new Panel
        {
            Width = 460,
            Height = 60,
            Margin = new Padding(0, 10, 0, 0)
        };
        _btnRestore = CreateButton("Restore Original Wallpaper", new Point(0, 10), 200, 38, isAccent: false);
        _btnRestore.Click += async (s, e) => await OnRestoreClicked();

        _btnSaveApply = CreateButton("Save & Apply Now", new Point(220, 10), 230, 38, isAccent: true);
        _btnSaveApply.Click += async (s, e) => await OnSaveApplyClicked();

        pnlActions.Controls.AddRange(new Control[] { _btnRestore, _btnSaveApply });
        leftStack.Controls.Add(pnlActions);

        // --- RIGHT PANEL (Interactive Live Real-Time Preview) ---
        var rightPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(12, 0, 0, 0)
        };
        mainTable.Controls.Add(rightPanel, 1, 0);

        var grpPreview = CreateCardGroup("LIVE REAL-TIME PREVIEW", 580);
        grpPreview.Dock = DockStyle.Fill;
        rightPanel.Controls.Add(grpPreview);

        _previewBox = new PictureBox
        {
            Location = new Point(16, 36),
            Size = new Size(470, 264), // 16:9 ratio
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.FromArgb(10, 15, 26),
            BorderStyle = BorderStyle.None
        };

        var lblPreviewTip = new Label
        {
            Text = "This preview shows the exact rendered glass card and position on your selected wallpaper.",
            Location = new Point(16, 310),
            AutoSize = true,
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8.5f)
        };

        grpPreview.Controls.AddRange(new Control[] { _previewBox, lblPreviewTip });

        // Debounce timer for smooth real-time preview re-rendering
        _previewDebounceTimer = new System.Windows.Forms.Timer { Interval = 120 };
        _previewDebounceTimer.Tick += (s, e) =>
        {
            _previewDebounceTimer.Stop();
            RenderLivePreview();
        };
    }

    private GroupBox CreateCardGroup(string title, int height)
    {
        return new GroupBox
        {
            Text = title,
            Width = 460,
            Height = height,
            ForeColor = Color.FromArgb(148, 163, 184),
            BackColor = Color.FromArgb(30, 41, 59), // #1E293B
            Font = new Font("Segoe UI", 8f, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 14),
            Padding = new Padding(12)
        };
    }

    private Button CreateButton(string text, Point loc, int w, int h, bool isAccent)
    {
        var btn = new Button
        {
            Text = text,
            Location = loc,
            Size = new Size(w, h),
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 9f, isAccent ? FontStyle.Bold : FontStyle.Regular),
            Cursor = Cursors.Hand
        };
        btn.FlatAppearance.BorderSize = 1;

        if (isAccent)
        {
            btn.BackColor = Color.FromArgb(2, 132, 199); // #0284C7
            btn.ForeColor = Color.White;
            btn.FlatAppearance.BorderColor = Color.FromArgb(56, 189, 248);
        }
        else
        {
            btn.BackColor = Color.FromArgb(51, 65, 85); // #334155
            btn.ForeColor = Color.FromArgb(241, 245, 249);
            btn.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
        }

        return btn;
    }

    private void LoadValues()
    {
        _txtSyncKey.Text = _config.SyncKey;
        _chkLockScreen.Checked = _config.SetLockScreen;
        _chkDesktop.Checked = _config.SetDesktop;

        int posIdx = _cboPosition.Items.IndexOf(_config.Position);
        _cboPosition.SelectedIndex = posIdx >= 0 ? posIdx : 0;

        int taskIdx = Math.Clamp(_config.MaxTasks - 1, 0, _cboMaxTasks.Items.Count - 1);
        _cboMaxTasks.SelectedIndex = taskIdx;

        _trackBlur.Value = Math.Clamp(_config.BlurRadius, _trackBlur.Minimum, _trackBlur.Maximum);
        _lblBlurValue.Text = $"{_trackBlur.Value}px";

        if (!string.IsNullOrWhiteSpace(_config.WallpaperPath) && File.Exists(_config.WallpaperPath))
        {
            _rbCustomWallpaper.Checked = true;
            _txtCustomWallpaper.Text = _config.WallpaperPath;
            _txtCustomWallpaper.Enabled = true;
            _btnBrowseWallpaper.Enabled = true;
        }
        else
        {
            _rbDefaultWallpaper.Checked = true;
        }

        _chkStartup.Checked = StartupManager.IsStartupEnabled();

        _cboInterval.SelectedIndex = _config.PollIntervalMinutes switch
        {
            1 => 0,
            2 => 1,
            5 => 2,
            15 => 3,
            _ => 1
        };
    }

    private void TriggerPreviewUpdate()
    {
        _previewDebounceTimer.Stop();
        _previewDebounceTimer.Start();
    }

    private void RenderLivePreview()
    {
        _previewDebounceTimer.Stop();
        _ = RenderLivePreviewAsync();
    }

    private async Task RenderLivePreviewAsync()
    {
        int version = ++_previewRenderVersion;
        try
        {
            if (this.IsDisposed || _previewBox.IsDisposed) return;

            int boxW = _previewBox.Width;
            int boxH = _previewBox.Height;
            if (boxW < 10 || boxH < 10) return;

            var previewConfig = new AppConfig
            {
                SyncKey = _txtSyncKey.Text.Trim(),
                Position = _cboPosition.SelectedItem?.ToString() ?? "BottomCenter",
                MaxTasks = Math.Max(1, _cboMaxTasks.SelectedIndex + 1),
                BlurRadius = _trackBlur.Value,
                WallpaperPath = _rbCustomWallpaper.Checked ? _txtCustomWallpaper.Text.Trim() : "",
                ShowLocation = true
            };

            if (!_hasFetchedPreviewData)
            {
                var fetched = await SyncEngine.FetchTasksAsync(previewConfig.SyncKey);
                if (this.IsDisposed || version != _previewRenderVersion) return;
                _cachedTasks = fetched.Tasks;
                _cachedCourses = fetched.Courses;
                _cachedProfile = fetched.Profile;
                _cachedWidgetConfig = fetched.WidgetConfig;
                _cachedIsOffline = fetched.IsOffline;
                _hasFetchedPreviewData = true;
            }

            string wp = previewConfig.WallpaperPath;
            if (string.IsNullOrWhiteSpace(wp) || !File.Exists(wp))
            {
                wp = WallpaperManager.GetCurrentDesktopWallpaper();
            }

            var tasksSnapshot = new List<TaskItem>(_cachedTasks);
            var coursesSnapshot = new List<CourseItem>(_cachedCourses);
            var profileSnapshot = _cachedProfile;
            var styleSnapshot = _cachedWidgetConfig;
            bool offlineSnapshot = _cachedIsOffline;

            var scaled = await Task.Run(() =>
            {
                using var fullBitmap = LiquidGlassRenderer.RenderWidget(
                    wp,
                    tasksSnapshot,
                    coursesSnapshot,
                    previewConfig,
                    1920,
                    1080,
                    offlineSnapshot,
                    profileSnapshot,
                    styleSnapshot
                );
                return new Bitmap(fullBitmap, boxW, boxH);
            });

            if (this.IsDisposed || _previewBox.IsDisposed || version != _previewRenderVersion)
            {
                scaled.Dispose();
                return;
            }

            var old = _previewBox.Image;
            _previewBox.Image = scaled;
            old?.Dispose();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Preview render error: {ex.Message}");
        }
    }

    private async Task OnTestConnectionClicked()
    {
        string key = _txtSyncKey.Text.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            _lblConnectionStatus.Text = "Please enter a valid sync key first.";
            _lblConnectionStatus.ForeColor = Color.FromArgb(248, 113, 113);
            return;
        }

        _lblConnectionStatus.Text = "Connecting to Blackboarder...";
        _lblConnectionStatus.ForeColor = Color.FromArgb(56, 189, 248);
        _btnTestConnection.Enabled = false;

        try
        {
            var fetched = await SyncEngine.FetchTasksAsync(key);
            _cachedTasks = fetched.Tasks;
            _cachedCourses = fetched.Courses;
            _cachedProfile = fetched.Profile;
            _cachedWidgetConfig = fetched.WidgetConfig;
            _cachedIsOffline = fetched.IsOffline;
            _hasFetchedPreviewData = true;
            int taskCount = _cachedTasks.Count;
            int courseCount = _cachedCourses.Count;

            if (taskCount > 0)
            {
                _lblConnectionStatus.Text = $"Connected! Found {taskCount} deadlines across {courseCount} courses.";
                _lblConnectionStatus.ForeColor = Color.FromArgb(74, 222, 128); // Green
            }
            else if (!fetched.IsOffline)
            {
                _lblConnectionStatus.Text = "Connected! All caught up (no pending deadlines).";
                _lblConnectionStatus.ForeColor = Color.FromArgb(74, 222, 128);
            }
            else
            {
                _lblConnectionStatus.Text = "Could not reach server. Using offline cache.";
                _lblConnectionStatus.ForeColor = Color.FromArgb(251, 191, 36); // Yellow
            }

            TriggerPreviewUpdate();
        }
        catch (Exception ex)
        {
            _lblConnectionStatus.Text = $"Connection failed: {ex.Message}";
            _lblConnectionStatus.ForeColor = Color.FromArgb(248, 113, 113);
        }
        finally
        {
            _btnTestConnection.Enabled = true;
        }
    }

    private void OnBrowseWallpaperClicked()
    {
        using var ofd = new OpenFileDialog
        {
            Title = "Select Custom Wallpaper Image",
            Filter = "Images (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp|All Files (*.*)|*.*"
        };
        if (ofd.ShowDialog() == DialogResult.OK)
        {
            _txtCustomWallpaper.Text = ofd.FileName;
            TriggerPreviewUpdate();
        }
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

    private async Task OnSaveApplyClicked()
    {
        _btnSaveApply.Enabled = false;
        _btnSaveApply.Text = "Applying...";

        try
        {
            _config.SyncKey = _txtSyncKey.Text.Trim();
            _config.SetLockScreen = _chkLockScreen.Checked;
            _config.SetDesktop = _chkDesktop.Checked;
            _config.Position = _cboPosition.SelectedItem?.ToString() ?? "BottomCenter";
            _config.MaxTasks = _cboMaxTasks.SelectedIndex + 1;
            _config.BlurRadius = _trackBlur.Value;
            _config.WallpaperPath = _rbCustomWallpaper.Checked ? _txtCustomWallpaper.Text.Trim() : "";
            _config.PollIntervalMinutes = _cboInterval.SelectedIndex switch
            {
                0 => 1,
                1 => 2,
                2 => 5,
                3 => 15,
                _ => 2
            };

            StartupManager.SetStartupEnabled(_chkStartup.Checked);
            _config.StartWithWindows = _chkStartup.Checked;

            _config.Save();
            _syncEngine.UpdateConfig(_config);

            var syncRes = await _syncEngine.UpdateWidgetAsync(force: true);

            MessageBox.Show(
                $"Settings saved and widget applied successfully!\n\nLock Screen: {(_config.SetLockScreen ? "Active" : "Disabled")}\nDesktop: {(_config.SetDesktop ? "Active" : "Disabled")}\nActive Deadlines: {syncRes.ActiveCount}",
                "Blackboarder Widget",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );

            this.Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error applying widget: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _btnSaveApply.Enabled = true;
            _btnSaveApply.Text = "Save & Apply Now";
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _previewDebounceTimer?.Dispose();
            _previewBox?.Image?.Dispose();
        }
        base.Dispose(disposing);
    }
}
