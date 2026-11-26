using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlackboarderWidget;

internal static class Program
{
    private const string MutexName = "BlackboarderWidget-SingleInstance-Mutex-Global";
    private static Mutex? _instanceMutex;
    private static bool _mutexOwned;
    private static int _mutexThreadId;

    public static void ReleaseInstanceMutex()
    {
        try
        {
            if (_instanceMutex != null && _mutexOwned)
            {
                if (_mutexThreadId != 0 && Environment.CurrentManagedThreadId != _mutexThreadId)
                {
                    Log($"ReleaseInstanceMutex called off-thread ({Environment.CurrentManagedThreadId} != {_mutexThreadId}); skipping release.");
                    return;
                }
                _mutexOwned = false;
                _instanceMutex.ReleaseMutex();
                _instanceMutex.Dispose();
                _instanceMutex = null;
            }
        }
        catch (Exception ex)
        {
            Log($"ReleaseInstanceMutex warning: {ex.Message}");
        }
    }

    private static string AppDataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Blackboarder"
    );

    internal static void Log(string msg)
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

    internal static void RecordCrash(string source, Exception? ex)
    {
        if (ex == null) return;
        try
        {
            Directory.CreateDirectory(AppDataDir);
            string errPath = Path.Combine(AppDataDir, "crash.log");
            File.AppendAllText(errPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{source}] {ex}{Environment.NewLine}{Environment.NewLine}");
            Log($"Crash [{source}]: {ex.GetType().Name}: {ex.Message}");
        }
        catch { }
    }

    private static int ParseWaitPid(string[] args)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--wait-pid", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(args[i + 1], out int pid) && pid > 0)
            {
                return pid;
            }
        }
        return 0;
    }

    [STAThread]
    static async Task Main(string[] args)
    {
        Log($"Main v{SelfUpdater.CurrentVersionString} started with args: {string.Join(" ", args)}");
        SelfUpdater.CleanupStaleUpdateFiles();

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

        int waitPid = ParseWaitPid(args);
        if (waitPid > 0)
        {
            Log($"Waiting for previous instance PID {waitPid} to exit...");
            try
            {
                using var prevProc = Process.GetProcessById(waitPid);
                await Task.Run(() => prevProc.WaitForExit(15000));
            }
            catch { }
        }

        // 2. Single-instance enforcement for the background daemon
        bool justUpdated = args.Contains("--updated", StringComparer.OrdinalIgnoreCase);
        bool isNewInstance = false;
        _instanceMutex = new Mutex(true, MutexName, out isNewInstance);
        _mutexOwned = isNewInstance;
        if (isNewInstance) _mutexThreadId = Environment.CurrentManagedThreadId;

        if (!isNewInstance && justUpdated)
        {
            for (int i = 0; i < 40 && !isNewInstance; i++)
            {
                await Task.Delay(250);
                try
                {
                    if (_instanceMutex.WaitOne(0))
                    {
                        isNewInstance = true;
                        _mutexOwned = true;
                        _mutexThreadId = Environment.CurrentManagedThreadId;
                    }
                }
                catch (AbandonedMutexException)
                {
                    isNewInstance = true;
                    _mutexOwned = true;
                    _mutexThreadId = Environment.CurrentManagedThreadId;
                }
            }
        }

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
            Application.Run(new TrayApplicationContext(config, syncEngine, openSettings, justUpdated));
            Log("Application.Run exited cleanly.");
        }
        catch (Exception ex)
        {
            RecordCrash("Application.Run", ex);
            MessageBox.Show(ex.ToString(), "Blackboarder Widget Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            ReleaseInstanceMutex();
        }
    }
}
