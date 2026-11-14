using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlackboarderWidget;

public class AppConfig
{
    private static readonly string AppDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Blackboarder"
    );

    public static readonly string ConfigFilePath = Path.Combine(AppDataFolder, "config.json");
    public static readonly string TasksCachePath = Path.Combine(AppDataFolder, "tasks_cache.json");
    public static readonly string LockscreenImagePath = Path.Combine(AppDataFolder, "lockscreen_widget.png");
    public static readonly string DesktopImagePath = Path.Combine(AppDataFolder, "desktop_widget.png");
    public static readonly string OriginalWallpaperBackup = Path.Combine(AppDataFolder, "original_wallpaper.jpg");
    public static readonly string LastStatePath = Path.Combine(AppDataFolder, "last_render_state.json");

    [JsonPropertyName("syncKey")]
    public string SyncKey { get; set; } = string.Empty;

    [JsonPropertyName("position")]
    public string Position { get; set; } = "BottomCenter";

    [JsonPropertyName("maxTasks")]
    public int MaxTasks { get; set; } = 3;

    [JsonPropertyName("setLockScreen")]
    public bool SetLockScreen { get; set; } = true;

    [JsonPropertyName("setDesktop")]
    public bool SetDesktop { get; set; } = false;

    [JsonPropertyName("wallpaperPath")]
    public string WallpaperPath { get; set; } = string.Empty;

    [JsonPropertyName("pollIntervalMinutes")]
    public int PollIntervalMinutes { get; set; } = 2;

    [JsonPropertyName("startWithWindows")]
    public bool StartWithWindows { get; set; } = true;

    [JsonPropertyName("showLocation")]
    public bool ShowLocation { get; set; } = true;

    [JsonPropertyName("blurRadius")]
    public int BlurRadius { get; set; } = 24;

    public static AppConfig Load()
    {
        try
        {
            if (!Directory.Exists(AppDataFolder))
            {
                Directory.CreateDirectory(AppDataFolder);
            }

            if (File.Exists(ConfigFilePath))
            {
                string json = File.ReadAllText(ConfigFilePath);
                var loaded = JsonSerializer.Deserialize<AppConfig>(json);
                if (loaded != null)
                {
                    return loaded;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error loading config: {ex.Message}");
        }

        return new AppConfig();
    }

    public void Save()
    {
        try
        {
            if (!Directory.Exists(AppDataFolder))
            {
                Directory.CreateDirectory(AppDataFolder);
            }

            var options = new JsonSerializerOptions { WriteIndented = true };
            string json = JsonSerializer.Serialize(this, options);
            File.WriteAllText(ConfigFilePath, json);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error saving config: {ex.Message}");
        }
    }
}
