# Installing Blackboarder in Your Browser (60 Seconds)

Blackboarder works with **Google Chrome**, **Microsoft Edge**, **Brave**, **Opera**, **Vivaldi**, and **Mozilla Firefox**.

- **Fastest (Automatic Updates):** Install from the **[Chrome Web Store](https://blackboarder.pages.dev/chrome-extension)** (live and current; also installs cleanly in Brave, desktop Edge, Opera, and Vivaldi). Microsoft Edge Add-ons currently hosts older `v1.8.34` while store review catches up, and Firefox Add-ons publishing is pending (use `blackboarder-android-firefox.zip` below).
- **Manual / Developer ZIP:** Follow the steps below if installing an unpacked GitHub Release ZIP. You do not need to install Node.js, code editors, or developer tools.

---

## Quick Step-by-Step Installation

### Step 1: Unzip the File
1. Download `blackboarder-extension.zip`.
2. Right-click the zip file and choose **Extract All...** (or unzip with 7-Zip/Archive Utility).
3. Extract to a location on your computer that you will keep (such as your `Documents` or `Desktop` folder).

> **Important**: Keep the extracted folder where it is. If you delete or move this folder later, your browser will lose access to the extension.

---

### Step 2: Open Extensions in Your Browser

Copy and paste the URL matching your browser into your address bar and press Enter:

| Browser | Address Bar URL |
| :--- | :--- |
| **Google Chrome** | `chrome://extensions` |
| **Mozilla Firefox** | `about:debugging#/runtime/this-firefox` |
| **Microsoft Edge** | `edge://extensions` |
| **Brave** | `brave://extensions` |
| **Opera** | `opera://extensions` |

---

### Step 3: Enable Developer Mode
In Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi), look in the top-right (or left sidebar in Edge) for the **Developer mode** toggle switch and turn it **ON**. (Firefox does not require a toggle on the debugging page.)

---

### Step 4: Load the Extension
- **Chrome, Edge, Brave, Opera, Vivaldi:** Click the **"Load unpacked"** button in the top toolbar, select the extracted folder (the folder containing `manifest.json`), and click **Select Folder**.
- **Turn on automatic updates (recommended, once):** Double-click `update.bat` (Windows) or run `sh update.sh` (Mac/Linux) inside that folder once, then click the **Reload** arrow on Blackboarder so future updates download and install on their own without re-downloading ZIPs.
- **Firefox:** Click **"Load Temporary Add-on..."** and select `manifest.json` inside the extracted folder.

---

### Step 5: Pin to Toolbar, Calibrate & Start Using
1. Click the puzzle-piece icon in your browser toolbar (top right).
2. Find **Blackboarder** and click the **Pin** icon.
3. Optional: switch **App Language** between **English** and **العربية** under **Settings > General**.
4. Open your university Blackboard stream:
   - For UOS: [https://elearning.sharjah.ac.ae/ultra/stream](https://elearning.sharjah.ac.ae/ultra/stream)
5. A floating **Scan Blackboard** button (a lightning bolt) will appear on the bottom-right. Click it (or press **Alt+B**) to triage your quizzes, assignments, and exams. On your first scan, Blackboarder checks course syllabi automatically and opens a **Calibration Wizard** to confirm your courses, weekly meeting times, quiz counts, "best N of M" drop rules, and optional API key setup.

---

## Syncing with Your Phone and Calendar

1. Click the Blackboarder extension icon in your browser.
2. Open **Settings** (the gear) and go to **Sync**.
3. Notice your unique **Personal Sync Key** (`BBS-` plus 26 characters, such as `BBS-7K2QX9M4PAH8RT3WNCD5VEFJ6G`).
4. Click **"Show Pairing QR Code"** and scan it with **Scan QR** in the phone app (or click **"Copy Phone Pairing Link"** and open that link on your smartphone) to see your deadlines on your phone.
5. To get deadlines and classes in Apple, Google or Outlook Calendar, go to **Settings > Calendar**, choose what the link shows and click **"Copy Calendar Link"**.

---

## Updating Blackboarder (Zero Data Loss)

Your deadlines, courses, custom syllabus weights, and Personal Sync Key are **permanently preserved** during updates across all devices.

### Managing updates in Settings > Updates
1. Open the Blackboarder extension and click the **Settings** gear icon, then select **Updates**.
2. Blackboarder checks GitHub every 15 minutes over lightweight HTTP and shows a banner whenever a newer build is available.
3. Keep **Automatic Updates** turned **ON** (enabled by default): on git clones on clean `main` or unpacked Chromium folders where the optional helper below is registered, new builds replace files cleanly on disk and reload immediately when you click **Update Now** (or automatically once idle).
4. Keep **Show Changelog After Update** turned **ON** to view a **What's New** summary the first time you open Blackboarder after an update, or expand the latest changelog inside **Settings > Updates** anytime.

### Manual ZIP or optional in-place helper
- **Manual ZIP refresh:** Download `blackboarder-extension.zip` from **Settings > Updates** or GitHub Releases, extract it over your existing extension folder, and click **Reload** on your browser extensions page.
- **One-time in-place helper (optional):** On unpacked Chromium installs (Chrome, Edge, Brave, Opera, Vivaldi), run `update.bat` (Windows) or `./update.sh` (Mac/Linux) once to register the lightweight helper in `updater/` so clicking **Update Now** (or Automatic Updates) updates files cleanly on disk and reloads the extension immediately without re-downloading the ZIP by hand.

> If you loaded the extension from a `git clone`, the helper updates it with `git pull --ff-only`, and only when the clone is on `main` with no uncommitted changes. Otherwise it leaves your work alone and **Settings > Updates** shows why.

---

## Standalone Setup on Mobile & Tablet (No Laptop Needed)

### Android (Firefox for Android, Edge, Quetta)
Google Chrome for Android does not allow extensions, so open Blackboard in **Firefox for Android**, **Microsoft Edge**, or **Quetta**:
1. Download `blackboarder-android-firefox.zip` (Firefox for Android) or `blackboarder-extension.zip` (Chromium browsers like Quetta/Lemur) and load it in your browser's Add-ons/Extensions manager.
2. Sign into Blackboard in that browser and tap **Scan Blackboard** in the Blackboarder popup or floating lightning button.
3. Open **Companion App** (`/companion`) and paste your **Sync Key** to check deadlines, push alerts, calendar feeds, and Android widgets anywhere.

### iPhone & iPad (Free Safari Userscript + Companion PWA)
Apple requires a paid Developer account for native iOS Safari App Store extensions, so iPhone and iPad run the 100% free open-source **Userscripts** route instead:
1. Install **Userscripts** (free on the App Store) and enable it under **Settings > Apps > Safari > Extensions** for your Blackboard domain.
2. Open `https://blackboarder.pages.dev/blackboarder.user.js` in Safari and tap the banner to install the script.
3. Visit Blackboard in Safari, tap the floating **Blackboarder** button, and tap **Scan Blackboard & Sync**.
4. Tap **Open Companion App** right inside the scanner drawer (your Sync Key links automatically), then tap **Share > Add to Home Screen** on the Companion PWA.


