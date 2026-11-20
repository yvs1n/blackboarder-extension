using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

internal sealed class BufferedCardPanel : Panel
{
    public BufferedCardPanel()
    {
        this.DoubleBuffered = true;
        this.ResizeRedraw = true;
        this.SetStyle(
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.UserPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true
        );
    }
}

public class SettingsForm : Form
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private readonly AppConfig _config;
    private readonly SyncEngine _syncEngine;

    // Layout Containers for Responsive Resizing
    private Panel _leftScroll = null!;
    private FlowLayoutPanel _leftStack = null!;
    private Panel _grpConnection = null!;
    private Panel _grpTargets = null!;
    private Panel _grpStyle = null!;
    private Panel _grpWallpaper = null!;
    private Panel _grpStartup = null!;
    private Panel _pnlActions = null!;
    private Label _lblTasksHeader = null!;
    private Panel _grpPreview = null!;
    private Panel _previewFrame = null!;
    private Label _lblPreviewTip = null!;

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
    private TrackBar _trackTransparency = null!;
    private Label _lblTransparencyValue = null!;

    private RadioButton _rbDefaultWallpaper = null!;
    private RadioButton _rbCustomWallpaper = null!;
    private TextBox _txtCustomWallpaper = null!;
    private Button _btnBrowseWallpaper = null!;

    private CheckBox _chkStartup = null!;
    private CheckBox _chkAutoUpdate = null!;
    private ComboBox _cboInterval = null!;
    private Button _btnCheckUpdates = null!;
    private Label _lblVersionInfo = null!;

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

    // Blackboarder Design System (Swiss Grid, two-tone dark tokens from docs/DESIGN_SYSTEM.md)
    private static readonly Color BgColor = Color.FromArgb(18, 18, 21);         // #121215 (--bg)
    private static readonly Color SurfaceColor = Color.FromArgb(26, 26, 31);    // #1A1A1F (--surface)
    private static readonly Color SurfaceHover = Color.FromArgb(36, 36, 43);    // #24242B (--surface-hover)
    private static readonly Color BorderColor = Color.FromArgb(44, 44, 54);     // #2C2C36 (--surface-border)
    private static readonly Color BorderStrong = Color.FromArgb(63, 63, 76);    // #3F3F4C (--surface-border-strong)
    private static readonly Color TextMain = Color.FromArgb(244, 244, 246);     // #F4F4F6 (--text-main / --primary)
    private static readonly Color TextMuted = Color.FromArgb(161, 161, 170);    // #A1A1AA (--text-muted)
    private static readonly Color TextSubtle = Color.FromArgb(113, 113, 122);   // #71717A (--text-subtle)
    private static readonly Color OnAccentColor = Color.FromArgb(18, 18, 21);   // #121215 (--on-accent)

    private readonly string _uiFont = LiquidGlassRenderer.ResolvePreferredFont("Inter", "Segoe UI");
    private readonly string _displayFont = LiquidGlassRenderer.ResolvePreferredFont("Inter Tight", "Segoe UI");
    private Font _fontStatusRegular = null!;
    private Font _fontStatusBold = null!;

    public SettingsForm(AppConfig config, SyncEngine syncEngine)
    {
        _config = config;
        _syncEngine = syncEngine;
        this.DoubleBuffered = true;
        _fontStatusRegular = new Font(_uiFont, 8.25f, FontStyle.Regular);
        _fontStatusBold = new Font(_uiFont, 8.25f, FontStyle.Bold);

        InitializeComponent();
        ApplyDarkTitleBar();
        LoadValues();
        UpdateResponsiveLayout();
        this.Shown += (s, e) =>
        {
            UpdateResponsiveLayout();
            TriggerPreviewUpdate();
        };
    }

    private void ApplyDarkTitleBar()
    {
        try
        {
            int darkMode = 1;
            DwmSetWindowAttribute(this.Handle, 20, ref darkMode, sizeof(int));
            int cornerDoNotRound = 1; // DWMWCP_DONOTROUND (0px Swiss Grid on Win11)
            DwmSetWindowAttribute(this.Handle, 33, ref cornerDoNotRound, sizeof(int));
            int borderRef = 0x00362C2C; // #2C2C36
            DwmSetWindowAttribute(this.Handle, 34, ref borderRef, sizeof(int));
            int captionRef = 0x00151212; // #121215
            DwmSetWindowAttribute(this.Handle, 35, ref captionRef, sizeof(int));
        }
        catch { }
    }

    private void InitializeComponent()
    {
        this.Text = "Blackboarder - Windows Widget Settings";
        this.Icon = TrayApplicationContext.CreateAppIcon();
        this.Size = new Size(1080, 760);
        this.MinimumSize = new Size(880, 580);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = BgColor;
        this.ForeColor = TextMain;
        this.Font = new Font(_uiFont, 9.25f, FontStyle.Regular);

        // Top Swiss Grid Header Strip (0px square, hairline 1px separation)
        var topBar = new BufferedCardPanel
        {
            Dock = DockStyle.Top,
            Height = 46,
            BackColor = SurfaceColor,
            Padding = new Padding(16, 0, 16, 0)
        };
        topBar.Paint += (s, e) =>
        {
            using var pen = new Pen(BorderColor, 1);
            e.Graphics.DrawLine(pen, 0, topBar.Height - 1, topBar.Width, topBar.Height - 1);
        };

        var lblBrand = new Label
        {
            Text = "BLACKBOARDER",
            Location = new Point(16, 13),
            AutoSize = true,
            ForeColor = TextMain,
            Font = new Font(_displayFont, 11f, FontStyle.Bold)
        };
        var lblSubtitle = new Label
        {
            Text = "WINDOWS WIDGET // SWISS GRID",
            Location = new Point(142, 16),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = new Font(_uiFont, 8.25f, FontStyle.Bold)
        };
        var lblVersionTag = new Label
        {
            Text = $"v{SelfUpdater.CurrentVersionString}",
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
            Location = new Point(topBar.Width - 86, 11),
            Size = new Size(70, 24),
            TextAlign = ContentAlignment.MiddleCenter,
            BackColor = BgColor,
            ForeColor = TextMain,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font(_uiFont, 8.25f, FontStyle.Bold)
        };
        topBar.Controls.AddRange(new Control[] { lblBrand, lblSubtitle, lblVersionTag });

        // Main Layout: Split into Left Settings Panel and Right Preview Panel
        var mainTable = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(16),
            BackColor = BgColor
        };
        mainTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48f));
        mainTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52f));
        this.Controls.Add(mainTable);
        this.Controls.Add(topBar);

        // --- LEFT PANEL (Settings Controls) ---
        _leftScroll = new Panel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            Padding = new Padding(0, 0, 8, 0),
            BackColor = BgColor
        };
        mainTable.Controls.Add(_leftScroll, 0, 0);

        _leftStack = new FlowLayoutPanel
        {
            Location = new Point(0, 0),
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Width = 460,
            BackColor = BgColor
        };
        _leftScroll.Controls.Add(_leftStack);

        // 1. Connection Group
        _grpConnection = CreateCardGroup("ACCOUNT & SYNC PAIRING", 126);
        var lblSyncKey = new Label { Text = "Pairing Sync Key:", Location = new Point(14, 36), AutoSize = true, ForeColor = TextMuted };
        _txtSyncKey = CreateBorderedTextBox(_grpConnection, 14, 58, 314);
        _txtSyncKey.TextChanged += (s, e) => { _hasFetchedPreviewData = false; TriggerPreviewUpdate(); };

        _btnTestConnection = CreateButton("Test Connection", new Point(336, 56), 110, 28, isAccent: false);
        _btnTestConnection.Click += async (s, e) => await OnTestConnectionClicked();

        _lblConnectionStatus = new Label
        {
            Text = "Enter your sync key from Blackboarder Settings > Sync.",
            Location = new Point(14, 92),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = _fontStatusRegular
        };
        _grpConnection.Controls.AddRange(new Control[] { lblSyncKey, _btnTestConnection, _lblConnectionStatus });
        _leftStack.Controls.Add(_grpConnection);

        // 2. Display Targets Group
        _grpTargets = CreateCardGroup("DISPLAY TARGETS", 98);
        _chkLockScreen = new CheckBox
        {
            Text = "Update Windows Lock Screen",
            Location = new Point(14, 38),
            AutoSize = true,
            Checked = true,
            ForeColor = TextMain
        };
        _chkLockScreen.CheckedChanged += (s, e) => TriggerPreviewUpdate();

        _chkDesktop = new CheckBox
        {
            Text = "Update Windows Desktop (Home Screen)",
            Location = new Point(14, 65),
            AutoSize = true,
            Checked = false,
            ForeColor = TextMain
        };
        _chkDesktop.CheckedChanged += (s, e) => TriggerPreviewUpdate();

        _grpTargets.Controls.AddRange(new Control[] { _chkLockScreen, _chkDesktop });
        _leftStack.Controls.Add(_grpTargets);

        // 3. Card Customization Group
        _grpStyle = CreateCardGroup("WIDGET CUSTOMIZATION", 220);

        var lblPos = new Label { Text = "Screen Position:", Location = new Point(14, 38), AutoSize = true, ForeColor = TextMuted };
        _cboPosition = new ComboBox
        {
            Location = new Point(14, 58),
            Width = 204,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = BgColor,
            ForeColor = TextMain,
            FlatStyle = FlatStyle.Flat
        };
        _cboPosition.Items.AddRange(new object[] { "BottomCenter", "BottomRight", "BottomLeft", "TopCenter", "TopRight", "TopLeft" });
        _cboPosition.SelectedIndexChanged += (s, e) => TriggerPreviewUpdate();

        _lblTasksHeader = new Label { Text = "Max Deadlines:", Location = new Point(236, 38), AutoSize = true, ForeColor = TextMuted };
        _cboMaxTasks = new ComboBox
        {
            Location = new Point(236, 58),
            Width = 208,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = BgColor,
            ForeColor = TextMain,
            FlatStyle = FlatStyle.Flat
        };
        _cboMaxTasks.Items.AddRange(new object[] { "1 deadline", "2 deadlines", "3 deadlines", "4 deadlines", "5 deadlines", "6 deadlines" });
        _cboMaxTasks.SelectedIndexChanged += (s, e) => TriggerPreviewUpdate();

        var lblBlur = new Label { Text = "Glass Bokeh Blur:", Location = new Point(14, 96), AutoSize = true, ForeColor = TextMuted };
        _lblBlurValue = new Label { Text = "24px", Location = new Point(135, 96), AutoSize = true, ForeColor = TextMain, Font = new Font(_uiFont, 9f, FontStyle.Bold) };
        _trackBlur = new TrackBar
        {
            Location = new Point(14, 118),
            Width = 430,
            Minimum = 0,
            Maximum = 40,
            Value = 24,
            BackColor = SurfaceColor,
            TickStyle = TickStyle.None
        };
        _trackBlur.ValueChanged += (s, e) =>
        {
            _lblBlurValue.Text = $"{_trackBlur.Value}px";
            TriggerPreviewUpdate();
        };

        var lblTrans = new Label { Text = "Glass Transparency:", Location = new Point(14, 158), AutoSize = true, ForeColor = TextMuted };
        _lblTransparencyValue = new Label { Text = "68%", Location = new Point(148, 158), AutoSize = true, ForeColor = TextMain, Font = new Font(_uiFont, 9f, FontStyle.Bold) };
        _trackTransparency = new TrackBar
        {
            Location = new Point(14, 180),
            Width = 430,
            Minimum = 0,
            Maximum = 100,
            SmallChange = 2,
            LargeChange = 10,
            Value = 68,
            BackColor = SurfaceColor,
            TickStyle = TickStyle.None
        };
        _trackTransparency.ValueChanged += (s, e) =>
        {
            _lblTransparencyValue.Text = $"{_trackTransparency.Value}%";
            TriggerPreviewUpdate();
        };

        _grpStyle.Controls.AddRange(new Control[]
        {
            lblPos, _cboPosition, _lblTasksHeader, _cboMaxTasks,
            lblBlur, _lblBlurValue, _trackBlur,
            lblTrans, _lblTransparencyValue, _trackTransparency
        });
        _leftStack.Controls.Add(_grpStyle);

        // 4. Wallpaper Source Group
        _grpWallpaper = CreateCardGroup("WALLPAPER SOURCE", 136);
        _rbDefaultWallpaper = new RadioButton
        {
            Text = "Use current Windows Wallpaper (auto-detects changes)",
            Location = new Point(14, 38),
            AutoSize = true,
            Checked = true,
            ForeColor = TextMain
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
            Location = new Point(14, 65),
            AutoSize = true,
            ForeColor = TextMain
        };

        _txtCustomWallpaper = CreateBorderedTextBox(_grpWallpaper, 34, 93, 294);
        _txtCustomWallpaper.Enabled = false;
        _txtCustomWallpaper.TextChanged += (s, e) => TriggerPreviewUpdate();

        _btnBrowseWallpaper = CreateButton("Browse...", new Point(336, 91), 110, 28, isAccent: false);
        _btnBrowseWallpaper.Enabled = false;
        _btnBrowseWallpaper.Click += (s, e) => OnBrowseWallpaperClicked();

        _grpWallpaper.Controls.AddRange(new Control[] { _rbDefaultWallpaper, _rbCustomWallpaper, _btnBrowseWallpaper });
        _leftStack.Controls.Add(_grpWallpaper);

        // 5. Startup & Frequency Group
        _grpStartup = CreateCardGroup("SYSTEM INTEGRATION", 174);
        _chkStartup = new CheckBox
        {
            Text = "Start automatically when Windows boots (runs in system tray)",
            Location = new Point(14, 38),
            AutoSize = true,
            Checked = true,
            ForeColor = TextMain
        };

        var lblInterval = new Label { Text = "Background sync interval:", Location = new Point(14, 68), AutoSize = true, ForeColor = TextMuted };
        _cboInterval = new ComboBox
        {
            Location = new Point(185, 65),
            Width = 175,
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = BgColor,
            ForeColor = TextMain,
            FlatStyle = FlatStyle.Flat
        };
        _cboInterval.Items.AddRange(new object[] { "1 minute", "2 minutes (Recommended)", "5 minutes", "15 minutes" });

        _chkAutoUpdate = new CheckBox
        {
            Text = "Automatically download and install .exe updates from GitHub",
            Location = new Point(14, 98),
            AutoSize = true,
            Checked = true,
            ForeColor = TextMain
        };

        _btnCheckUpdates = CreateButton("Check for Updates", new Point(14, 128), 160, 28, isAccent: false);
        _btnCheckUpdates.Click += async (s, e) => await OnCheckUpdatesClicked();

        _lblVersionInfo = new Label
        {
            Text = $"Installed: v{SelfUpdater.CurrentVersionString}",
            Location = new Point(185, 130),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = _fontStatusRegular
        };

        _grpStartup.Controls.AddRange(new Control[]
        {
            _chkStartup, lblInterval, _cboInterval,
            _chkAutoUpdate, _btnCheckUpdates, _lblVersionInfo
        });
        _leftStack.Controls.Add(_grpStartup);

        // 6. Action Buttons Bar (One primary solid button per screen; secondary outlined)
        _pnlActions = new Panel
        {
            Width = 460,
            Height = 56,
            Margin = new Padding(0, 4, 0, 8),
            BackColor = BgColor
        };
        _btnRestore = CreateButton("Restore Original Wallpaper", new Point(0, 8), 204, 38, isAccent: false);
        _btnRestore.Click += async (s, e) => await OnRestoreClicked();

        _btnSaveApply = CreateButton("Save & Apply Now", new Point(216, 8), 244, 38, isAccent: true);
        _btnSaveApply.Click += async (s, e) => await OnSaveApplyClicked();

        _pnlActions.Controls.AddRange(new Control[] { _btnRestore, _btnSaveApply });
        _leftStack.Controls.Add(_pnlActions);

        // --- RIGHT PANEL (Interactive Live Real-Time Preview) ---
        var rightPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(12, 0, 0, 0),
            BackColor = BgColor
        };
        mainTable.Controls.Add(rightPanel, 1, 0);

        _grpPreview = CreateCardGroup("LIVE REAL-TIME PREVIEW", 580);
        _grpPreview.Dock = DockStyle.Fill;
        rightPanel.Controls.Add(_grpPreview);

        _previewFrame = new Panel
        {
            Location = new Point(14, 42),
            Size = new Size(472, 266),
            Padding = new Padding(1),
            BackColor = BorderColor
        };
        _previewBox = new PictureBox
        {
            Dock = DockStyle.Fill,
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.Black,
            BorderStyle = BorderStyle.None
        };
        _previewFrame.Controls.Add(_previewBox);

        _lblPreviewTip = new Label
        {
            Text = "Shows the exact 0px Swiss Grid glass card rendered onto your wallpaper.",
            Location = new Point(14, 318),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = _fontStatusRegular
        };

        _grpPreview.Controls.AddRange(new Control[] { _previewFrame, _lblPreviewTip });

        // Responsive layout hooks on resize / scrollbar visibility changes
        _leftScroll.ClientSizeChanged += (s, e) => UpdateResponsiveLayout();
        _grpPreview.ClientSizeChanged += (s, e) => UpdateResponsiveLayout();
        this.Resize += (s, e) => UpdateResponsiveLayout();

        // Fast 45ms debounce timer for smooth 60fps real-time slider re-rendering
        _previewDebounceTimer = new System.Windows.Forms.Timer { Interval = 45 };
        _previewDebounceTimer.Tick += (s, e) =>
        {
            _previewDebounceTimer.Stop();
            RenderLivePreview();
        };
    }

    private void UpdateResponsiveLayout()
    {
        if (this.IsDisposed || _leftScroll == null || _grpPreview == null) return;

        try
        {
            _leftScroll.SuspendLayout();
            _leftStack.SuspendLayout();

            int availLeftW = _leftScroll.ClientSize.Width - _leftScroll.Padding.Horizontal;
            int cardW = Math.Max(360, availLeftW - 4);

            if (_leftStack.Width != cardW)
            {
                _leftStack.Width = cardW;
                foreach (var card in new[] { _grpConnection, _grpTargets, _grpStyle, _grpWallpaper, _grpStartup, _pnlActions })
                {
                    card.Width = cardW;
                    card.Invalidate();
                }

                // 1. Connection Card
                _btnTestConnection.Left = cardW - 14 - _btnTestConnection.Width;
                if (_txtSyncKey.Parent != null)
                {
                    _txtSyncKey.Parent.Width = Math.Max(140, _btnTestConnection.Left - 22);
                    _txtSyncKey.Parent.Invalidate();
                }
                _lblConnectionStatus.MaximumSize = new Size(cardW - 28, 0);

                // 3. Customization Card
                int halfW = Math.Max(130, (cardW - 42) / 2);
                _cboPosition.Width = halfW;
                _lblTasksHeader.Left = 28 + halfW;
                _cboMaxTasks.Left = 28 + halfW;
                _cboMaxTasks.Width = Math.Max(130, cardW - 14 - _cboMaxTasks.Left);
                _trackBlur.Width = Math.Max(180, cardW - 28);
                _trackTransparency.Width = Math.Max(180, cardW - 28);

                // 4. Wallpaper Card
                _btnBrowseWallpaper.Left = cardW - 14 - _btnBrowseWallpaper.Width;
                if (_txtCustomWallpaper.Parent != null)
                {
                    _txtCustomWallpaper.Parent.Width = Math.Max(120, _btnBrowseWallpaper.Left - 42);
                    _txtCustomWallpaper.Parent.Invalidate();
                }

                // 5. Startup & Updates Card
                _cboInterval.Width = Math.Clamp(cardW - 199, 140, 220);
                _lblVersionInfo.MaximumSize = new Size(Math.Max(140, cardW - 199), 38);

                // 6. Action Buttons
                int restoreW = (cardW - 12) * 45 / 100;
                _btnRestore.Width = restoreW;
                _btnSaveApply.Left = restoreW + 12;
                _btnSaveApply.Width = cardW - restoreW - 12;
            }
        }
        finally
        {
            _leftStack.ResumeLayout(true);
            _leftScroll.ResumeLayout(true);
        }

        // Right Preview Panel: keep crisp 16:9 preview scaled to available panel space
        int previewAvailW = Math.Max(260, _grpPreview.ClientSize.Width - 28);
        int previewAvailH = Math.Max(160, _grpPreview.ClientSize.Height - 86);
        int targetW = previewAvailW;
        int targetH = targetW * 9 / 16;
        if (targetH > previewAvailH)
        {
            targetH = previewAvailH;
            targetW = targetH * 16 / 9;
        }
        int frameX = Math.Max(14, (_grpPreview.ClientSize.Width - targetW) / 2);
        var newRect = new Rectangle(frameX, 42, targetW, targetH);
        if (_previewFrame.Bounds != newRect)
        {
            bool sizeChanged = _previewFrame.Size != newRect.Size;
            _previewFrame.Bounds = newRect;
            _lblPreviewTip.Location = new Point(14, newRect.Bottom + 10);
            _lblPreviewTip.MaximumSize = new Size(previewAvailW, 0);
            _grpPreview.Invalidate();
            if (sizeChanged && this.Visible)
            {
                TriggerPreviewUpdate();
            }
        }
    }

    private Panel CreateCardGroup(string title, int height)
    {
        var panel = new BufferedCardPanel
        {
            Width = 460,
            Height = height,
            BackColor = SurfaceColor,
            Margin = new Padding(0, 0, 0, 12)
        };
        panel.Paint += (s, e) =>
        {
            using var pen = new Pen(BorderColor, 1);
            e.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
            e.Graphics.DrawLine(pen, 1, 28, panel.Width - 2, 28);
        };
        var lblHeader = new Label
        {
            Text = title,
            Location = new Point(12, 7),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = new Font(_uiFont, 7.75f, FontStyle.Bold)
        };
        panel.Controls.Add(lblHeader);
        return panel;
    }

    private TextBox CreateBorderedTextBox(Panel parent, int x, int y, int width)
    {
        var wrap = new Panel
        {
            Location = new Point(x, y),
            Size = new Size(width, 24),
            Padding = new Padding(5, 4, 5, 3),
            BackColor = BgColor
        };
        bool focused = false;
        wrap.Paint += (s, e) =>
        {
            using var pen = new Pen(focused ? TextMain : BorderColor, 1);
            e.Graphics.DrawRectangle(pen, 0, 0, wrap.Width - 1, wrap.Height - 1);
        };
        var tb = new TextBox
        {
            Dock = DockStyle.Fill,
            BackColor = BgColor,
            ForeColor = TextMain,
            BorderStyle = BorderStyle.None,
            Font = new Font(_uiFont, 9.25f)
        };
        tb.Enter += (s, e) => { focused = true; wrap.Invalidate(); };
        tb.Leave += (s, e) => { focused = false; wrap.Invalidate(); };
        wrap.Controls.Add(tb);
        parent.Controls.Add(wrap);
        return tb;
    }

    private Button CreateButton(string text, Point loc, int w, int h, bool isAccent)
    {
        var btn = new Button
        {
            Text = text,
            Location = loc,
            Size = new Size(w, h),
            FlatStyle = FlatStyle.Flat,
            Font = new Font(_uiFont, 9f, isAccent ? FontStyle.Bold : FontStyle.Regular),
            Cursor = Cursors.Hand
        };
        btn.FlatAppearance.BorderSize = 1;

        if (isAccent)
        {
            btn.BackColor = TextMain;
            btn.ForeColor = OnAccentColor;
            btn.FlatAppearance.BorderColor = TextMain;
            btn.FlatAppearance.MouseOverBackColor = Color.White;
            btn.FlatAppearance.MouseDownBackColor = Color.FromArgb(228, 228, 231);
        }
        else
        {
            btn.BackColor = BgColor;
            btn.ForeColor = TextMain;
            btn.FlatAppearance.BorderColor = BorderStrong;
            btn.FlatAppearance.MouseOverBackColor = SurfaceHover;
            btn.FlatAppearance.MouseDownBackColor = BorderColor;
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

        _trackTransparency.Value = Math.Clamp(_config.GlassTransparency, _trackTransparency.Minimum, _trackTransparency.Maximum);
        _lblTransparencyValue.Text = $"{_trackTransparency.Value}%";

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
        _chkAutoUpdate.Checked = _config.AutoUpdate;

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
                GlassTransparency = _trackTransparency.Value,
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
            Program.Log($"Preview render error: {ex}");
            try
            {
                if (!this.IsDisposed && !_previewBox.IsDisposed)
                {
                    int boxW = Math.Max(200, _previewBox.Width);
                    int boxH = Math.Max(120, _previewBox.Height);
                    string detail = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message : ex.GetType().Name;
                    var fallbackBmp = new Bitmap(boxW, boxH);
                    using (var g = Graphics.FromImage(fallbackBmp))
                    {
                        g.Clear(BgColor);
                        using var pen = new Pen(BorderStrong, 1);
                        g.DrawRectangle(pen, 12, 12, boxW - 25, boxH - 25);
                        using var titleBrush = new SolidBrush(TextMain);
                        using var bodyBrush = new SolidBrush(TextMuted);
                        g.DrawString("PREVIEW ERROR", _fontStatusBold, titleBrush, 24, 24);
                        g.DrawString(detail, _fontStatusRegular, bodyBrush, new RectangleF(24, 48, boxW - 48, boxH - 72));
                    }
                    var oldImg = _previewBox.Image;
                    _previewBox.Image = fallbackBmp;
                    oldImg?.Dispose();
                }
            }
            catch { }
        }
    }

    private async Task OnTestConnectionClicked()
    {
        string key = _txtSyncKey.Text.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            _lblConnectionStatus.Text = "REQUIRED: Enter a valid sync key first.";
            _lblConnectionStatus.ForeColor = TextMain;
            _lblConnectionStatus.Font = _fontStatusBold;
            return;
        }

        _lblConnectionStatus.Text = "Connecting to Blackboarder...";
        _lblConnectionStatus.ForeColor = TextMuted;
        _lblConnectionStatus.Font = _fontStatusRegular;
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
                _lblConnectionStatus.Text = $"CONNECTED: Found {taskCount} deadlines across {courseCount} courses.";
                _lblConnectionStatus.ForeColor = TextMain;
                _lblConnectionStatus.Font = _fontStatusBold;
            }
            else if (!fetched.IsOffline)
            {
                _lblConnectionStatus.Text = "CONNECTED: All caught up (no pending deadlines).";
                _lblConnectionStatus.ForeColor = TextMain;
                _lblConnectionStatus.Font = _fontStatusBold;
            }
            else
            {
                _lblConnectionStatus.Text = "OFFLINE: Using locally cached deadlines.";
                _lblConnectionStatus.ForeColor = TextMuted;
                _lblConnectionStatus.Font = _fontStatusBold;
            }

            TriggerPreviewUpdate();
        }
        catch (Exception ex)
        {
            string detail = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message : ex.GetType().Name;
            _lblConnectionStatus.Text = $"ERROR: Connection failed - {detail}";
            _lblConnectionStatus.ForeColor = TextMain;
            _lblConnectionStatus.Font = _fontStatusBold;
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
            _config.GlassTransparency = _trackTransparency.Value;
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
            _config.AutoUpdate = _chkAutoUpdate.Checked;

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
            Program.Log($"Save & Apply failed: {ex}");
            string detail = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message.Trim() : ex.GetType().Name;
            if (ex.InnerException != null && !string.IsNullOrWhiteSpace(ex.InnerException.Message))
            {
                detail += $" ({ex.InnerException.Message.Trim()})";
            }
            MessageBox.Show($"Error applying widget: {detail}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _btnSaveApply.Enabled = true;
            _btnSaveApply.Text = "Save & Apply Now";
        }
    }

    private async Task OnCheckUpdatesClicked()
    {
        _btnCheckUpdates.Enabled = false;
        _lblVersionInfo.Text = "Checking GitHub Releases...";
        _lblVersionInfo.ForeColor = TextMuted;
        _lblVersionInfo.Font = _fontStatusRegular;

        try
        {
            var release = await SelfUpdater.CheckForUpdateAsync();
            if (release == null)
            {
                _lblVersionInfo.Text = $"UP TO DATE: v{SelfUpdater.CurrentVersionString}";
                _lblVersionInfo.ForeColor = TextMain;
                _lblVersionInfo.Font = _fontStatusBold;
                return;
            }

            if (!SelfUpdater.CanSelfUpdate(out string reason))
            {
                _lblVersionInfo.Text = $"UPDATE READY: {release.TagName} on GitHub";
                _lblVersionInfo.ForeColor = TextMain;
                _lblVersionInfo.Font = _fontStatusBold;
                MessageBox.Show(
                    $"Blackboarder {release.TagName} is available (installed: v{SelfUpdater.CurrentVersionString}).\n\n{reason}",
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
            if (choice != DialogResult.Yes)
            {
                _lblVersionInfo.Text = $"AVAILABLE: {release.TagName} ready";
                _lblVersionInfo.ForeColor = TextMain;
                _lblVersionInfo.Font = _fontStatusBold;
                return;
            }

            _lblVersionInfo.Text = $"Downloading {release.TagName}...";
            _lblVersionInfo.ForeColor = TextMain;

            var progress = new Progress<string>(status =>
            {
                if (!this.IsDisposed && !_lblVersionInfo.IsDisposed)
                {
                    _lblVersionInfo.Text = status;
                }
            });

            var applied = await SelfUpdater.DownloadAndApplyUpdateAsync(
                release,
                relaunchMinimized: false,
                beforeRelaunchOnUiThread: null,
                progress: progress
            );

            if (applied.Relaunching)
            {
                Program.ReleaseInstanceMutex();
                Application.Exit();
                _ = Task.Run(async () =>
                {
                    await Task.Delay(3000);
                    Environment.Exit(0);
                });
            }
            else
            {
                _lblVersionInfo.Text = $"ERROR: {applied.Message}";
                _lblVersionInfo.ForeColor = TextMain;
                _lblVersionInfo.Font = _fontStatusBold;
            }
        }
        catch (Exception ex)
        {
            string detail = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message : ex.GetType().Name;
            _lblVersionInfo.Text = $"ERROR: Check failed - {detail}";
            _lblVersionInfo.ForeColor = TextMain;
            _lblVersionInfo.Font = _fontStatusBold;
        }
        finally
        {
            if (!_btnCheckUpdates.IsDisposed) _btnCheckUpdates.Enabled = true;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _previewDebounceTimer?.Dispose();
            _previewBox?.Image?.Dispose();
            _fontStatusRegular?.Dispose();
            _fontStatusBold?.Dispose();
        }
        base.Dispose(disposing);
    }
}
