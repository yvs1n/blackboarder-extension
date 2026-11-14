using System;
using System.IO;
using Microsoft.Win32;

namespace BlackboarderWidget;

public static class StartupManager
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AppName = "BlackboarderWidget";

    public static bool IsStartupEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            if (key != null)
            {
                var val = key.GetValue(AppName) as string;
                return !string.IsNullOrWhiteSpace(val);
            }
        }
        catch { }
        return false;
    }

    public static void SetStartupEnabled(bool enable)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            if (key == null) return;

            if (enable)
            {
                string exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "BlackboarderWidget.exe");
                key.SetValue(AppName, $"\"{exePath}\" --minimized");
            }
            else
            {
                key.DeleteValue(AppName, throwOnMissingValue: false);
            }
        }
        catch { }
    }
}
