using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
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

public class RenderState
{
    public string Fingerprint { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string UpdatedAt { get; set; } = string.Empty;
    public List<string> TopTasks { get; set; } = new();
}

public class SyncEngine : IDisposable
{
    private static readonly HttpClient Http = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(12)
    };

    public AppConfig Config { get; private set; }
    private System.Threading.Timer? _pollTimer;
    private bool _isSyncing;
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
            async _ => await SafeUpdateAsync(force: false),
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
        if (e.Mode == PowerModes.Resume)
        {
            // Delay 15 seconds to allow Wi-Fi to establish connection
            await Task.Delay(TimeSpan.FromSeconds(15));
            await SafeUpdateAsync(force: true);
        }
    }

    private async void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.SessionLogon)
        {
            await SafeUpdateAsync(force: false);
        }
    }

    private async void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        await SafeUpdateAsync(force: true);
    }

    private async Task SafeUpdateAsync(bool force)
    {
        if (_isSyncing) return;
        _isSyncing = true;
        try
        {
            var res = await UpdateWidgetAsync(force);
            SyncCompleted?.Invoke(res);
        }
        catch (Exception ex)
        {
            SyncCompleted?.Invoke(new SyncResult
            {
                Success = false,
                Message = ex.Message,
                DidReRender = false
            });
        }
        finally
        {
            _isSyncing = false;
        }
    }

    public async Task<SyncResult> UpdateWidgetAsync(bool force = false)
    {
        var result = new SyncResult();
        var (tasks, courses, isOffline) = await FetchTasksAsync(Config.SyncKey);

        var activePending = new List<TaskItem>();
        var nowUtc = DateTime.UtcNow;
        foreach (var t in tasks)
        {
            if (string.Equals(t.Status, "dismissed", StringComparison.OrdinalIgnoreCase)) continue;
            if (t.IsCompleted()) continue;
            var dueUtc = t.GetDueDateTimeUtc();
            if (dueUtc.HasValue && dueUtc.Value < nowUtc) continue;
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

        // Change detection signature
        var sigParts = new List<string>();
        foreach (var t in displayTasks)
        {
            sigParts.Add($"{t.Id}|{t.DueDate}|{t.IsDone}|{t.Status}");
        }
        string currentSig = string.Join("##", sigParts) + "::" + summaryText + $"::Pos={Config.Position}::Tasks={Config.MaxTasks}::Lock={Config.SetLockScreen}::Desk={Config.SetDesktop}::Blur={Config.BlurRadius}";

        bool hasChanged = force;
        if (!hasChanged && File.Exists(AppConfig.LastStatePath))
        {
            try
            {
                string stateJson = File.ReadAllText(AppConfig.LastStatePath);
                var lastState = JsonSerializer.Deserialize<RenderState>(stateJson);
                if (lastState != null && lastState.Fingerprint != currentSig)
                {
                    hasChanged = true;
                }
            }
            catch
            {
                hasChanged = true;
            }
        }
        else if (!File.Exists(AppConfig.LastStatePath))
        {
            hasChanged = true;
        }

        string wallpaper = Config.WallpaperPath;
        if (string.IsNullOrWhiteSpace(wallpaper) || !File.Exists(wallpaper))
        {
            wallpaper = WallpaperManager.GetCurrentDesktopWallpaper();
        }

        WallpaperManager.EnsureOriginalWallpaperBackup(wallpaper);

        if (!hasChanged && File.Exists(AppConfig.LockscreenImagePath))
        {
            result.Success = true;
            result.DidReRender = false;
            result.Message = "Deadlines unchanged. Lock screen up to date.";
            return result;
        }

        // Render widget
        var screen = Screen.PrimaryScreen ?? Screen.AllScreens[0];
        int w = screen.Bounds.Width;
        int h = screen.Bounds.Height;

        using var bitmap = LiquidGlassRenderer.RenderWidget(
            wallpaper,
            tasks,
            courses,
            Config,
            w,
            h,
            isOffline
        );

        bitmap.Save(AppConfig.LockscreenImagePath, System.Drawing.Imaging.ImageFormat.Png);

        // Record render state
        try
        {
            var topTitles = new List<string>();
            foreach (var t in displayTasks) topTitles.Add(t.Title);
            var state = new RenderState
            {
                Fingerprint = currentSig,
                Summary = summaryText,
                UpdatedAt = DateTime.UtcNow.ToString("o"),
                TopTasks = topTitles
            };
            File.WriteAllText(AppConfig.LastStatePath, JsonSerializer.Serialize(state));
        }
        catch { }

        // Apply lockscreen
        if (Config.SetLockScreen)
        {
            try
            {
                await WallpaperManager.SetLockScreenAsync(AppConfig.LockscreenImagePath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Lock screen set error: {ex.Message}");
            }
        }

        // Apply desktop
        if (Config.SetDesktop)
        {
            try
            {
                bitmap.Save(AppConfig.DesktopImagePath, System.Drawing.Imaging.ImageFormat.Png);
                WallpaperManager.SetDesktopWallpaper(AppConfig.DesktopImagePath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Desktop wallpaper set error: {ex.Message}");
            }
        }

        result.Success = true;
        result.DidReRender = true;
        result.Message = $"Updated successfully! {activePending.Count} active deadlines.";
        return result;
    }

    public static async Task<(List<TaskItem> Tasks, List<CourseItem> Courses, bool IsOffline)> FetchTasksAsync(string syncKey)
    {
        if (string.IsNullOrWhiteSpace(syncKey))
        {
            return LoadFromCache();
        }

        try
        {
            string url = $"https://blackboarder.pages.dev/api/tasks?key={Uri.EscapeDataString(syncKey.Trim())}";
            var response = await Http.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                string json = await response.Content.ReadAsStringAsync();
                var apiRes = JsonSerializer.Deserialize<TasksApiResponse>(json);
                if (apiRes != null && apiRes.Tasks != null)
                {
                    // Cache locally
                    try
                    {
                        File.WriteAllText(AppConfig.TasksCachePath, json);
                    }
                    catch { }

                    return (apiRes.Tasks, apiRes.Courses ?? new(), false);
                }
            }
        }
        catch { }

        return LoadFromCache();
    }

    private static (List<TaskItem> Tasks, List<CourseItem> Courses, bool IsOffline) LoadFromCache()
    {
        if (File.Exists(AppConfig.TasksCachePath))
        {
            try
            {
                string json = File.ReadAllText(AppConfig.TasksCachePath);
                var apiRes = JsonSerializer.Deserialize<TasksApiResponse>(json);
                if (apiRes != null && apiRes.Tasks != null)
                {
                    return (apiRes.Tasks, apiRes.Courses ?? new(), true);
                }
            }
            catch { }
        }
        return (new List<TaskItem>(), new List<CourseItem>(), true);
    }

    public void Dispose()
    {
        if (_isDisposed) return;
        _isDisposed = true;
        _pollTimer?.Dispose();
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
    }
}
