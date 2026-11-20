using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BlackboarderWidget;

public record ReleaseUpdateInfo(
    Version RemoteVersion,
    string TagName,
    string DownloadUrl,
    long ExpectedSize
);

public record UpdateApplyResult(
    bool Success,
    bool Relaunching,
    string Message
);

public static class SelfUpdater
{
    private const string LatestReleaseApi = "https://api.github.com/repos/yvs1n/blackboarder-extension/releases/latest";
    private const string AssetName = "BlackboarderWidget.exe";

    private static readonly HttpClient Http = CreateHttpClient();
    private static readonly SemaphoreSlim UpdateLock = new(1, 1);

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(15)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"BlackboarderWidget/{CurrentVersionString}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public static Version CurrentVersion
    {
        get
        {
            var v = Assembly.GetExecutingAssembly().GetName().Version;
            return v != null ? new Version(v.Major, Math.Max(0, v.Minor), Math.Max(0, v.Build)) : new Version(1, 0, 0);
        }
    }

    public static string CurrentVersionString => $"{CurrentVersion.Major}.{CurrentVersion.Minor}.{Math.Max(0, CurrentVersion.Build)}";

    public static string GetCanonicalExePath()
    {
        string? exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath)) return string.Empty;

        int oldIdx = exePath.IndexOf(".exe.old", StringComparison.OrdinalIgnoreCase);
        if (oldIdx > 0)
        {
            return exePath[..(oldIdx + 4)];
        }
        return exePath;
    }

    public static bool CanSelfUpdate(out string reason)
    {
        string exePath = GetCanonicalExePath();
        if (string.IsNullOrWhiteSpace(exePath) || (!File.Exists(exePath) && !File.Exists(Environment.ProcessPath)))
        {
            reason = "Executable path is unavailable.";
            return false;
        }
        if (!exePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(Path.GetFileName(exePath), "dotnet.exe", StringComparison.OrdinalIgnoreCase))
        {
            reason = "Running via dotnet host instead of packaged executable.";
            return false;
        }
        if (exePath.Contains(@"\windows-widget\bin\", StringComparison.OrdinalIgnoreCase))
        {
            reason = "Running from local build output directory.";
            return false;
        }
        string? dir = Path.GetDirectoryName(exePath);
        if (string.IsNullOrWhiteSpace(dir))
        {
            reason = "Install folder unavailable.";
            return false;
        }
        reason = string.Empty;
        return true;
    }

    public static void CleanupStaleUpdateFiles()
    {
        try
        {
            string exePath = GetCanonicalExePath();
            if (string.IsNullOrWhiteSpace(exePath)) return;
            string? dir = Path.GetDirectoryName(exePath);
            string baseName = Path.GetFileName(exePath);
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;

            string? currentProcPath = Environment.ProcessPath;
            foreach (string file in Directory.GetFiles(dir, baseName + "*"))
            {
                if (string.Equals(file, exePath, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.IsNullOrWhiteSpace(currentProcPath) &&
                    string.Equals(file, currentProcPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string fileName = Path.GetFileName(file);
                bool isStale = fileName.Contains(".old", StringComparison.OrdinalIgnoreCase) ||
                               fileName.Contains(".update.tmp", StringComparison.OrdinalIgnoreCase);
                if (!isStale) continue;

                TryDelete(file);
            }
        }
        catch { }
    }

    public static async Task<ReleaseUpdateInfo?> CheckForUpdateAsync()
    {
        try
        {
            using var resp = await Http.GetAsync(LatestReleaseApi).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                Program.Log($"Updater check HTTP {(int)resp.StatusCode}");
                return null;
            }

            string json = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            string tagName = root.TryGetProperty("tag_name", out var tagEl) ? (tagEl.GetString() ?? "") : "";
            Version? remoteVer = ParseVersion(tagName);
            if (remoteVer == null || remoteVer <= CurrentVersion) return null;

            if (!root.TryGetProperty("assets", out var assetsEl) || assetsEl.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var asset in assetsEl.EnumerateArray())
            {
                string name = asset.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "") : "";
                if (!string.Equals(name, AssetName, StringComparison.OrdinalIgnoreCase)) continue;

                string dlUrl = asset.TryGetProperty("browser_download_url", out var uEl) ? (uEl.GetString() ?? "") : "";
                long size = asset.TryGetProperty("size", out var sEl) && sEl.TryGetInt64(out long parsedSize) ? parsedSize : 0;

                if (string.IsNullOrWhiteSpace(dlUrl) || !dlUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    return null;
                }

                Program.Log($"Updater found remote release {tagName} ({size} bytes)");
                return new ReleaseUpdateInfo(remoteVer, tagName, dlUrl, size);
            }
        }
        catch (Exception ex)
        {
            Program.Log($"Updater check failed: {ex.Message}");
        }

        return null;
    }

    public static async Task<UpdateApplyResult> DownloadAndApplyUpdateAsync(
        ReleaseUpdateInfo release,
        bool relaunchMinimized,
        Action? beforeRelaunchOnUiThread = null,
        IProgress<string>? progress = null)
    {
        if (!CanSelfUpdate(out string blockReason))
        {
            return new UpdateApplyResult(false, false, blockReason);
        }

        if (!await UpdateLock.WaitAsync(0).ConfigureAwait(false))
        {
            return new UpdateApplyResult(false, false, "An update is already in progress.");
        }

        string exePath = GetCanonicalExePath();
        if (string.IsNullOrWhiteSpace(exePath))
        {
            UpdateLock.Release();
            return new UpdateApplyResult(false, false, "Executable path missing.");
        }

        // Stage download in LocalApplicationData\Blackboarder\updates so Controlled Folder Access or locked Desktop files never block the download
        string stagingDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Blackboarder",
            "updates"
        );
        Directory.CreateDirectory(stagingDir);
        string tmpPath = Path.Combine(stagingDir, $"BlackboarderWidget_{Environment.ProcessId}.update.tmp");

        try
        {
            Program.Log($"Updater downloading {release.TagName} to {tmpPath}");
            progress?.Report($"Downloading {release.TagName}...");

            using var dlClient = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            dlClient.DefaultRequestHeaders.UserAgent.ParseAdd($"BlackboarderWidget/{CurrentVersionString}");

            using var resp = await dlClient.GetAsync(release.DownloadUrl, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return new UpdateApplyResult(false, false, $"Download failed (HTTP {(int)resp.StatusCode}).");
            }

            long totalBytes = resp.Content.Headers.ContentLength ?? release.ExpectedSize;
            await using (var netStream = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
            await using (var fs = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                byte[] buffer = new byte[81920];
                long readTotal = 0;
                int lastReportedPct = -1;
                int read;
                while ((read = await netStream.ReadAsync(buffer.AsMemory(0, buffer.Length)).ConfigureAwait(false)) > 0)
                {
                    await fs.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
                    readTotal += read;
                    if (totalBytes > 0)
                    {
                        int pct = (int)Math.Clamp((readTotal * 100L) / totalBytes, 0, 100);
                        if (pct != lastReportedPct && (pct % 5 == 0 || pct == 100))
                        {
                            lastReportedPct = pct;
                            progress?.Report($"Downloading {release.TagName}... {pct}%");
                        }
                    }
                }
            }

            var fi = new FileInfo(tmpPath);
            if (!fi.Exists || fi.Length < 1024 * 1024)
            {
                TryDelete(tmpPath);
                return new UpdateApplyResult(false, false, "Downloaded file was incomplete.");
            }
            if (release.ExpectedSize > 0 && fi.Length != release.ExpectedSize)
            {
                TryDelete(tmpPath);
                return new UpdateApplyResult(false, false, "Downloaded file size did not match GitHub release asset.");
            }

            // Verify PE/MZ executable signature
            byte[] magic = new byte[2];
            await using (var checkFs = new FileStream(tmpPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (await checkFs.ReadAsync(magic.AsMemory(0, 2)).ConfigureAwait(false) < 2 || magic[0] != 0x4D || magic[1] != 0x5A)
                {
                    TryDelete(tmpPath);
                    return new UpdateApplyResult(false, false, "Downloaded file is not a valid Windows executable.");
                }
            }

            progress?.Report($"Installing {release.TagName}...");
            Program.Log($"Updater swapping binary for {release.TagName} into {exePath}");

            // Terminate any other stray BlackboarderWidget instances that might lock exePath or .old
            TerminateOtherWidgetProcesses();
            CleanupStaleUpdateFiles();

            string modeFlag = relaunchMinimized ? "--minimized --updated" : "--updated";
            string relaunchArgs = $"{modeFlag} --wait-pid {Environment.ProcessId}";

            // Try fast in-place NTFS rename first using a guaranteed unlocked .old backup slot
            bool swappedInPlace = false;
            string oldBackupPath = GetAvailableOldBackupPath(exePath);
            try
            {
                if (File.Exists(exePath))
                {
                    File.Move(exePath, oldBackupPath, overwrite: true);
                }
                File.Copy(tmpPath, exePath, overwrite: true);
                TryDelete(tmpPath);
                swappedInPlace = true;
            }
            catch (Exception swapEx)
            {
                Program.Log($"In-place swap fallback ({swapEx.GetType().Name}: {swapEx.Message}); using post-exit helper script.");
                // Restore exePath if it was moved before File.Copy failed
                if (!File.Exists(exePath) && File.Exists(oldBackupPath))
                {
                    try { File.Move(oldBackupPath, exePath, overwrite: true); } catch { }
                }
            }

            beforeRelaunchOnUiThread?.Invoke();

            if (swappedInPlace)
            {
                Program.Log($"Updater launching new binary directly: {exePath} {relaunchArgs}");
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = relaunchArgs,
                    UseShellExecute = true
                });
            }
            else
            {
                // Out-of-process post-exit swapper handles locked files after this PID exits
                LaunchPostExitSwapHelper(tmpPath, exePath, relaunchArgs, stagingDir);
            }

            return new UpdateApplyResult(true, true, $"Updated to {release.TagName}.");
        }
        catch (Exception ex)
        {
            Program.Log($"Updater error: {ex}");
            TryDelete(tmpPath);
            return new UpdateApplyResult(false, false, $"Update failed: {ex.Message}");
        }
        finally
        {
            UpdateLock.Release();
        }
    }

    private static string GetAvailableOldBackupPath(string exePath)
    {
        string primaryOld = exePath + ".old";
        TryDelete(primaryOld);
        if (!File.Exists(primaryOld)) return primaryOld;

        for (int i = 1; i <= 50; i++)
        {
            string candidate = $"{exePath}.old.{i}";
            TryDelete(candidate);
            if (!File.Exists(candidate)) return candidate;
        }

        return $"{exePath}.old.{Environment.ProcessId}_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
    }

    private static void TerminateOtherWidgetProcesses()
    {
        int currentPid = Environment.ProcessId;
        try
        {
            foreach (var proc in Process.GetProcessesByName("BlackboarderWidget"))
            {
                using (proc)
                {
                    if (proc.Id == currentPid) continue;
                    try
                    {
                        Program.Log($"Terminating stale BlackboarderWidget process PID {proc.Id}");
                        proc.Kill();
                        proc.WaitForExit(2000);
                    }
                    catch { }
                }
            }
        }
        catch { }
    }

    private static void LaunchPostExitSwapHelper(string stagedTmpPath, string targetExePath, string relaunchArgs, string stagingDir)
    {
        string scriptPath = Path.Combine(stagingDir, "apply_update.cmd");
        int pid = Environment.ProcessId;
        string script =
            "@echo off\r\n" +
            "for /L %%i in (1,1,30) do (\r\n" +
            $"  tasklist /FI \"PID eq {pid}\" 2>NUL | find /I \"{pid}\" >NUL\r\n" +
            "  if errorlevel 1 goto :copy\r\n" +
            "  timeout /t 1 /nobreak >NUL\r\n" +
            ")\r\n" +
            ":copy\r\n" +
            $"del /F /Q \"{targetExePath}.old\" >NUL 2>&1\r\n" +
            $"move /Y \"{targetExePath}\" \"{targetExePath}.old\" >NUL 2>&1\r\n" +
            $"for /L %%r in (1,1,10) do (\r\n" +
            $"  copy /Y /B \"{stagedTmpPath}\" \"{targetExePath}\" >NUL 2>&1 && goto :launch\r\n" +
            "  timeout /t 1 /nobreak >NUL\r\n" +
            ")\r\n" +
            ":launch\r\n" +
            $"del /F /Q \"{stagedTmpPath}\" >NUL 2>&1\r\n" +
            $"start \"\" \"{targetExePath}\" {relaunchArgs}\r\n";

        File.WriteAllText(scriptPath, script);
        Program.Log($"Launching post-exit helper script: {scriptPath}");
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/C \"\"{scriptPath}\"\"",
            CreateNoWindow = true,
            UseShellExecute = false,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }

    private static Version? ParseVersion(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        string cleaned = raw.Trim().TrimStart('v', 'V');
        int dash = cleaned.IndexOf('-');
        if (dash >= 0) cleaned = cleaned[..dash];
        if (!Version.TryParse(cleaned, out var parsed)) return null;
        return new Version(parsed.Major, Math.Max(0, parsed.Minor), Math.Max(0, parsed.Build));
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch { }
    }
}
