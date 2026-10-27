# ⚡ Blackboarder

<p align="center">
  <img src="assets/logo.png" alt="Blackboarder Logo" width="160" height="160" />
</p>

<p align="center">
  <strong>Deadline tracker and academic companion for Blackboard Learn</strong>
</p>

<p align="center">
  <a href="https://github.com/yvs1n/blackboarder-extension/releases/latest"><img src="https://img.shields.io/badge/Version-v1.2.7-blue?logo=github&logoColor=white" alt="Version v1.2.7" /></a>
  <a href="https://github.com/yvs1n/blackboarder-extension/releases/latest"><img src="https://img.shields.io/badge/Release-Download_ZIP-black?logo=github&logoColor=white" alt="Download Release" /></a>
  <a href="#-quick-start--installation"><img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue?logo=googlechrome&logoColor=white" alt="Manifest V3" /></a>
  <a href="#-phone-app-and-calendar"><img src="https://img.shields.io/badge/PWA-Mobile_Ready-brightgreen?logo=pwa&logoColor=white" alt="PWA" /></a>
  <a href="#-development"><img src="https://img.shields.io/badge/Tests-324_Passing-success?logo=vitest&logoColor=white" alt="Vitest 324 Passing" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple" alt="License" /></a>
</p>

---

## 📖 What it is

Course announcements on Blackboard bury quiz dates, homework deadlines, exams and room changes inside long English or Arabic messages. **Blackboarder** reads them for you and turns them into one calendar of deadlines.

It is built for the **University of Sharjah** (`elearning.sharjah.ac.ae`, `blackboard.sharjah.ac.ae`) and works on standard Blackboard Learn and Ultra portals. It has three parts that stay in sync:

| Part | What it does |
| :--- | :--- |
| **Browser extension** | Scans Blackboard, finds deadlines, and shows them in a popup or the browser's side panel. This repository is the extension. |
| **Phone app (PWA)** | The same calendar and deadlines on your phone, at [blackboarder.pages.dev](https://blackboarder.pages.dev). Installs to the home screen and works offline. Sends deadline reminders. |
| **Calendar feed** | A live `.ics` link for Apple Calendar, Google Calendar or Outlook. |

Data syncs through **Firebase**, each student under their own private sync key. No account or sign-in is needed.

---

## 🌟 Features

- **Finds deadlines automatically.** A local parser reads English and Arabic keywords (*quiz*, *assignment*, *midterm*, *كويز*, *واجب*, *امتحان*) and dates such as `Oct 15`, `18/10/2026` or `next Sunday`. Optional AI steps handle vague or long announcements (see Settings and AI Keys below).
- **Monthly calendar and deadline list.** Monday-first grid, tasks sorted by time within each day, and a day view with the full announcement, room, grade weight and your notes.
- **Course schedule matching.** When an announcement does not name a room or time, Blackboarder fills it in from your weekly class schedule.
- **Grade weights.** Shows how much each deliverable counts (for example *Midterm 25%*) on cards and in the calendar.
- **Marks from the Blackboard gradebook.** Every scan reads your gradebook and puts each mark on its deadline. A **Marks** card lists them by course, newest first.
- **GPA.** Each course's grade so far on the University of Sharjah scale and a projected GPA weighted by credit hours. Credit hours are set per course in Settings > Courses.
- **Syllabus progress.** For each course, how much of the syllabus weight is done, pending, or not announced yet.
- **Add deadlines quickly.** The course field lists your courses and narrows as you type. Closing the popup while adding or editing a deadline, or in Settings, reopens right there.
- **Quick links.** One-tap links to marks, attendance, study plan, library and your own custom links, synced to the phone.
- **Reminders before deadlines.** The phone app reminds you a set time before each deadline, again shortly before, and when it is due (timings in Settings > Alerts).
- **Privacy tools.** Delete everything stored online under your sync key from Settings > Data, download a recovery file for your key, and see a banner when your Blackboard session has ended.
- **Private sync.** Every install gets its own sync key (`BBS-` plus 26 random characters). Changes on the laptop show up on the phone and the other way round.
- **Dark mode** for the extension, the phone app, and Blackboard itself.
- **Activity filter**: a bar on Blackboard's Activity page shows only the courses and kinds of item you pick (Exams & quizzes, Assignments & labs, Grades, Materials, Announcements), and keeps loading older items while a filter is on.
- **Course colours on Blackboard**: each course keeps the colour you set in Blackboarder on Blackboard too (Activity, calendar, Grades, Messages, the course banner and tabs). New courses start with Blackboard's own colour.
- **Updates itself from GitHub**, the way a Chrome Web Store extension would (see [Automatic updates](#-automatic-updates)).

---

## 🚀 Quick Start & Installation

Works in **Chrome, Edge, Brave, Opera and Vivaldi**.

### 1. Get the files

- **GitHub Release (Recommended):** Download **[`blackboarder-extension.zip`](https://github.com/yvs1n/blackboarder-extension/releases/latest)** from the latest release and unzip it somewhere permanent (for example `Documents\blackboarder`). Do not delete the folder afterwards; the browser loads the extension from it.
- **With git:** `git clone https://github.com/yvs1n/blackboarder-extension.git` (loads from `dist/`).

You do not need to build anything; everything is precompiled.

### 2. Load the extension

1. Open your browser's extensions page: `chrome://extensions`, `edge://extensions` or `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (or the **`dist`** folder if using git).
4. Pin **Blackboarder** to the toolbar.

### 3. Turn on automatic updates (once)

- **Windows:** double-click **`update.bat`** in the project folder.
- **macOS / Linux:** run `./update.sh` in the project folder.

This registers a small helper that lets the extension update itself whenever a new version is published here. Then go back to the extensions page and click the reload arrow on Blackboarder once. Your tasks, courses and sync key are kept.

### 4. Use it

1. Open Blackboard (for UOS: `https://elearning.sharjah.ac.ae/ultra/stream`).
2. Click the floating **Scan Blackboard** button (the lightning bolt at the bottom right), or press **Alt+B** (**Option+Shift+B** on Mac) to open the popup.
3. To keep Blackboarder open next to the page, open it in the browser's **side panel**.

---

## 📱 Phone App and Calendar

The phone app is at **`https://blackboarder.pages.dev/companion/`**. The site root, `blackboarder.pages.dev`, is the project's landing page.

1. Open the phone app and add it to your home screen: **Share > Add to Home Screen** on iPhone, or **Install app** in Chrome on Android.
2. In the extension, open **Settings > Sync** and click **Show Pairing QR Code**.
3. In the phone app, tap **Scan QR** (in the Setup Guide or **Settings > Sync**) and point the camera at the code. It pairs with your sync key, AI included, and loads your deadlines. No camera? Click **Copy Phone Pairing Link** instead and open it on the phone, or paste it into the sync key box.
4. To get deadlines in your calendar, click **Copy WebCal Feed Link** in Settings (or **Subscribe** in the phone app):
   - **Apple Calendar:** opening the `webcal://` link asks to subscribe.
   - **Google Calendar:** on a computer, go to **Other calendars > + > From URL** and paste the `https://.../feed.ics?key=...` link.

The calendar link includes your sync key. Links without a key are rejected, so if an old subscription stops updating, copy the link again and re-subscribe.

---

## ⚙️ Settings and AI Keys

No API key? The built-in parser reads announcements automatically, so everything works without one. A key only adds an AI model for long or vague announcements. Set the model and key in the **extension** (Settings > Scanning); the phone app uses the same one and never holds the key.

| Setting | What it is for | Default |
| :--- | :--- | :--- |
| **AI provider** | OpenRouter, IFM K2 Horizon (free daily tokens from platform.ifm.ai), or any OpenAI-compatible API (base URL and model name). Each keeps its own key, and **Test connection** checks it | OpenRouter |
| **API key** | AI extraction for long or vague announcements | Empty (optional) |
| **AI model** | Model used through OpenRouter | `google/gemini-3.8-flash` |
| **Auto-scan** | Scans announcements when a Blackboard page loads | On |
| **Theme** | Light, dark, or match the system | Match the system |

---

## 🔄 Automatic Updates

Once `update.bat` / `update.sh` has run, the extension checks this repository every 15 minutes. The helper downloads the new build into the extension folder, and the extension restarts once its popup and side panel are closed. **In a git clone** the helper runs `git pull --ff-only` instead, and only when the clone is on `main` with no uncommitted changes, so it never overwrites your work. Otherwise **Settings** shows why it skipped.

Each build is identified by a hash of its files, so a change that does not touch the extension does not update it.

---

## 🧪 Development

```bash
npm install        # install dependencies
npm run build      # build dist/ and sync versions
npm run lint       # type-check plus style, JSON and version-sync checks
npm test           # run the Vitest suite
npm run package    # build the release zip into release/
```

This repository is published from a private source repository, so changes made directly here are overwritten by the next publish. Bug reports and ideas are welcome as issues.

- **Source:** `src/` (TypeScript), `public/` (manifest and icons), `updater/` (update helper).
- **Generated:** `dist/`, the `version.json` files and `src/buildInfo.ts`.

[`AGENTS.md`](AGENTS.md) lists what is where and the rules the code follows.

---

## 📂 Project Structure

```text
blackboarder-extension/
|-- src/                  Extension source (TypeScript)
|   |-- popup/            Popup and side panel
|   |-- content/          Scraper and dark mode for Blackboard pages
|   |-- background/       Background worker: sync, reminders, automatic updates
|   |-- engine/           Deadline detection: local parser, then an optional AI model
|   |-- core/             Courses, weights, schedules
|   `-- utils/            Storage, Firebase sync, calendar, task merging
|
|-- dist/                 Built extension; load this folder (generated)
|-- updater/              Update helper (copied into dist/ by the build)
|-- update.bat, update.sh Turn on automatic updates (run once)
|-- public/               Extension manifest template and icons
|-- scripts/              Build, lint and packaging scripts
|-- tests/                Automated tests
|-- docs/                 Install guide
|
|-- CHANGELOG.md          Release notes
`-- AGENTS.md             Project map and rules for contributors and coding agents
```

**Guides:** [Install the extension](docs/INSTALL_EXTENSION.md)

---

## 📄 License

The extension is open source under the [MIT License](LICENSE). The phone app and website at blackboarder.pages.dev are a separate hosted service.
