using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

internal static class Program
{
    private const string MutexName = "BlackboarderWidget-SingleInstance-Mutex-Global";

    private static void Log(string msg)
    {
        try
        {
            string logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Blackboarder", "startup.log");
            File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}");
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

        var config = AppConfig.Load();
        var syncEngine = new SyncEngine(config);

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
            Log($"Exception in Application.Run: {ex}");
            string errPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Blackboarder", "crash.log");
            File.WriteAllText(errPath, ex.ToString());
            MessageBox.Show(ex.ToString(), "Blackboarder Widget Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
