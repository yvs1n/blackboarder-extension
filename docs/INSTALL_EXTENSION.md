# Installing Blackboarder in Your Browser (60 Seconds)

Blackboarder works with any Chromium browser: **Google Chrome**, **Microsoft Edge**, **Brave**, **Opera**, or **Vivaldi**.

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
| **Microsoft Edge** | `edge://extensions` |
| **Brave** | `brave://extensions` |
| **Opera** | `opera://extensions` |

---

### Step 3: Enable Developer Mode
Look in the top-right (or left sidebar in Edge) for the **Developer mode** toggle switch and turn it **ON**.

---

### Step 4: Load the Extension
1. Click the **"Load unpacked"** button in the top toolbar.
2. In the file picker dialog, select the extracted folder (the folder containing `manifest.json`).
3. Click **Select Folder**.

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

### Turn on automatic updates (once)
1. Open your extracted Blackboarder folder.
2. Double-click **`update.bat`** (Windows) or run `./update.sh` in a terminal (Mac/Linux).
3. The script downloads the latest version into the folder and registers a small update helper with your browser.
4. The first time only: open `chrome://extensions` and click the reload arrow on Blackboarder.

From then on Blackboarder checks GitHub every 15 minutes, like an extension from the Chrome Web Store. When a new version is pushed it downloads it into the folder and restarts itself as soon as the popup is closed. **Settings → Extension Updates** shows whether automatic updates are on, and **Check for Updates** checks right away.

### Without the helper
If you skip the step above, the popup shows an **Update Available** banner when a new version is on GitHub. Run `update.bat` / `update.sh` then, or download the zip, extract it over your folder and click **Reload**.

> If you loaded the extension from a `git clone`, the helper updates it with `git pull --ff-only`, and only when the clone is on `main` with no uncommitted changes. Otherwise it leaves your work alone and **Settings** shows why.

