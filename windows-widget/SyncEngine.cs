using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace BlackboarderWidget;

public class SyncResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public bool DidReRender { get; set; }
    public int ActiveCount { get; set; }
    public string Summary { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.Now;
}

public record FetchTasksResult(
    List<TaskItem> Tasks,
    List<CourseItem> Courses,
    StudentProfile? Profile,
    WidgetStyleConfig? WidgetConfig,
    bool IsOffline
);

public class RenderState
{
    public string Fingerprint { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string UpdatedAt { get; set; } = string.Empty;
    public List<string> TopTasks { get; set; } = new();
    public string LastLockscreenPath { get; set; } = string.Empty;
    public string LastDesktopPath { get; set; } = string.Empty;
}

public class SyncEngine : IDisposable
{
    private static readonly HttpClient Http = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(12)
    };

    public AppConfig Config { get; private set; }
    private System.Threading.Timer? _pollTimer;
    private readonly SemaphoreSlim _syncGate = new(1, 1);
    private bool _isDisposed;

    public event Action<SyncResult>? SyncCompleted;

    public SyncEngine(AppConfig config)
    {
        Config = config;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    public void Start()
    {
        int intervalMinutes = Math.Clamp(Config.PollIntervalMinutes, 1, 60);
        _pollTimer?.Dispose();
        _pollTimer = new System.Threading.Timer(
            _ => _ = Task.Run(async () =>
            {
                if (!_isDisposed) await SafeUpdateAsync(force: false);
            }),
            null,
            TimeSpan.FromSeconds(2), // Initial run after 2s
            TimeSpan.FromMinutes(intervalMinutes)
        );
    }

    public void Stop()
    {
        _pollTimer?.Change(Timeout.Infinite, Timeout.Infinite);
    }

    public void UpdateConfig(AppConfig newConfig)
    {
        Config = newConfig;
        Config.Save();
        Start();
    }

    private async void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        try
        {
            if (e.Mode == PowerModes.Resume && !_isDisposed)
            {
                // Delay 15 seconds to allow Wi-Fi to establish connection
                await Task.Delay(TimeSpan.FromSeconds(15)).ConfigureAwait(false);
                if (!_isDisposed) await SafeUpdateAsync(force: true).ConfigureAwait(false);
            }
        }
        catch { }
    }

    private async void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        try
        {
            if ((e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.SessionLogon) && !_isDisposed)
            {
                await SafeUpdateAsync(force: false).ConfigureAwait(false);
            }
        }
        catch { }
    }

    private async void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        try
        {
            if (!_isDisposed) await SafeUpdateAsync(force: true).ConfigureAwait(false);
        }
        catch { }
    }

    private async Task SafeUpdateAsync(bool force)
    {
        if (!await _syncGate.WaitAsync(0).ConfigureAwait(false)) return;
        try
        {
            var res = await UpdateWidgetInternalAsync(force, throwOnApplyError: false).ConfigureAwait(false);
            SyncCompleted?.Invoke(res);
        }
        catch (Exception ex)
        {
            Program.Log($"SafeUpdateAsync error: {ex.GetType().Name}: {ex.Message}");
            SyncCompleted?.Invoke(new SyncResult
            {
                Success = false,
                Message = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message : ex.GetType().Name,
                DidReRender = false
            });
        }
        finally
        {
            _syncGate.Release();
        }
    }

    public async Task<SyncResult> UpdateWidgetAsync(bool force = false)
    {
        await _syncGate.WaitAsync().ConfigureAwait(false);
        try
        {
            return await UpdateWidgetInternalAsync(force, throwOnApplyError: force).ConfigureAwait(false);
        }
        finally
        {
            _syncGate.Release();
        }
    }

    private async Task<SyncResult> UpdateWidgetInternalAsync(bool force, bool throwOnApplyError)
    {
        var result = new SyncResult();
        var fetched = await FetchTasksAsync(Config.SyncKey).ConfigureAwait(false);
        var tasks = fetched.Tasks;
        var courses = fetched.Courses;
        var profile = fetched.Profile;
        var widgetConfig = fetched.WidgetConfig;
        bool isOffline = fetched.IsOffline;

        var activePending = new List<TaskItem>();
        var nowUtc = DateTime.UtcNow;
        foreach (var t in tasks)
        {
            if (string.Equals(t.Status, "dismissed", StringComparison.OrdinalIgnoreCase)) continue;
            if (t.IsCompleted()) continue;
            var dueUtc = t.GetDueDateTimeUtc();
            if (dueUtc.HasValue && dueUtc.Value < nowUtc.AddHours(-1)) continue;
            activePending.Add(t);
        }

        activePending.Sort((x, y) =>
        {
            var dx = x.GetDueDateTimeUtc() ?? DateTime.MaxValue;
            var dy = y.GetDueDateTimeUtc() ?? DateTime.MaxValue;
            return dx.CompareTo(dy);
        });

        int limit = Math.Clamp(Config.MaxTasks, 1, 8);
        var displayTasks = activePending.Count > limit ? activePending.GetRange(0, limit) : activePending;
        string summaryText = LiquidGlassRenderer.GetPendingSummary(activePending);
        if (string.IsNullOrWhiteSpace(summaryText))
        {
            summaryText = activePending.Count == 0 ? "All Caught Up" : "All Done";
        }

        result.ActiveCount = activePending.Count;
        result.Summary = summaryText;

        string wallpaper = Config.WallpaperPath;
        if (string.IsNullOrWhiteSpace(wallpaper) || !File.Exists(wallpaper))
        {
            wallpaper = WallpaperManager.GetCurrentDesktopWallpaper();
        }
        WallpaperManager.EnsureOriginalWallpaperBackup(wallpaper);

        long wallpaperTicks = 0;
        try
        {
            if (!string.IsNullOrWhiteSpace(wallpaper) && File.Exists(wallpaper))
            {
                wallpaperTicks = File.GetLastWriteTimeUtc(wallpaper).Ticks;
            }
        }
        catch { }

        var screen = Screen.PrimaryScreen ?? (Screen.AllScreens.Length > 0 ? Screen.AllScreens[0] : null);
        int w = screen != null && screen.Bounds.Width > 0 ? screen.Bounds.Width : 1920;
        int h = screen != null && screen.Bounds.Height > 0 ? screen.Bounds.Height : 1080;

        // Change detection signature (includes date boundary, wallpaper mtime, screen size, and task details)
        var sigParts = new List<string>();
        foreach (var t in displayTasks)
        {
            sigParts.Add($"{t.Id}|{t.Title}|{t.CourseName}|{t.CourseColor}|{t.Room}|{t.DueDate}|{t.IsDone}|{t.Status}");
        }
        string studentId = profile != null
            ? (!string.IsNullOrWhiteSpace(profile.StudentId) ? profile.StudentId : profile.Id)
            : string.Empty;
        string styleSig = widgetConfig != null ? JsonSerializer.Serialize(widgetConfig) : "";
        string styleHash = string.IsNullOrEmpty(styleSig)
            ? ""
            : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(styleSig)))[..12];
        string currentSig = string.Join("##", sigParts)
            + "::" + summaryText
            + $"::Day={DateTime.Today:yyyy-MM-dd}::Scr={w}x{h}::Wp={wallpaper}@{wallpaperTicks}"
            + $"::Stu={studentId}::Style={styleHash}::Pos={Config.Position}::Tasks={Config.MaxTasks}::Lock={Config.SetLockScreen}::Desk={Config.SetDesktop}::Blur={Config.BlurRadius}::Trans={Config.GlassTransparency}";

        RenderState? lastState = null;
        if (File.Exists(AppConfig.LastStatePath))
        {
            try
            {
                string stateJson = File.ReadAllText(AppConfig.LastStatePath);
                lastState = JsonSerializer.Deserialize<RenderState>(stateJson);
            }
            catch { }
        }

        string nextLockPath = string.Equals(lastState?.LastLockscreenPath, AppConfig.LockscreenImagePathA, StringComparison.OrdinalIgnoreCase)
            ? AppConfig.LockscreenImagePathB
            : AppConfig.LockscreenImagePathA;
        string nextDeskPath = string.Equals(lastState?.LastDesktopPath, AppConfig.DesktopImagePathA, StringComparison.OrdinalIgnoreCase)
            ? AppConfig.DesktopImagePathB
            : AppConfig.DesktopImagePathA;

        bool hasChanged = force || lastState == null || lastState.Fingerprint != currentSig;
        if (!hasChanged && Config.SetLockScreen)
        {
            string prevLock = lastState?.LastLockscreenPath ?? AppConfig.LockscreenImagePathA;
            if (!File.Exists(prevLock)) hasChanged = true;
        }
        if (!hasChanged && Config.SetDesktop)
        {
            string prevDesk = lastState?.LastDesktopPath ?? AppConfig.DesktopImagePathA;
            if (!File.Exists(prevDesk)) hasChanged = true;
        }

        if (!hasChanged)
        {
            result.Success = true;
            result.DidReRender = false;
            result.Message = "Deadlines unchanged. Widget up to date.";
            return result;
        }

        using var bitmap = LiquidGlassRenderer.RenderWidget(
            wallpaper,
            tasks,
            courses,
            Config,
            w,
            h,
            isOffline,
            profile,
            widgetConfig
        );

        var applyErrors = new List<string>();
        string appliedLockPath = lastState?.LastLockscreenPath ?? string.Empty;
        string appliedDeskPath = lastState?.LastDesktopPath ?? string.Empty;

        if (Config.SetLockScreen)
        {
            try
            {
                SaveBitmapAtomic(bitmap, nextLockPath);
                await WallpaperManager.SetLockScreenAsync(nextLockPath).ConfigureAwait(false);
                appliedLockPath = nextLockPath;
            }
            catch (Exception ex)
            {
                string err = FormatExceptionDetail("Lock screen", ex);
                Program.Log(err);
                applyErrors.Add(err);
            }
        }

        if (Config.SetDesktop)
        {
            try
            {
                SaveBitmapAtomic(bitmap, nextDeskPath);
                WallpaperManager.SetDesktopWallpaper(nextDeskPath);
                appliedDeskPath = nextDeskPath;
            }
            catch (Exception ex)
            {
                string err = FormatExceptionDetail("Desktop wallpaper", ex);
                Program.Log(err);
                applyErrors.Add(err);
            }
        }

        if (applyErrors.Count > 0)
        {
            string combinedErr = string.Join(" | ", applyErrors);
            if (throwOnApplyError)
            {
                throw new InvalidOperationException(combinedErr);
            }
            result.Success = false;
            result.DidReRender = false;
            result.Message = combinedErr;
            return result;
        }

        // Only record render state AFTER wallpaper/lockscreen applied cleanly
        try
        {
            var topTitles = new List<string>();
            foreach (var t in displayTasks) topTitles.Add(t.Title);
            var state = new RenderState
            {
                Fingerprint = currentSig,
                Summary = summaryText,
                UpdatedAt = DateTime.UtcNow.ToString("o"),
                TopTasks = topTitles,
                LastLockscreenPath = appliedLockPath,
                LastDesktopPath = appliedDeskPath
            };
            File.WriteAllText(AppConfig.LastStatePath, JsonSerializer.Serialize(state));
        }
        catch { }

        result.Success = true;
        result.DidReRender = true;
        result.Message = $"Updated successfully! {activePending.Count} active deadlines.";
        return result;
    }

    private static void SaveBitmapAtomic(System.Drawing.Bitmap bitmap, string targetPath)
    {
        string? dir = Path.GetDirectoryName(targetPath);
        if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
        string tmp = targetPath + ".tmp";
        bitmap.Save(tmp, System.Drawing.Imaging.ImageFormat.Png);
        File.Move(tmp, targetPath, overwrite: true);
    }

    private static string FormatExceptionDetail(string scope, Exception ex)
    {
        string msg = !string.IsNullOrWhiteSpace(ex.Message) ? ex.Message.Trim() : ex.GetType().Name;
        if (ex.InnerException != null && !string.IsNullOrWhiteSpace(ex.InnerException.Message))
        {
            msg += $" ({ex.InnerException.Message.Trim()})";
        }
        return $"{scope}: {msg}";
    }

    public static async Task<FetchTasksResult> FetchTasksAsync(string syncKey)
    {
        if (string.IsNullOrWhiteSpace(syncKey))
        {
            return LoadFromCache();
        }

        try
        {
            string url = $"https://blackboarder.pages.dev/api/tasks?key={Uri.EscapeDataString(syncKey.Trim())}";
            var response = await Http.GetAsync(url).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var apiRes = JsonSerializer.Deserialize<TasksApiResponse>(json);
                if (apiRes != null && apiRes.Tasks != null)
                {
                    // Cache locally (includes tasks, courses, profile & website widgetConfig for offline parity)
                    try
                    {
                        File.WriteAllText(AppConfig.TasksCachePath, json);
                    }
                    catch { }

                    return new FetchTasksResult(
                        apiRes.Tasks,
                        apiRes.Courses ?? new(),
                        apiRes.Profile,
                        apiRes.WidgetConfig,
                        false
                    );
                }
            }
        }
        catch { }

        return LoadFromCache();
    }

    private static FetchTasksResult LoadFromCache()
    {
        if (File.Exists(AppConfig.TasksCachePath))
        {
            try
            {
                string json = File.ReadAllText(AppConfig.TasksCachePath);
                var apiRes = JsonSerializer.Deserialize<TasksApiResponse>(json);
                if (apiRes != null && apiRes.Tasks != null)
                {
                    return new FetchTasksResult(
                        apiRes.Tasks,
                        apiRes.Courses ?? new(),
                        apiRes.Profile,
                        apiRes.WidgetConfig,
                        true
                    );
                }
            }
            catch { }
        }

        return new FetchTasksResult(new(), new(), null, null, true);
    }

    public void Dispose()
    {
        if (_isDisposed) return;
        _isDisposed = true;
        _pollTimer?.Dispose();
        _syncGate.Dispose();
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
    }
}
