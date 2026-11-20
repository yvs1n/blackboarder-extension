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

    public static bool CanSelfUpdate(out string reason)
    {
        string? exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
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
            string? exePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(exePath)) return;

            foreach (string suffix in new[] { ".old", ".update.tmp" })
            {
                string target = exePath + suffix;
                if (!File.Exists(target)) continue;

                for (int i = 0; i < 6; i++)
                {
                    try
                    {
                        File.Delete(target);
                        break;
                    }
                    catch
                    {
                        Thread.Sleep(250);
                    }
                }
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
        Action? beforeRelaunchOnUiThread = null)
    {
        if (!CanSelfUpdate(out string blockReason))
        {
            return new UpdateApplyResult(false, false, blockReason);
        }

        if (!await UpdateLock.WaitAsync(0).ConfigureAwait(false))
        {
            return new UpdateApplyResult(false, false, "An update is already in progress.");
        }

        string? exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath))
        {
            UpdateLock.Release();
            return new UpdateApplyResult(false, false, "Executable path missing.");
        }

        string tmpPath = exePath + ".update.tmp";
        string oldPath = exePath + ".old";

        try
        {
            Program.Log($"Updater downloading {release.TagName} to {tmpPath}");
            using var dlClient = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            dlClient.DefaultRequestHeaders.UserAgent.ParseAdd($"BlackboarderWidget/{CurrentVersionString}");

            using var resp = await dlClient.GetAsync(release.DownloadUrl, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return new UpdateApplyResult(false, false, $"Download failed (HTTP {(int)resp.StatusCode}).");
            }

            await using (var fs = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                await resp.Content.CopyToAsync(fs).ConfigureAwait(false);
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

            // Swap running executable safely on NTFS (rename in-use exe -> .old, move .tmp -> exe)
            Program.Log($"Updater swapping binary for {release.TagName}");
            TryDelete(oldPath);
            File.Move(exePath, oldPath, overwrite: true);

            try
            {
                File.Move(tmpPath, exePath, overwrite: true);
            }
            catch
            {
                // Roll back if moving new binary into place failed
                try { File.Move(oldPath, exePath, overwrite: true); } catch { }
                throw;
            }

            // Invoke only UI-safe preparation when provided on UI thread (mutex itself must be freed on UI thread)
            beforeRelaunchOnUiThread?.Invoke();

            string modeFlag = relaunchMinimized ? "--minimized --updated" : "--updated";
            string relaunchArgs = $"{modeFlag} --wait-pid {Environment.ProcessId}";
            Program.Log($"Updater launching new binary with args: {relaunchArgs}");
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                Arguments = relaunchArgs,
                UseShellExecute = true
            });

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
