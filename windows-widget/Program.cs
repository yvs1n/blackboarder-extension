using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

internal static class Program
{
    private const string MutexName = "BlackboarderWidget-SingleInstance-Mutex-Global";

    private static string AppDataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Blackboarder"
    );

    private static void Log(string msg)
    {
        try
        {
            Directory.CreateDirectory(AppDataDir);
            string logPath = Path.Combine(AppDataDir, "startup.log");
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 262144)
            {
                File.WriteAllText(logPath, string.Empty);
            }
            File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}");
        }
        catch { }
    }

    private static void RecordCrash(string source, Exception? ex)
    {
        if (ex == null) return;
        try
        {
            Directory.CreateDirectory(AppDataDir);
            string errPath = Path.Combine(AppDataDir, "crash.log");
            File.AppendAllText(errPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{source}] {ex}{Environment.NewLine}{Environment.NewLine}");
            Log($"Crash [{source}]: {ex.Message}");
        }
        catch { }
    }

    [STAThread]
    static async Task Main(string[] args)
    {
        Log($"Main started with args: {string.Join(" ", args)}");

        // 1. One-shot command line actions
        if (args.Contains("--restore", StringComparer.OrdinalIgnoreCase))
        {
            Log("Executing --restore");
            await WallpaperManager.RestoreOriginalAsync();
            return;
        }

        if (args.Contains("--sync-now", StringComparer.OrdinalIgnoreCase))
        {
            Log("Executing --sync-now");
            var cfg = AppConfig.Load();
            using var engine = new SyncEngine(cfg);
            await engine.UpdateWidgetAsync(force: true);
            return;
        }

        // 2. Single-instance enforcement for the background daemon
        using var mutex = new Mutex(true, MutexName, out bool isNewInstance);
        Log($"Mutex acquired: isNewInstance={isNewInstance}");
        if (!isNewInstance)
        {
            Log("Another instance already running. Showing alert and exiting.");
            MessageBox.Show(
                "Blackboarder Widget is already running in your system tray.\n\nLook for the Blackboarder icon near your Windows clock.",
                "Already Running",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return;
        }

        Log("Initializing ApplicationConfiguration...");
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => RecordCrash("UIThread", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => RecordCrash("AppDomain", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            RecordCrash("TaskScheduler", e.Exception);
            e.SetObserved();
        };

        var config = AppConfig.Load();
        using var syncEngine = new SyncEngine(config);

        bool isMinimized = args.Contains("--minimized", StringComparer.OrdinalIgnoreCase);
        bool openSettings = !isMinimized || string.IsNullOrWhiteSpace(config.SyncKey);
        Log($"Running TrayApplicationContext (openSettings={openSettings})...");

        try
        {
            Application.Run(new TrayApplicationContext(config, syncEngine, openSettings));
            Log("Application.Run exited cleanly.");
        }
        catch (Exception ex)
        {
            RecordCrash("Application.Run", ex);
            MessageBox.Show(ex.ToString(), "Blackboarder Widget Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
