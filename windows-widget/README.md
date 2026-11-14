# Blackboarder Windows Widget App

A native, high-performance Windows 10 & 11 companion app for Blackboarder. It renders a frosted liquid glass deadlines card directly onto your Windows Lock Screen and Desktop wallpaper.

## Features

- **Standalone Single-File Executable**: Runs directly with zero prerequisites or runtimes required.
- **Settings Dashboard & Live Preview**: Real-time interactive preview that updates immediately as you change position, deadline count, blur intensity, or wallpaper.
- **Background System Tray Daemon**: Runs quietly in the system tray, consuming only ~25 MB RAM.
- **Zero-Latency Event Triggers**: Listens directly to Windows OS events for immediate updates:
  - Wake from Sleep / Hibernation (with a 15-second grace delay for Wi-Fi reconnect)
  - Windows Unlock & User Logon
  - Display resolution / scaling changes
  - Periodic background polling (configurable from 1 to 15 minutes)
- **Native Lock Screen & Desktop Integration**: Uses official WinRT `Windows.System.UserProfile.LockScreen` and COM `IDesktopWallpaper` APIs.
- **Liquid Frosted Glass Engine**: Multi-threaded Gaussian bokeh blur, specular light refraction borders, rounded square course badges, and Swiss Grid typography.

## Quick Start

1. Run `BlackboarderWidget.exe`.
2. Enter your **Sync Key** (from your Blackboarder extension or phone companion under Settings > Sync).
3. Click **Test Connection** to verify your active deadlines.
4. Customize your preferred position (e.g. Bottom Center) and display targets.
5. Click **Save & Apply Now**.
6. Press `Win + L` to lock your screen and see the widget live.

## Building from Source

To compile the single-file release executable:

```powershell
dotnet publish BlackboarderWidget.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

The output will be placed in `publish/BlackboarderWidget.exe`.
