<#
  Blackboarder updater for Windows.

  -Install     (run by update.bat) downloads the latest extension from GitHub into this folder and
               registers the update helper with Chrome, Edge, Brave and Chromium, so the extension
               can update itself from then on.
  -NativeHost  (run by host.bat when the extension asks) answers one native message:
               {"type":"ping"} or {"type":"update"}.

  The extension folder is the parent of the folder this script is in, or dist/ next to it when
  the script runs from a git clone's own updater/ folder. Inside a git clone the helper updates
  with git pull --ff-only, and only when that cannot lose work (on main, nothing uncommitted).
#>
param(
  [switch]$Install,
  [switch]$NativeHost
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$HostName = 'com.blackboarder.updater'
$ZipUrl = 'https://github.com/yvs1n/blackboarder-extension/archive/refs/heads/main.zip'
$ScriptParent = Split-Path -Parent $PSScriptRoot
# Run from a git clone's own updater/ folder, the browser loads dist/ next to it
$ExtDir = $ScriptParent
if (-not (Test-Path -LiteralPath (Join-Path $ScriptParent 'manifest.json')) -and (Test-Path -LiteralPath (Join-Path $ScriptParent 'dist\manifest.json'))) {
  $ExtDir = Join-Path $ScriptParent 'dist'
}
$HelperVersion = 1

function Test-DevCheckout {
  # A folder inside a git clone is updated with git pull + npm run build, not by replacing files
  return Test-Path -LiteralPath (Join-Path (Split-Path -Parent $ExtDir) '.git')
}

function Read-VersionFile([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try { return Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Get-GitText([string[]]$gitArgs) {
  # Output never reaches stdout, which carries the native messages
  return ((& git -C (Split-Path -Parent $ExtDir) @gitArgs 2>$null) | Out-String).Trim()
}

function Update-GitCheckout {
  # Built files are committed, so a fast-forward pull is the whole update. Anything that could
  # lose work (another branch, uncommitted edits, local commits) is left alone.
  $ErrorActionPreference = 'Continue'
  $skip = { param($why) @{ ok = $false; code = 'dev-checkout'; error = $why } }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return & $skip 'This folder is a git clone, but git was not found. Run git pull yourself.' }
  $branch = Get-GitText @('rev-parse', '--abbrev-ref', 'HEAD')
  if ($branch -ne 'main') { return & $skip "The git clone is on branch '$branch', not main, so it was not updated." }
  if (Get-GitText @('status', '--porcelain', '--untracked-files=no')) { return & $skip 'The git clone has uncommitted changes, so it was not updated. Commit or stash them, then run git pull.' }
  $before = Get-GitText @('rev-parse', 'HEAD')
  & git -C (Split-Path -Parent $ExtDir) pull --ff-only --quiet origin main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { return & $skip 'git pull --ff-only failed (the clone has commits GitHub does not). Run git pull yourself.' }
  $info = Read-VersionFile (Join-Path $ExtDir 'version.json')
  return @{ ok = $true; changed = ($before -ne (Get-GitText @('rev-parse', 'HEAD'))); build = $(if ($info) { $info.build } else { $null }) }
}

function Update-ExtensionFiles {
  if (Test-DevCheckout) { return Update-GitCheckout }

  $work = Join-Path $env:TEMP ('blackboarder-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $work 'main.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $zip
    $unpacked = Join-Path $work 'src'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force

    $srcDist = $null
    foreach ($dir in Get-ChildItem -LiteralPath $unpacked -Directory) {
      $candidate = Join-Path $dir.FullName 'dist'
      if (Test-Path -LiteralPath (Join-Path $candidate 'manifest.json')) { $srcDist = $candidate; break }
    }
    if (-not $srcDist) { throw 'The download does not contain a built extension (dist/manifest.json).' }

    $newInfo = Read-VersionFile (Join-Path $srcDist 'version.json')
    if (-not $newInfo -or -not $newInfo.build) { throw 'The download has no version.json.' }
    $installedFile = Join-Path $ExtDir 'version.json'
    $oldInfo = Read-VersionFile $installedFile
    if ($oldInfo -and $oldInfo.build -eq $newInfo.build) {
      return @{ ok = $true; changed = $false; build = $newInfo.build }
    }

    # Copy every file; version.json goes last so a half-finished update never looks complete
    $srcRoot = (Resolve-Path -LiteralPath $srcDist).Path.TrimEnd('\')
    foreach ($file in Get-ChildItem -LiteralPath $srcRoot -Recurse -File) {
      $rel = $file.FullName.Substring($srcRoot.Length + 1)
      if ($rel -eq 'version.json') { continue }
      $dest = Join-Path $ExtDir $rel
      $destDir = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
    }

    # Remove files the previous build had and the new one does not (renamed bundles and so on)
    if ($oldInfo -and $oldInfo.files -and $newInfo.files) {
      $keep = @{}
      foreach ($f in $newInfo.files) { $keep[$f.ToLowerInvariant()] = $true }
      foreach ($f in $oldInfo.files) {
        if ($keep.ContainsKey($f.ToLowerInvariant()) -or $f -match '\.\.' -or $f -match '^[\\/]' -or $f -match ':') { continue }
        $stale = Join-Path $ExtDir ($f -replace '/', '\')
        if (Test-Path -LiteralPath $stale -PathType Leaf) { Remove-Item -LiteralPath $stale -Force }
      }
    }

    Copy-Item -LiteralPath (Join-Path $srcRoot 'version.json') -Destination $installedFile -Force
    return @{ ok = $true; changed = $true; build = $newInfo.build }
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
# Native messaging (Chrome talks to the helper over stdin/stdout)
# ---------------------------------------------------------------------------

function Read-NativeMessage {
  $stdin = [Console]::OpenStandardInput()
  $lengthBytes = New-Object byte[] 4
  $read = 0
  while ($read -lt 4) {
    $n = $stdin.Read($lengthBytes, $read, 4 - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  $length = [BitConverter]::ToInt32($lengthBytes, 0)
  if ($length -le 0 -or $length -gt 1MB) { return $null }
  $buffer = New-Object byte[] $length
  $read = 0
  while ($read -lt $length) {
    $n = $stdin.Read($buffer, $read, $length - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  return [Text.Encoding]::UTF8.GetString($buffer) | ConvertFrom-Json
}

function Write-NativeMessage($message) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($message | ConvertTo-Json -Compress -Depth 4))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

function Invoke-NativeHost {
  $reply = $null
  try {
    $message = Read-NativeMessage
    $type = if ($message) { [string]$message.type } else { '' }
    if ($type -eq 'ping') {
      $info = Read-VersionFile (Join-Path $ExtDir 'version.json')
      $reply = @{ ok = $true; helperVersion = $HelperVersion; devCheckout = (Test-DevCheckout); build = $(if ($info) { $info.build } else { $null }) }
    } elseif ($type -eq 'update') {
      $reply = Update-ExtensionFiles
    } else {
      $reply = @{ ok = $false; error = "Unknown request '$type'" }
    }
  } catch {
    $reply = @{ ok = $false; error = $_.Exception.Message }
  }
  Write-NativeMessage $reply
}

# ---------------------------------------------------------------------------
# Registration (-Install)
# ---------------------------------------------------------------------------

# Chromium names an unpacked extension after its folder: SHA-256 of the path (UTF-16, drive letter
# upper-cased), first 16 bytes, each hex digit mapped to a-p.
function Get-UnpackedExtensionId([string]$dir) {
  $path = [IO.Path]::GetFullPath($dir).TrimEnd('\')
  if ($path -match '^[a-z]:') { $path = $path.Substring(0, 1).ToUpperInvariant() + $path.Substring(1) }
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($path))
  $hex = -join ($hash[0..15] | ForEach-Object { $_.ToString('x2') })
  return -join ($hex.ToCharArray() | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })
}

# Also look the folder up in each browser profile, in case the browser stored the path differently
function Find-ExtensionIdsInProfiles([string]$dir) {
  $ids = @()
  $target = [IO.Path]::GetFullPath($dir).TrimEnd('\')
  $roots = @(
    "$env:LOCALAPPDATA\Google\Chrome\User Data",
    "$env:LOCALAPPDATA\Chromium\User Data",
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"
  )
  try { Add-Type -AssemblyName System.Web.Extensions } catch { return $ids }
  $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength = [int]::MaxValue
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($prefs in Get-ChildItem -LiteralPath $root -Recurse -Depth 1 -File -Include 'Preferences', 'Secure Preferences' -ErrorAction SilentlyContinue) {
      try {
        $data = $serializer.DeserializeObject([IO.File]::ReadAllText($prefs.FullName))
        $settings = $data['extensions']['settings']
        foreach ($id in $settings.Keys) {
          $entryPath = [string]$settings[$id]['path']
          if ($entryPath -and [string]::Equals($entryPath.TrimEnd('\'), $target, [StringComparison]::OrdinalIgnoreCase)) { $ids += $id }
        }
      } catch {}
    }
  }
  return $ids
}

function Register-NativeHost {
  $ids = @(Get-UnpackedExtensionId $ExtDir) + @(Find-ExtensionIdsInProfiles $ExtDir) | Select-Object -Unique
  $manifestDir = Join-Path $env:LOCALAPPDATA 'Blackboarder'
  New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
  $manifestPath = Join-Path $manifestDir "$HostName.json"
  $manifest = [ordered]@{
    name = $HostName
    description = 'Blackboarder updater'
    path = (Join-Path $PSScriptRoot 'host.bat')
    type = 'stdio'
    allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
  }
  [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))

  foreach ($browserKey in @('Google\Chrome', 'Chromium', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser')) {
    $key = "HKCU:\Software\$browserKey\NativeMessagingHosts\$HostName"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
  }
  return $ids
}

function Invoke-Install {
  Write-Host '===================================================='
  Write-Host '  Blackboarder updater'
  Write-Host '===================================================='
  if (-not (Test-Path -LiteralPath (Join-Path $ExtDir 'manifest.json'))) {
    throw "Could not find the extension next to this script ($ExtDir)."
  }
  Write-Host "Extension folder: $ExtDir"
  if (Test-DevCheckout) {
    Write-Host '[1/2] This is a git clone; updating with git pull...'
  } else {
    Write-Host '[1/2] Downloading the latest version from GitHub...'
  }
  $result = Update-ExtensionFiles
  if (-not $result.ok) { Write-Host "      $($result.error)" }
  elseif ($result.changed) { Write-Host "      Updated to build $($result.build)." } else { Write-Host '      Already up to date.' }

  Write-Host '[2/2] Turning on automatic updates...'
  $ids = Register-NativeHost
  Write-Host "      Extension ID: $($ids -join ', ')"
  Write-Host ''
  Write-Host 'Done. Blackboarder now updates itself whenever a new version is pushed to GitHub.'
  Write-Host 'If this is the first time: open chrome://extensions and click the reload arrow on Blackboarder once.'
  Write-Host 'Your tasks, courses and Sync Key are kept.'
}

if ($NativeHost) {
  Invoke-NativeHost
} elseif ($Install) {
  try {
    Invoke-Install
  } catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host 'Run update.bat in the Blackboarder folder.'
}
