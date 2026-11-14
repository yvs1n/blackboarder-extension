using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace BlackboarderWidget;

public static class WallpaperManager
{
    [ComImport, Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")]
    private class CDesktopWallpaper { }

    [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDesktopWallpaper
    {
        void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorID);
        void GetMonitorDevicePathAt([MarshalAs(UnmanagedType.U4)] uint monitorIndex, [MarshalAs(UnmanagedType.LPWStr)] out string monitorID);
        [return: MarshalAs(UnmanagedType.U4)]
        uint GetMonitorDevicePathCount();
        void GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out System.Drawing.Rectangle displayRect);
        void SetBackgroundColor([MarshalAs(UnmanagedType.U4)] uint color);
        [return: MarshalAs(UnmanagedType.U4)]
        uint GetBackgroundColor();
        void SetPosition([MarshalAs(UnmanagedType.I4)] int position);
        [return: MarshalAs(UnmanagedType.I4)]
        int GetPosition();
        void SetSlideshow(IntPtr items);
        IntPtr GetSlideshow();
        void SetSlideshowOptions(int options, uint slideshowTick);
        void GetSlideshowOptions(out int options, out uint slideshowTick);
        void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.I4)] int direction);
        void GetStatus(out int state);
        void Enable(bool enable);
    }

    public static string GetCurrentDesktopWallpaper()
    {
        try
        {
            var desktop = (IDesktopWallpaper)new CDesktopWallpaper();
            string path = desktop.GetWallpaper(null);
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            {
                return path;
            }
        }
        catch { }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop");
            if (key != null)
            {
                var val = key.GetValue("WallPaper") as string;
                if (!string.IsNullOrWhiteSpace(val) && File.Exists(val))
                {
                    return val;
                }
            }
        }
        catch { }

        string transcoded = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Themes\TranscodedWallpaper"
        );
        if (File.Exists(transcoded))
        {
            return transcoded;
        }

        return string.Empty;
    }

    public static void EnsureOriginalWallpaperBackup(string currentWallpaper)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(currentWallpaper) || !File.Exists(currentWallpaper)) return;

            string backup = AppConfig.OriginalWallpaperBackup;
            if (currentWallpaper == AppConfig.LockscreenImagePath || currentWallpaper == AppConfig.DesktopImagePath)
            {
                return;
            }

            if (!File.Exists(backup))
            {
                File.Copy(currentWallpaper, backup, overwrite: true);
            }
        }
        catch { }
    }

    public static async Task SetLockScreenAsync(string imagePath)
    {
        if (!File.Exists(imagePath))
        {
            throw new FileNotFoundException("Lock screen image file does not exist", imagePath);
        }

        var storageFile = await Windows.Storage.StorageFile.GetFileFromPathAsync(Path.GetFullPath(imagePath));
        await Windows.System.UserProfile.LockScreen.SetImageFileAsync(storageFile);
    }

    public static void SetDesktopWallpaper(string imagePath)
    {
        if (!File.Exists(imagePath))
        {
            throw new FileNotFoundException("Desktop wallpaper image file does not exist", imagePath);
        }

        var desktop = (IDesktopWallpaper)new CDesktopWallpaper();
        desktop.SetWallpaper(null, Path.GetFullPath(imagePath));
    }

    public static async Task RestoreOriginalAsync()
    {
        string backup = AppConfig.OriginalWallpaperBackup;
        if (!File.Exists(backup)) return;

        try
        {
            await SetLockScreenAsync(backup);
        }
        catch { }

        try
        {
            SetDesktopWallpaper(backup);
        }
        catch { }
    }
}
