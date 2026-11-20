# Installing Blackboarder in Your Browser (60 Seconds)

Blackboarder works with **Google Chrome**, **Mozilla Firefox**, **Microsoft Edge**, **Brave**, **Opera**, or **Vivaldi**.

You do not need to install Node.js, code editors, or developer tools.

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
- **Firefox:** Click **"Load Temporary Add-on..."** and select `manifest.json` inside the extracted folder.

---

### Step 5: Pin to Toolbar and Start Using
1. Click the puzzle-piece icon in your browser toolbar (top right).
2. Find **Blackboarder** and click the **Pin** icon.
3. Open your university Blackboard stream:
   - For UOS: [https://elearning.sharjah.ac.ae/ultra/stream](https://elearning.sharjah.ac.ae/ultra/stream)
4. A floating **Scan Blackboard** button (a lightning bolt) will appear on the bottom-right. Click it to automatically triage, parse, and categorize all your upcoming assignments, quizzes, and exams.

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

