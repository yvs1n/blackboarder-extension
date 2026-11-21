# Changelog

All notable changes to the Blackboarder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.8.33] - 2026-11-21

### Fixed

- **Enrolled Course Auto-Registration Beyond UOS 7-Digit Codes (`src/core/blackboardColors.ts`, `src/scan/blackboardApi.ts`, `src/content/courseColorPainter.ts`, `src/utils/storage/coursesStorage.ts`, `src/content/activityFilter.ts`):** `parseMemberships()` now extracts alphanumeric subject codes (such as `RES691` from `RES691_SEP26` and `DTC001`) alongside 7-digit UOS catalogue numbers, `discoveredCoursesWithColors()` and `autoRegisterDiscoveredCourses()` keep all real enrolled Blackboard memberships (even without an undergraduate catalogue number) so every enrolled course registers instead of stopping at `1 Course`, `isOrientationOrSandboxCourse()` filters `Library Essentials` guides, and `activityCourseLabel()` strips external-ID prefixes (`RES691_SEP26 - ...`) so courses do not create duplicate stream filter chips.

### Added

- **Flexible Postgraduate & Non-Credit Hour Weighting (`src/utils/gpa.ts`, `src/core/userCourses.ts`, `src/core/semesters.ts`, `src/core/targetGpa.ts`, `src/core/courseDocument.ts`, `src/core/courseImportView.ts`, `src/popup/index.html`, `mobile-web/companion/index.html`, `src/popup/modules/coursesView.ts`, `src/mobile/app/11-courses-editor.js`):** Supported `0` to `60` credit hours (`0.5` steps) across Course Editor, syllabus import, GPA/CGPA, and Target Grade calculations, preserving explicit `0`-credit non-GPA courses (e.g. Doctoral Training Centre or workshops) instead of silently defaulting them to `3` credit hours.

---

## [1.8.32] - 2026-11-21

### Fixed

- **Extension Release ZIP URL & Missing Manifest Prevention (`src/utils/updateChecker.ts`, `updater/blackboarder-updater.ps1`):** Switched `GITHUB_ZIP_URL` from GitHub's source repository archive (`archive/refs/heads/main.zip`, where `manifest.json` sits inside `dist/`) to the packaged release asset (`releases/latest/download/blackboarder-extension.zip`) so downloading/extracting the extension ZIP always puts `manifest.json` at the folder root, and hardened `Remove-StaleExtensionFiles` to never run without `manifest.json` present.
- **Windows Auto-Update Host Registration & Error Visibility (`updater/blackboarder-updater.ps1`, `src/background/autoUpdate.ts`, `src/utils/updateBanner.ts`, `mobile-web/index.html`, `mobile-web/landing-motion.js`, `docs/INSTALL_EXTENSION.md`):** Resolved canonical NTFS segment casing when computing unpacked extension IDs, added Chrome Beta/Dev/Vivaldi/Opera registry and profile lookup, surfaced helper update failures directly instead of falling back to ZIP download prompts, and made Step 03 explicit about running `update.bat` / `update.sh` once for unattended updates.

---

## [1.8.31] - 2026-11-21

### Added


---

## [1.8.30] - 2026-11-21

### Added

- **British University in Dubai (`buid`) Preset (`src/core/universities.ts`, `public/manifest.json`, `scripts/build.js`, `src/utils/blackboardSites.ts`):** Added built-in support for BUiD (`blackboard.buid.ac.ae`, `*.buid.ac.ae`) across manifest permissions, dark mode, page/HTTP scanning, Safari Userscript matching, and GPA mapping.

### Fixed

- **"Other university" (`other`) Session Detection & University of Sharjah Login Fallback (`src/background/httpScanner.ts`, `src/background/scanOrchestrator.ts`, `src/popup/modules/scanBanner.ts`, `src/popup/modules/settingsWalkthrough.ts`, `src/popup/modules/dayDrawer.ts`, `src/popup/universitySettings.ts`):** Fixed `resolveBlackboardOrigin()` and UI **Open Blackboard** actions so choosing "Other university" never falls back to `elearning.sharjah.ac.ae` or triggers UOS session-expired errors. Scanning now infers the active/open Blackboard tab origin (including direct `activeTab` injection for custom LMS domains), opens custom Blackboard URL settings when none is configured yet, clears stale session warnings on university switches, and records unknown hosts as `'other'` rather than `'uos'`.

---

## [1.8.29] - 2026-11-21

### Changed

- **Instant View & Modal Switching (`src/popup/styles/05-modals-weights.css`, `src/mobile/styles/01-header-layout.css`, `src/mobile/styles/06-drawers-modals.css`):** Removed `panelFadeIn`, `sectionFadeIn`, `modalFadeIn`, and `modalIn` entry animations so switched sections and opened modals render on the exact same frame as the button `.active` highlight with zero delay.

---

## [1.8.28] - 2026-11-21

### Changed

- **Add Custom Deadline Modal in Extension (`src/popup/index.html`, `src/popup/modules/navigation.ts`, `src/popup/modules/overlayController.ts`, `src/popup/popupDraft.ts`):** Converted `#view-add` into a floating `#modal-add-task` dialog matching Companion PWA, opening over the currently active tab (Calendar, Deadlines, Marks, Courses, Payments, or Settings), keeping `#btn-add-modal` highlighted while open, supporting Escape/backdrop dismissal, and preserving typed draft fields plus underlying tab state across popup closes.

### Fixed

- **Unpaid Fees Banner Width & Wrapping (`src/popup/styles/12-payments.css`, `src/mobile/styles/11-payments.css`):** Aligned `#deadlines-payments-strip` to the `14px` horizontal inset of `.controls-bar` and task cards in the extension Deadlines tab, and switched `.payments-strip-text` to `flex: 1 1 auto; min-width: 0; display: block;` so fee summary text wraps cleanly alongside the Payments button.

---

## [1.8.27] - 2026-11-21

### Changed

- **Active Header Button Highlights (`src/popup/modules/navigation.ts`, `src/mobile/app/14-modals-actions.js`):** Extended the active inverted highlight (`.active` white button in dark mode / dark button in light mode, matching Payments) to both **Settings** (`#btn-settings-toggle`) and **Add Custom Deadline** (`#btn-add-modal` / `#btn-web-add`).

---

## [1.8.26] - 2026-11-20

### Added

- **Ignore / Include Mark Toggle in Marks Tab (`src/types.ts`, `src/utils/marks.ts`, `src/utils/gpa.ts`, `src/utils/grades.ts`, `src/popup/marksViewController.ts`, `src/mobile/app/10-marks-tracker.js`):** Every mark row (including Blackboard gradebook columns and bonus rows) now has an Ignore button (eye icon) to exclude duplicate or aggregate columns (such as "Out of 55" or "CourseWork without Bonus") from GPA, course percentage, target grade planning, and syllabus progress calculations while keeping the row visible with an `Ignored` pill and Undo toast across extension, Companion PWA, cloud Vault sync, and future gradebook scans.

---

## [1.8.25] - 2026-11-20

### Changed

- **Instant Hover on Non-CTA Controls (`src/popup/styles/11-design-marks.css`, `src/mobile/styles/09-onboarding-design.css`):** Removed hover color/border transition delays from all secondary buttons, tabs, icon buttons, calendar tiles, task cards, filter/course/quick-link chips, and accordion headers so hover states respond instantaneously, reserving smooth hover transitions strictly for the primary CTA buttons with the 3D offset lift.

---

## [1.8.24] - 2026-11-20

### Fixed

- **Locked Desktop Extension Popup Dimensions Across All Menus (`src/popup/styles/02-base.css`, `src/popup/styles/05-modals-weights.css`):** Scoped `< 480px` mobile popup responsiveness strictly to touch screens (`(max-width: 479px) and (pointer: coarse)`), locked `html` min/max height to `600px`, and gave `.popup-views-scroll` and `.view-panel` explicit `width: 100%` so desktop popups never shrink horizontally or vertically when switching to Finance/Payments or any other tab.
- **Persistent Drafts When Adding or Editing Financial Deadlines (`src/popup/popupDraft.ts`, `src/popup/modules/paymentsView.ts`, `src/popup/modules/navigation.ts`):** Closing the extension while adding or editing an item inside `#modal-payment` now preserves the open modal, edit target ID, and all unsaved form fields across reopens identically to academic deadlines.

---

## [1.8.23] - 2026-11-20

### Changed

- **Unified Swiss Grid Design System (`docs/DESIGN_SYSTEM.md`, `mobile-web/index.html`, `src/popup/styles/`, `src/mobile/styles/`, `src/userscript/overlayUi.ts`, `src/content/content.css`):** Updated `DESIGN_SYSTEM.md` from the landing page tokens and unified light/dark surfaces (`--bg`, `--bg-alt`, `--surface`, `--surface-elevated`, `--surface-hover`), borders (`#e2e8f0` / `#cbd5e1` light, `#2c2c36` / `#3f3f4c` dark), typography stacks (`Inter Tight`, `Inter`, `--font-mono`), and primary accent tokens (`#18181b` / `#f4f4f6`) across Landing Page, Extension, Companion PWA, Blackboard floating pill, and Safari Userscript overlay.
- **Landing Page Scroll Reveal Animations (`mobile-web/index.html`, `mobile-web/landing-motion.js`):** Added `IntersectionObserver` scroll-reveal choreography (`bb-reveal` / `is-in`) with subtle staggered entrances for feature grids, workbench panels, device preview cards, adaptive install steps, FAQs, and closing panels while respecting `prefers-reduced-motion`.

---

## [1.8.22] - 2026-11-20

### Added

- **Android Mobile Extension Support (`public/manifest.json`, `scripts/build.js`, `scripts/package.js`, `src/popup/styles/`):** Added `gecko_android` (`>= 120.0`) and `data_collection_permissions` metadata, dedicated `dist-firefox/` and `release/blackboarder-android-firefox.zip` builds stripping Chromium-only `sidePanel` / `nativeMessaging` permissions, and `@media (max-width: 479px)` responsive popup sizing for Firefox for Android, Edge Android, and Quetta.
- **iPhone & iPad Standalone Safari Userscript (`src/userscript/`, `mobile-web/blackboarder.user.js`):** Built a free open-source Userscript bundle (zero Apple Developer account required) reusing Blackboarder's DOM/REST scanner, dark mode, course color painter, activity filter, and AES-256-GCM encrypted Firebase Vault sync so iPhone and iPad Safari users can scan Blackboard directly on mobile and sync live into the Companion PWA.
- **Device-Adaptive Install Section on Landing Page (`mobile-web/index.html`, `mobile-web/landing-motion.js`):** `#install` now auto-detects Desktop, Android, and iPhone/iPad visitors (with a manual 3-platform switcher locked to constant height for zero layout shift) and dynamically adapts both the hero CTA and install steps to guide users cleanly into their platform's scanner and the Companion PWA.

---

## [1.8.21] - 2026-11-20

### Changed

- **CTA-Only 3D Button Offset Animation (`src/popup/styles/11-design-marks.css`, `src/mobile/styles/09-onboarding-design.css`):** Scoped the Swiss tactile 3D offset hover/press animation exclusively to primary CTA buttons (`.btn-scan-main`, `.btn-primary`, `.btn-primary-action`, `.btn-save-action`) with crisp `0.12s` response, keeping secondary, card-row, and icon buttons flat and instant in both the extension and companion while leaving the landing page unchanged.

---

## [1.8.20] - 2026-11-20

### Restored

- **Swiss Tactile 3D Button Offset Animation (`src/popup/styles/11-design-marks.css`, `src/mobile/styles/09-onboarding-design.css`):** Restored the Swiss 3D hard-offset hover/press animation (`translate(-1.5px, -1.5px)` with crisp `2px 2px 0 var(--text-subtle)` offset shadow, snapping flush on `:active` and guarded by `@media (hover: hover)` and `prefers-reduced-motion: reduce)`) across action buttons in both the extension and web companion while keeping the dark-mode contrast fixes intact.

---

## [1.8.19] - 2026-11-20

### Fixed

- **Extension & Companion Button Hover Contrast (`src/popup/styles/`, `src/mobile/styles/`):** Fixed hardcoded light-mode hover fills (`#f1f5f9`, `#fff`, `#f4f4f5`, `#cbd5e1`) on `.task-card-footer .btn-card-action:hover`, `.btn-card-delete`, `.btn-danger:hover`, `.selected-day-item:hover`, `.btn-drawer-close:hover`, and mobile `.btn-card-action:hover` / `.filter-chip:hover` that overrode dark-mode tokens and painted white text on a white background when hovering Share, Edit, or Delete buttons. Removed the 3D button offset transform from inside the compact extension popup and companion app while keeping it on the landing page.
- **Payment & Fee Deadline Modal Submission (`src/popup/modules/paymentsView.ts`, `src/popup/index.html`, `src/mobile/app/17-payments.js`, `mobile-web/companion/index.html`):** Fixed `openPaymentModal` formatting `YYYY-MM-DD` instead of `YYYY-MM-DDTHH:mm` for `<input type="datetime-local" id="payment-due-date">` and fixed `form-payment` submit appending a duplicate `T23:59:00` suffix onto `datetime-local` values (which threw `RangeError: Invalid time value` and prevented saving financial deadlines). Normalized bare portal domains (`banner.sharjah.ac.ae` -> `https://banner.sharjah.ac.ae`) so optional portal URLs never block submission.

### Changed

- **Explicit State Machines & Storage Helper Reuse (`src/popup/modules/`, `src/mobile/app/`, `src/utils/`):** Added explicit finite state machines (`createStateMachine`) for extension update actions (`updateActionMachine` in `settingsUpdates.ts`), syllabus/schedule course importing (`courseImportMachine` in `courseImporter.ts`), AI announcement extraction (`aiExtractMachine` in `aiExtractModal.ts`), mobile QR camera scanning (`qrScanner.machine` in `00-state.js`), cloud scan request polling (`cloudScanMachine` in `12-settings.js`), and Web Companion self-updates (`webUpdateMachine` in `03-boot-sw.js`), while removing the duplicate `Escape` key listener in `13-modals-init.js` that closed the underlying Day Sheet when dismissing a nested modal. Refactored `paymentsStorage.ts` and `semestersStorage.ts` to reuse `src/utils/storage/env.ts` helpers behind the `src/utils/storage.ts` barrel.

---

## [1.8.18] - 2026-11-20

### Fixed

- **Windows Widget Self-Updater File Lock Resilience (`windows-widget/SelfUpdater.cs`):** Fixed `Access to the path is denied.` during in-app updates when an older process is still running from a locked `.exe.old` image or when the executable folder restricts temporary file writes. Downloads now stream into `%LOCALAPPDATA%\Blackboarder\updates` with live percentage progress (`IProgress<string>`), normalize `.exe.old*` process paths back to canonical `BlackboarderWidget.exe`, terminate stale duplicate widget processes before swapping, dynamically pick an unlocked `.old.N` backup slot, and fall back to a detached post-exit `cmd.exe` swap helper if an in-place move is ever blocked.

### Changed

- **Windows Widget Responsive Layout & 60fps Live Preview (`windows-widget/SettingsForm.cs`, `windows-widget/LiquidGlassRenderer.cs`, `windows-widget/TrayApplicationContext.cs`):** Added `UpdateResponsiveLayout()` so all left-column cards, inputs, trackbars, and wrapped status labels dynamically adapt to the available scroll client width on window resize, maximize, and DPI scaling without vertical scrollbar overlap, while scaling the right Live Real-Time Preview frame proportionally in 16:9. Added thread-safe in-memory pre-scaled wallpaper bitmap caching and font resolution caching in `LiquidGlassRenderer`, double-buffered `ResizeRedraw` card panels (`BufferedCardPanel`), and a 45ms preview debounce for instant slider interaction.

---

## [1.8.17] - 2026-11-20

### Fixed

- **Windows Widget Background Sync, Self-Update Exit & Error Reporting (`windows-widget/`):** Fixed `TrayApplicationContext.BackgroundAutoUpdateCheckAsync` calling `BeginInvoke` on an uncreated `_contextMenu` handle and releasing the single-instance mutex off-thread (which stranded `v1.8.7` in the tray while relaunched binaries exited as duplicates), added an eager UI-thread marshaler control (`_uiInvoker`), `--wait-pid` handoff, and a UI-thread shutdown watchdog so updates always cleanly restart into the new build. Replaced in-place lockscreen image overwrites and stale render fingerprints with atomic alternating output paths, midnight date-boundary tracking, wallpaper mtime change detection, `MemoryStream` base wallpaper reads, descriptive error formatting (eliminating blank `"Error applying widget:"` dialogs), and a visible error state on the Live Real-Time Preview box.

### Changed

- **Extension & Companion Swiss Linearity (`src/popup/styles/11-design-marks.css`, `src/mobile/styles/09-onboarding-design.css`):** Aligned selection inversion, tabular figures (`tabular-nums`), display title tracking, and tactile Swiss 3D hard-offset hover/press states across primary action buttons in both the extension and companion web app while respecting `prefers-reduced-motion`.
- **Worker Static Caching & Archive Routing (`src/worker/05-router.js`):** Added no-cache HTML rules for `/old/` and clean caching/content-type handling for `/llms.txt` and `/og-preview.png`.

---

## [1.8.13] - 2026-11-18

### Changed

- **Purposeful, Emoji-Free Push & System Notifications (`src/utils/calendar.ts`, `mobile-web/companion/sw.js`, `src/worker/04-web-push.js`, `src/mobile/app/`, `src/background/serviceWorker.ts`):** Removed all decorative emojis from push and desktop notifications and redesigned titles and bodies to surface immediate, high-signal information alongside the app icon/badge: exact time remaining (`Due in 1h 30m: Quiz 1 · Calculus I` / `Due Now`), full course name and code, assessment type, syllabus weight (`Worth 10% of grade`), bonus or point totals (`25 pts`), exact due schedule (`During class` vs specific time), and room or submission location (`Location: Room W9-102`, `Location: In-class assessment`, `Submission: Online on Blackboard`, or `Portal: University Finance / Payment Portal`).

---

## [1.8.12] - 2026-11-18

### Fixed

- **Extension In-App Update Reliability (`src/background/autoUpdate.ts`, `src/popup/modules/settingsUpdates.ts`, `updater/blackboarder-updater.ps1`):** Clicking **Update now** now triggers an immediate extension reload (`chrome.runtime.reload()`) once new files land on disk instead of waiting for `reloadWhenIdle()` while the popup/side panel is still open, surfaces `'error'`, `'dev-checkout'`, and `'up-to-date'` responses explicitly in toast notifications instead of silently resetting the button, and skips locked or byte-identical self-updater scripts (`updater/host.bat`) during Windows file copies while cache-busting the GitHub ZIP request and cleaning up stale files even on matching-build runs.

---

## [1.8.11] - 2026-11-18

### Fixed

- **Payments View & Modal Visual Parity (`src/popup/`, `src/mobile/`, `mobile-web/companion/`):** Added the missing `10px 14px 20px` view-panel padding to `#view-payments` matching Courses and Marks, aligned `#view-payments` header typography, compact action buttons, and stat boxes with Settings/Courses, switched `#modal-payment` to use the exact `.modal-backdrop` / `.form-label` / `.form-input` / `.form-select` / `.modal-close-btn` classes used by `#modal-edit-task`, and restored `.toggle-control-row` styling on mobile.

---

## [1.8.10] - 2026-11-18

### Fixed

- **Empty Deadlines Strip Visibility (`src/popup/styles/12-payments.css`, `src/mobile/styles/11-payments.css`):** Added `[hidden] { display: none !important; }` rules for `.payments-deadlines-strip` and `.payments-header-badge` so the `display: flex` rule no longer renders an empty bordered strip above the Deadlines list when no unpaid fees exist.

---

## [1.8.9] - 2026-11-18

### Fixed

- **Extension & Web App Auto-Update Reliability (`updater/blackboarder-updater.ps1`, `updater/blackboarder-updater.sh`, `src/mobile/app/03-boot-sw.js`):** Fixed stale bundle pruning in the Windows/macOS/Linux native updaters where `dist/src/` caused built extensions to be skipped as source checkouts, and updated mobile `isUserBusy()` to guard open `.modal-overlay` and `.day-sheet-drawer` dialogs during background reloads.
- **Deadline Scanning & Assessment Naming (`src/utils/streamParser.ts`, `src/engine/localExtractor.ts`, `src/scan/scanPipeline.ts`):** Added `lab` classification and `toEnglishDeadlineTitle` normalization for stream deadlines, preserved multi-word `Lab Report` and hyphenated (`Quiz-2`, `Assignment-1`) titles during local extraction, and upgraded bare announcement titles when stream cards carry specific names.
- **Payments Category Saving, Portal Labels, & Design Alignment (`src/popup/`, `src/mobile/`, `mobile-web/companion/`):** Fixed the `<select id="payment-category">` `late_fee` option value, fixed `pt.title` portal button rendering in the web companion, and aligned `#view-payments` and calendar payment cards with the shared two-tone Swiss Grid card/icon/spacing system across extension and mobile.

---

## [1.8.8] - 2026-11-18

### Added

- **Payments & Financial Deadlines Management (`src/core/payments.ts`, `src/popup/modules/paymentsView.ts`, `src/mobile/app/17-payments.js`):** Added a dedicated Payments section accessible from the header in both the Chrome extension and the companion web app without crowding the four main navigation tabs, complete with verified UOS Student Account / Tahseel portal links, step-by-step payment channels, published Fall/Spring installment presets, currency totals, and due-soon / overdue summaries.
- **Calendar, Reminders, ICS Feed, & Encrypted Cloud Sync Integration (`src/utils/paymentsStorage.ts`, `src/utils/vaultCrypto.ts`, `src/background/serviceWorker.ts`, `src/worker/`):** Projected unpaid financial deadlines onto the Calendar, Day Drawer, Deadlines tab (with a quick summary banner), RFC 5545 `/feed.ics` calendar subscriptions, extension badge/notifications, and Web Push cron alerts (toggleable per device), sealed end-to-end inside the Zero-Knowledge Vault with tombstone-aware sync merges.
- **Banner Finance Portal Page Scanner (`src/core/financePageParser.ts`, `src/content/scraper.ts`):** Added safe DOM table extraction on signed-in student finance summary pages to import installments and due dates without guessing unverified university APIs.

---

## [1.8.7] - 2026-11-16

### Added

- **Unified Activity Stream Preloader & Smarter Course Filter (`src/content/activityFilter.ts`, `src/content/blackboard-dark.js`):** Replaced Blackboard's default Activity loading flicker with a unified Swiss Grid preloader from `document_start` until courses and notification batches finish loading in the background, seeded course chips immediately from active enrollments, and excluded non-academic tiles (Orientation, University).
- **Bonus Marks & Bonus Deadlines with Target Selection and Quick Score Entry (`src/popup/`, `src/mobile/`, `src/utils/marks.ts`, `src/utils/grades.ts`):** Added pure points vs. percentage (`%`) bonus selection, **Bonus On What** category targeting (`Course Total` or any syllabus component), optional due-date linking from Add Bonus Mark so bonus quizzes appear in Calendar & Deadlines, optional quick score entry on completing manual assessments (`+ Score`), and bonus mark deletion with instant Undo in both extension and companion app.
- **Modularity & Accessibility Hardening (`scripts/lint-check.js`, `src/content/`, `src/core/`, `src/engine/`, `src/popup/modules/marksModals.ts`, `src/utils/taskMarkSanitize.ts`):** Split oversized modules so every `.ts`, `.js`, and `.css` source file stays `<= 800` lines, enforced the modularity limit in `lint-check.js`, removed dead code, and upgraded interactive labels and controls across modals and content UI.

### Changed

- **Windows & Cross-Platform Widget Design Alignment (`windows-widget/`, `widgets/`, `src/worker/01-widgets-wallpaper.js`):** Aligned Windows native desktop/lock-screen widgets, SVG/Android cards, and iOS Scriptable widgets with the Blackboarder Swiss Grid and frosted Liquid Glass visual spec.

### Fixed

- **Quiz Instruction Merging, Gradebook Protection, & Chronological Marks Ordering (`src/scan/scanPipeline.ts`, `src/engine/localDateTime.ts`, `src/utils/taskMerge.ts`, `src/utils/marks.ts`):** Merged undated and topic-listing quiz announcements cleanly onto matching deadlines without duplicates, fixed HTML line-break and ordinal/multi-date extraction edge cases, prevented bonus tasks from matching or deleting official Blackboard gradebook marks, and stopped re-scanned gradebook marks without due dates from jumping above newer assessments in Marks.

---

## [1.8.6] - 2026-11-15

### Added

- **Windows Widget Automatic Self-Update (`windows-widget/SelfUpdater.cs`, `windows-widget/TrayApplicationContext.cs`, `windows-widget/SettingsForm.cs`):** Added automatic GitHub Releases self-updating for `BlackboarderWidget.exe` (`yvs1n/blackboarder-extension/releases/latest`), checking on startup and every 3 hours when idle, validating the downloaded PE executable size and MZ header, swapping the in-use binary safely on NTFS, relaunching automatically, and providing an **Auto-Update** toggle plus **Check for Updates** action in both Settings and the system tray menu. Synchronized `<Version>` in `BlackboarderWidget.csproj` with `package.json` during `npm run build`.

---

## [1.8.5] - 2026-11-15

### Changed

- **Pure Neutral Black Liquid Glass Widgets (`widgets/blackboarder-widget.js`, `src/worker/05-router.js`, `src/worker/01-widgets-wallpaper.js`, `windows-widget/`):** Removed the dark blue background tint (`#0F172A` / `#070A12`) across iOS Scriptable, Android/SVG, and Windows widgets in favor of neutral pure black glass (`#000000`) with Apple Liquid Glass optical specular highlights and crisp edge rims.
- **Windows Glass Transparency Slider (`windows-widget/AppConfig.cs`, `windows-widget/SettingsForm.cs`, `windows-widget/LiquidGlassRenderer.cs`):** Added a **Glass Transparency** slider (`0%` to `100%`, default `68%`) and unlocked `0px–40px` blur control so users can dial Windows widgets all the way to crystal-clear iPhone Liquid Glass with optical rim refraction and readable shadowed typography.

---

## [1.8.4] - 2026-11-14

### Fixed

- **Windows Widget Crash & Hang Fix (`windows-widget/`):** Fixed a WinForms UI-thread deadlock when loading Settings live preview (`SettingsForm.RenderLivePreviewAsync`), guarded Gaussian blur dimensions against small-bitmap out-of-bounds reads (`FastBlurEngine`), added deterministic theme fingerprinting (`SyncEngine`), protected background power/session handlers, and wired global unhandled exception logging to `crash.log` (`Program.cs`).
- **Windows Widget Student ID Header (`windows-widget/SyncEngine.cs`, `windows-widget/SettingsForm.cs`):** Passed `profile` from `/api/tasks` and offline `tasks_cache.json` through to `LiquidGlassRenderer.RenderWidget` and live preview so `Blackboarder • <studentId>` renders consistently on desktop, lock screen, and mobile.

### Changed

- **Website-Synced Auto-Updating Widgets for Mobile & Windows (`src/worker/05-router.js`, `src/mobile/app/12-settings.js`, `widgets/blackboarder-widget.js`, `windows-widget/`):** Added shared `widgetConfig` schema on `/api/tasks` and `/api/widget-config` so theme colors, glass opacities, spacing, radii, and copy update live from website deployments and cache offline on both platforms. Updated iOS Scriptable **Copy Widget Script** to copy a tiny one-time loader that fetches and caches `/companion/widget.js` locally on the iPhone (`blackboarder_cache/widget_code.js`) so users never need to re-paste on widget updates.

---

## [1.8.3] - 2026-11-14

### Added

- **Windows Desktop Companion Release Packaging (`windows-widget/`, `export/extension/workflows/release.yml`):** Added the .NET 8 `BlackboarderWidget` Windows desktop and lock screen companion source into `windows-widget/` and updated the public release workflow to compile and attach `BlackboarderWidget.exe` on every GitHub release so in-app download links work without 404 errors.

### Changed

- **Documentation, Landing Page, & Guide Alignment (`README.md`, `export/extension/README.md`, `docs/`, `AGENTS.md`, `mobile-web/index.html`):** Updated installation, quick-start, and FAQ docs across both repositories and the landing page to point to **Settings > Updates** (**Automatic Updates** & **Show Changelog After Update** toggles) instead of the old manual `update.bat` / `update.sh` setup step, fixed the desktop widget reference to **Settings > General**, and removed stale wallpaper / shortcut copy.

---

## [1.8.2] - 2026-11-14

### Added

- **Automatic Updates Toggle & Auto-Install (`src/background/autoUpdate.ts`, `src/popup/modules/settingsUpdates.ts`):** Added an **Automatic Updates** switch (`#setting-auto-update`, enabled by default) in **Settings > Updates** so new GitHub builds download automatically through the updater helper and reload when idle, or pause at **Update Available** when disabled.
- **Post-Update Changelog Popup & Settings Toggle:** Embedded release highlights from `CHANGELOG.md` into `BUILD_INFO` (`scripts/build.js`), added a **Show Changelog After Update** toggle (`#setting-show-changelog`), added a collapsible **What's New** section (`#details-ext-changelog`) in **Settings > Updates**, and added the `#modal-changelog` summary dialog shown on first popup open after an update.

### Changed

- **Complete Old-File Cleanup on Extension Update (`updater/blackboarder-updater.ps1`, `updater/blackboarder-updater.sh`):** Swept the extension install directory during updates (when not a git/source checkout) to delete all stale files not in the incoming `version.json` manifest (including old hashed Vite bundles) and remove empty subdirectories.
- **Widget Active-Task Filtering & iOS Large Capacity (`widgets/blackboarder-widget.js`, `src/worker/01-widgets-wallpaper.js`):** Excluded tasks marked as done from desktop and mobile widgets, aligned Windows widget styling with mobile frosted glass cards, and increased the iOS Large Scriptable widget limit to show more upcoming deadlines.

### Removed

- **Dead Files & Obsolete Feature Artifacts:** Deleted unused `scripts/package-mac-app.py`, `mobile-web/Blackboarder-Mac.zip`, `mobile-web/install-mac.sh`, `mobile-web/widgets/`, `widgets/ios/README.md`, and `docs/syllabus/README.md`, and trimmed obsolete Apple Shortcuts / wallpaper URL handlers from companion scripts and docs.

---

## [1.8.1] - 2026-11-14

### Changed

- **Widget Visual Alignment & Hierarchy Across iOS and Windows:**
  - Restored preferred frosted liquid-glass aesthetic in iOS Scriptable widget (`widgets/blackboarder-widget.js`) with course color accent bars, header with student ID, and summary pill (`2 Quizzes • 1 HW • 1 Exam`).
  - Aligned assessment text hierarchy across iOS Scriptable and Windows/desktop widget (`src/worker/01-widgets-wallpaper.js`): assessment title displayed in large bold text on top, with course name and room number in small secondary text underneath.
  - Standardized status indicators (due day on top, due time or `✓ Done` on bottom) across mobile and desktop widgets.
- **Mobile Companion Settings Streamlining:**
  - Removed obsolete wallpaper URL section from the companion app (`mobile-web/companion/`).
  - Adapted widget setup dynamically to the student's detected device model (Scriptable for iOS, Google Play Web Widget & KWGT for Android).
- **Extension Desktop Companion Setup:**
  - Moved desktop companion app setup to **Settings > General** (`#settings-page-general`) in the extension and removed widget cards from Calendar settings.
  - Automatically identifies whether the user is on Windows or macOS, displaying download and setup instructions exclusively for their active operating system.

---

## [1.8.0] - 2026-11-13 (Milestone Release)

### Added

- **Modular Extension Popup, Storage, Companion App, and Worker Architecture:**
  - Decomposed `src/popup/popup.ts` and `src/popup/popup.css` into focused modules under `src/popup/modules/` (18 files including split `settingsSync.ts`, `settingsUpdates.ts`, `settingsWalkthrough.ts`, and `overlayController.ts`) and `src/popup/styles/` (11 cascade-ordered stylesheets).
  - Decomposed `src/utils/storage.ts` into single-purpose submodules under `src/utils/storage/` (`env.ts`, `settingsStorage.ts`, `tasksStorage.ts`, `scanStorage.ts`, `quickLinksStorage.ts`, `coursesStorage.ts`) behind a backwards-compatible `storage.ts` barrel export.
  - Decomposed `mobile-web/companion/app.js`, `mobile-web/companion/styles.css`, and `mobile-web/_worker.js` into modular sources under `src/mobile/app/`, `src/mobile/styles/`, and `src/worker/`, assembled deterministically during `npm run build` and `npm run bundle:worker`.
- **Shared Explicit State Machine Primitives (`src/core/stateMachine.ts`, exported in `BBCore`):** Added zero-dependency `createStateMachine()` and `createArmedAction()` helpers with validated transition tables so UI workflows cannot enter invalid states or leave dangling timers.
- **Popup Overlay Stack & Companion Global `Escape` Dismissal:** Unified modal and Day Drawer lifecycle management in `src/popup/modules/overlayController.ts` with strict LIFO overlay stacking and automatic focus restoration, plus `closeTopMobileOverlay()` in `src/mobile/app/00-state.js`.
- **Multi-Platform Liquid Glass Widgets & Dynamic Wallpapers:** Introduced cross-platform frosted glass widgets and dynamic wallpaper automation across iOS, Android, macOS, and Windows:
  - **iPhone and iPad (iOS):** Live vector SVG dynamic wallpaper generation (`/api/wallpaper?key=...`) automated via Apple Shortcuts, with course color pills, strike-throughs for finished tasks, and pending counters; updated Scriptable accessory widgets with active task filtering and completion checkmarks.
  - **Android:** Instant Live Web Widget frosted glass cards (`/widget?key=...`), KWGT custom widget integration (`widgets/android/blackboarder-kwgt.json`), and lock screen dynamic wallpaper automation.
  - **Windows and Mac Desktop:** Native Windows 11/10 companion application (`BlackboarderWidget.exe`) connecting via personal Sync Key; high-resolution desktop dynamic wallpaper generation (`/api/wallpaper?key=...&w=...&h=...&pos=bottom`) automated via macOS Shortcuts.
  - **Hardware & Device Detection Engine (`src/core/deviceDetection.ts`):** Automatically detects user hardware (iPhone models from 16 Pro Max to SE, Android manufacturers, MacBook Pro/Air and iMac display bounds, Windows PCs) to adapt Settings > Calendar and the post-pairing onboarding wizard with tailored quick-copy buttons and platform guides.

### Changed

- **Smooth 60fps Popup Scrolling:** Moved extension popup scrolling into a dedicated flex viewport shell (`.popup-views-scroll`), eliminated `position: sticky` header thrashing, replaced `content-visibility: auto` height estimation jitter with `contain: layout style paint`, and removed costly card `box-shadow` hover repaints.
- **Explicit Scan Banner & Two-Step Cloud Delete Machines:** Replaced implicit DOM class/timer checks in `src/popup/modules/scanBanner.ts` with an explicit `scanUiMachine` (`idle | scanning | cancelling | succeeded | failed`), and replaced `deleteArmedTimer` on `#btn-delete-cloud-data` with `createArmedAction`.
- **Unified Action Button Styling:** Standardized `.btn-secondary` and `.btn-card-action` across light and dark themes to match the bordered `.btn-outline-action` aesthetic used by Copy Phone Pairing Link.
- **Chronological Marks Sorting:** Completed assessments and tasks in the Grades card are now ranked from newest to oldest by posting, due, or completion date (`dueDate`, `submittedAt`, `completedAt`, `createdAt`), rather than by when the mark was released.
- **Documentation & Landing Page Accuracy:** Corrected phone app URLs (`blackboarder.pages.dev/companion/`), Firefox extension helper path (`about:debugging#/runtime/this-firefox`), performance implementation details, settings tab labels, and modular file trees across `README.md`, `export/extension/README.md`, `AGENTS.md`, `docs/`, and `mobile-web/index.html`.
- **Companion Desktop Extension Parity & Fixed Calendar Shape:** Updated the desktop Companion view (`>= 641px`) to share the extension's 4-tab sections bar (Calendar, Deadlines, Marks, Courses) and header action order (`Refresh`, `+`, `Settings`), while keeping the `900px+` two-column dashboard (fixed `496x356` calendar + Up Next on the left beside sticky Deadlines on the right).
- **Streamlined Landing Page Widget Guidance:** Replaced verbose multi-platform installation tabs with an in-panel notice directing users to device-tailored widget guides within the web companion (Settings > Calendar) and browser extension (Settings > Sync).

### Fixed

- **Overlay, Drawer & Timer Races:** Cancelling a scan no longer leaves stale 3.5s reset timers active on rapid re-scans, reopening the Calendar Day Drawer within 220ms of closing no longer hides it mid-transition, and pressing `Escape` closes only the topmost popup overlay (including `#modal-ai-extract` and `#modal-walkthrough`) with module cleanup intact.
- **Shorthand Lab Assessment Matching:** Improved component name matching for shorthand assessment names (e.g. `Q1. Density-Errors`, `R-Density`) to correctly attach scores to their respective course syllabus components.
- **Push Notification Stale Acknowledgment and Foreground Throttling:** Throttled foreground alert toasts and ensured stale past deadlines are acknowledged cleanly without duplicate notifications when opening the app.

---

## [1.7.0] - 2026-11-03 (Milestone Release)

### Added

- **Dedicated Marks Primary Tab:** Introduced a dedicated top-level Marks tab across both the Chrome extension and mobile web companion, sitting cleanly alongside Calendar, Deadlines, and Courses. Unclutters course configuration so students have a focused academic command center.
- **Multi-Semester Academic Journey Tracking:** Full multi-term academic tracking allowing students to snapshot active terms into archived semester records (compact credit summaries or full task archives), switch between historical semesters, and review transcript history.
- **Automated Semester Partitioning ("Organize Terms"):** Automatically partitions enrolled course lists returned by Blackboard by detecting Banner term codes (e.g. `_2510`, `_2520`, `_2610`) and seasonal markers, keeping current coursework active while archiving past terms with a single click.
- **Cumulative CGPA & Scholarship Retention Predictor:** Added scholarship retention target planning that reverse-calculates the exact semester Term SGPA required to achieve or retain university scholarship thresholds based on prior completed credits and starting GPA.
- **Trajectory-Weighted Target GPA Planner:** Analyzes historical course momentum and allocates realistic course targets based on past performance trajectories rather than uniform leaps.
- **Nearest Attainable GPA Auto-Snapping:** Automatically snaps target GPA inputs to the closest mathematically attainable discrete combination on the university scale ($A = 4.0, B+ = 3.5$) and informs the student of the planned target.
- **Collapsible Target Grade Breakdown Accordion:** Redesigned the Target Grade Breakdown into an interactive, collapsible accordion with visual trajectory progress bars, momentum trend badges, upcoming score targets, and interactive chips.
- **Manual Bonus Marks and Extra Credit Tracking:** Added support for manual bonus marks (`isBonus: true`) that add directly to earned course points without inflating syllabus required weight, adjusting target GPA requirements accordingly.
- **Assessment Target Badges Formatted as Percentages:** Upcoming pending assessment cards in both the extension and companion now display clean target badges formatted with explicit percentages (e.g. `[★ Target: 78.9% (B+)]`).
- **Direct Finals and Exam Portal Scanning:** Enhanced exam schedule scanning across Banner Student Exam Pages, university portals, and nested iframes with broad bilingual column recognition.

### Changed

- **Compact Marks and Grades Card Layout:** Dense, scannable course grade presentation matching the Courses tab cards with 3px left color accent borders, subtitle metadata rows, and completion progress bars.
- **Balanced Dual-Column GPA Overview:** Top stat section organized into symmetrical, equal-height Current Academic Standing vs Academic Goal blocks with planned SGPA indicators.
- **Explicit Percentage Display for Predicted Grades:** Displays predicted grades explicitly as percentages across card headers, status lines, target selection chips, and upcoming assessment targets.

### Fixed

- **Completed Assessment "Waiting" Marks Deduplication:** Fixed a bug in `buildMarksSummary` where assessments first recorded as `waiting` or `submitted` with a known syllabus weight and later matched to a graded entry did not accumulate their earned weight into the course total.
- **Target GPA Downward Relaxation & Companion GPA Snapping:** Fixed `calculateTrajectoryTargetPlan` so selecting a target GPA below the current baseline relaxes non-guaranteed courses downward toward the target, synchronized secondary GPA inputs, resolved a `ReferenceError` in `snapTargetGpa` in Term SGPA mode on mobile, and connected `getCurrentTrajectoryPlan` and `snapTargetGpa` to `activeSyllabi`.
- **Popup Semester Persistence & In-Place Task Toggling:** Loaded archived semesters (`bbs_semesters`) on popup startup and storage updates, rendered initial views synchronously before draft restoration, and fixed repeated in-place status toggling in the `All` filter view.
- **Syllabus Table Gutter Detection & Arabic Regex Boundaries:** Prevented two-column syllabus assessment tables from being split vertically by column gutter detection in `documentText.ts`, and removed ASCII `\b` word boundaries around Arabic month names and syllabus keywords in `localExtractor.ts` and `courseDocument.ts`.
- **Restored Missing SVG Sprites:** Added definitions for `#icon-help-circle` and `#icon-award` across extension and companion SVG sprites.
- **Scraper Lifecycle Guard:** Added top-level window guard (`__BBS_SCRAPER_INITIALIZED__`) preventing duplicate MutationObservers, event listeners, or profile badges on extension reloads.
- **Codebase Simplification and Cleanup (Phases 1-3):** Pruned dead code, deduplicated helper functions, consolidated notification logic, and eliminated orphaned test fixtures.

---

## [1.6.0] - 2026-11-01 (Milestone Release)

### Added

- **Strict Read-Only Personal Sync Key Protection:** Locked the personal Sync Key input in extension Settings to read-only by default to guarantee high-entropy 130-bit keys and eliminate risk of cloud data collisions or overwrites.
- **Cloud Account Collision Detection:** Detects existing cloud records before linking custom keys, prompting with an explicit confirmation intercept before any data can be overwritten.
- **New Sync Key Confirmation & Instant Backup Export Modal:** Replaced instant key regeneration with a confirmation modal (`#modal-regen-key-confirm`) offering a one-click full JSON backup export before unlinking devices.
- **Mobile Post-Pairing Setup Onboarding Modal:** Interactive onboarding sheet (`#modal-post-pairing-setup`) appearing immediately after pairing to configure calendar classes, push reminders, calendar feeds, and widget scripts.
- **User-Triggered 1-Click Extension Updates:** Background service worker checks GitHub via lightweight HTTP; when an update is available, an Update Available banner with an "Update now" button automatically pulls or downloads the new release.
- **Hardware-Accelerated CSS View Transitions:** Smooth 120-140ms view transitions with cubic-bezier easing across tab switches, guarded by `prefers-reduced-motion`.
- **Critical Typography Font Preloading:** Preloads Inter and Inter Tight WOFF2 web fonts in the companion web app and extension popup to eliminate Flash of Invisible Text (FOIT).
- **Tactile Micro-Interaction Feedback:** Subtle scale transforms on buttons and interactive chips for instant tactile response.

### Changed

- **Minified Companion Core Bundle:** Production minification for `mobile-web/companion/core.js` reduces file size by 45% (from 261.4 KB to 144.2 KB).
- **Virtualized Rendering with content-visibility:** Applied `content-visibility: auto` to offscreen deadline task cards and agenda items to minimize layout and paint cycles.
- **Debounced Search Filtering:** 100ms debounce on search inputs across extension and companion app to prevent main-thread layout thrashing.
- **Stale-While-Revalidate Service Worker Caching:** Upgraded companion service worker caching strategy for instantaneous (< 15ms) cold app launches.
- **High-Contrast Mobile OLED Toggles:** Distinct slate charcoal track and white slider knob in dark mode for unmistakable active visibility.
- **Redesigned Sync Key Layout:** Symmetrical twin tactile buttons (`Copy Key` and `New Key`) beneath a full-width monospace key display.

### Fixed

- **Automatic Unpairing on Deleted Cloud Keys:** Connected secondary devices detect deleted or reset sync keys during sync and unpair cleanly without resurrecting stale data.
- **Immediate Cloud Fetch on Key Entry:** Entering a sync key immediately triggers a full cloud fetch to pull all academic data into view.
- **Ultra Activity Stream Profile Badge Cleanup:** Mutex and render queue prevent race conditions and duplicate student profile badges during page loads.

---

## [1.5.0] - 2026-10-31 (Milestone Release)

### Added

- **Mozilla Firefox WebExtension Support:** Added `browser_specific_settings.gecko` and `scripts: ["background.js"]` alongside service worker declarations in `manifest.json`, providing native Firefox MV3 support alongside Chromium browsers.
- **Student Identity & Academic Profile Discovery:** Automatic extraction of student name, ID number, email, college, and major from Blackboard REST API (`/users/me`) and Banner exam portals, displaying an academic badge on Blackboard Ultra, popup, and companion app.
- **Liquid Glass Scriptable iOS Widgets:** Redesigned iOS home screen widgets (`widgets/blackboarder-widget.js`) with an obsidian liquid glass aesthetic, dynamic course color accent pills, and up to 8 active deadlines.
- **Cancellable Live Scan Notification Bar:** Clicking the close button (`✕`) on the floating scan banner immediately aborts background HTTP and tab fallback scans, cancels in-flight requests, and resets the interface.
- **Course Filter Bar Scroll Navigation Chevrons:** Interactive horizontal scroll navigation chevron buttons on the course legend bar with `ResizeObserver` dynamic overflow indicators.
- **Unified Full State Backup & Restore in Settings:** Complete state export/import (tasks, courses, colors, schedules, rooms, syllabus weights, quick links, university profile, and alert preferences) in a single JSON file.

### Changed

- **Centralized Deletion Tombstones and UI Utilities:** Unified deletion tombstones in `src/utils/tombstones.ts` and common UI helpers in `src/utils/uiCommon.ts`, shared with companion app via `BBCore`.
- **Dead Code and Markup Pruning:** Removed unreferenced SVG symbol sprites, unused form inputs, and orphaned helper routines, reducing DOM overhead and bundle weight.
- **Doctor Announcement Display Standard:** Standardized announcement quotes into a compact Linear-styled reading card with inline toggle and full reading modal sheet.

### Fixed

- **Companion PWA Startup Calendar Cell Rendering:** Hoisted schedule configuration and resolved startup references to prevent runtime errors during PWA cold launch.
- **Dynamic Calendar Classes Mobile Updates:** Wired companion class toggles to immediately refresh month grids, day sheets, and agenda views.
- **Permanent Duplicate Deadline Elimination:** Fixed task ID mutations during gradebook merges that previously generated duplicate cloud entities.
- **Rescheduling and Completed Task Date Protection:** Due dates and titles of completed or graded tasks are permanently locked against accidental shifts.
- **Space-Separated Course Code Matching:** Generically normalized spaced course codes (e.g. "1502 101" vs "1502101") to prevent cross-course collisions.

---

## [1.4.0] - 2026-10-29 (Milestone Release)

### Added

- **Banner Student Exam Portal Scraping:** Midterms and finals extracted from the university exam schedule page (`StudentExamPage`) with official dates, times, rooms, exam methods, and room overrides.
- **Unified Dual-Scanner Pipeline:** Scans Blackboard over background HTTP first (`httpScanner.ts`), falling back cleanly to tab scanning (`scraper.ts`) when necessary with session `X-Blackboard-XSRF` tokens.
- **PWA Cloud Scan via Firebase Realtime Database:** Trigger full Blackboard scans remotely from the mobile companion web app through Firebase scan requests.
- **Gradebook Unannounced Mark Persistence:** Unannounced grades posted directly to gradebook columns are preserved as completed items with column due dates rather than being discarded or scheduled as fake deadlines for today.
- **Submitted Assessment Mark Safety:** Items marked as submitted without published grades strictly clear scores to prevent premature zero or placeholder display (`sanitizeTaskMarks`).

### Changed

- **Announcement Reading Modal:** Updated announcement inspector to a clean, minimal Swiss Grid layout.
- **Dynamic Assessment Matching:** Replaced hardcoded date filters with generic ordinal and Arabic number normalization.

### Fixed

- **Synthetic Gradebook Deadline Purging:** Permanently removed legacy synthetic completed tasks (`gbmark_` and untimed `gbcol_`) and safely migrated marks to real course tasks (`purgeSyntheticGradebookTasks`).
- **Activity Stream HTTP Parsing with Cookies Permission:** Ensured background HTTP requests to Ultra activity stream include session XSRF tokens from the `BbRouter` cookie.
- **Eliminated Layout Flickering on Reopen:** Popup fetches directly from local storage before initial render, eliminating intermediate visual jumps.
- **Double Scan Notification Deduplication:** Unified background and tab scan completion events into a single toast notification.
- **Popup Save Race Condition Resolution:** All persistence routines utilize `saveTasksMergingLatest` to prevent concurrent edits from overwriting fresh marks.

### Removed

- **Built-in Courses and Hardcoded Syllabus Defaults:** Courses, class schedules, and syllabus weights come solely from student enrollment, file imports, or manual entry.

---

## [1.3.0] - 2026-10-27 (Milestone Release)

### Added

- **Universal Multi-University Architecture:** Built-in presets for University of Sharjah (UOS), UAE University (UAEU), Abu Dhabi University (ADU), Zayed University (ZU), American University in Dubai (AUD), American University of Sharjah (AUS), American University of Ras Al Khaimah (AURAK), and custom university support with customizable grading scales.
- **Document Syllabus & Class Schedule Importer:** Client-side document reader (`src/core/documentText.ts`) parsing PDF (via pdf.js), Word (.docx), and text files into course meeting times, rooms, credit hours, and assessment weight distributions with AI fallback.
- **Class Schedule Reminders & Calendar Visualization:** Meeting times converted into daily calendar classes with configurable advance notification alarms (Settings > Alerts).
- **RFC 5545 WebCal Subscription Feed:** Dynamic calendar feed URL supporting deadlines, classes, or both, converted accurately across time zones with daylight saving time support.

### Changed

- **Unified Courses Management Tab:** Combined course details, class schedules, and syllabus weight breakdowns into a single Courses tab across both extension and companion app.
- **Synchronized 6-Section Settings Layout:** Standardized Settings sections (General, Sync, Calendar, Alerts, Data, Updates) with identical card titles and controls in both apps.

### Fixed

- **Atomic Cloud Synchronization with ETags:** Cloud writes verify ETags and merge concurrent modifications on HTTP 412 Precondition Failed, preventing data loss across multi-device saves.
- **Quick Links Sync by Timestamp:** Quick links carry explicit modification timestamps so newest edits win cleanly.
- **Persistent Note Clearing:** Clearing a task's notes, room, or weight permanently persists across sync cycles without reverting.

---

## [1.2.0] - 2026-10-27 (Milestone Release)

### Added

- **Blackboard Ultra Course Color Injection:** Dynamically repaints Ultra course cards, calendar events, stream bars, and course headers with user-configured course colors (`src/content/courseColorPainter.ts`).
- **Blackboard Ultra Polished Dark Mode:** High-contrast dark theme scoped to `html.bbs-dark-active` replacing Blackboard's default grey mode without altering core layout.
- **Activity Stream Filtering:** Filter bar above the Blackboard Ultra activity stream to filter by course and category (Exams, Assignments, Grades, Materials, Announcements).
- **Instant Camera QR Code Pairing:** Pair mobile devices instantly by scanning a QR code containing the sync key and sealed AI pass (`#ai=...`).
- **Multi-Provider AI Engine:** Configurable AI providers in Settings (OpenRouter, IFM K2 Horizon, or custom OpenAI-compatible endpoints) with sealed key encryption.
- **Dedicated Grades & Projected GPA Summary:** Real-time GPA calculation based on credit hours, course letter conversions, and "best N of M" drop rules.

### Changed

- **Universal Two-Tone Monochrome Theme:** Strict geometric design system with bundled Inter and Inter Tight typography, 0px border-radius, and single solid primary actions.
- **Offline PWA Resilience:** Robust service worker caching allowing offline launching, viewing, and queuing of mutations.

### Security

- **Strict Namespace Isolation:** Synchronizer validates scoped `$syncKey` namespaces, rejecting unauthenticated or root-level requests.
- **Sliding-Window Rate Limiting:** Enforced sliding-window request throttling across API endpoints.
- **Cryptographic High-Entropy Keys:** Upgraded sync keys to 130-bit `BBS-` prefixed high-entropy tokens.

---

## [1.1.0] - 2026-10-21 (Milestone Release)

### Security & Privacy

- **Automatic Sync Key Provisioning:** Unique cryptographically random key generation preventing fallback to shared buckets.
- **Least-Privilege Extension Permissions:** Removed unnecessary permissions from `manifest.json`.

### Design System & Two-Tone Theme

- **Swiss Grid Universal 0px Radius:** Implemented universal `*, *::before, *::after { border-radius: 0 !important; }` across all stylesheets.
- **Monochrome Neutral Two-Tone Theme:** High-contrast monochrome palette (`#18181b` light, `#f4f4f6` dark) replacing legacy neon greens.
- **Typography Standardization:** Eliminated all em-dashes in favor of standard hyphens across documentation and UI text.

### Scraper & Runtime Resilience

- **Scoped Stream Queries:** Optimized DOM selector queries in Ultra stream scrapers.
- **Extension Context Invalidation Recovery:** Graceful recovery and user prompts when extension reloads invalidate content script contexts.

### Code Hygiene & Testing

- **Automated Hygiene Script:** Added `scripts/lint-check.js` verifying compilation, Swiss Grid rules, color compliance, JSON validity, and typography.
- **Comprehensive Test Suite:** 34 test suites verifying sync isolation, course matching, syllabus weights, and calendar feeds.

---

## [1.0.0] - 2026-09-28 (Initial Release)

- **3-Tier Hybrid Extraction Pipeline:** Local regex parsing, keyword classification, and OpenRouter Generative AI deep extraction.
- **Academic Quick Links:** Quick access bar for attendance records, marks portal, and degree audit.
- **Syllabus Grade Tracker:** Weight calculation for assignments, quizzes, and exams.
- **Live RFC 5545 WebCal Feed:** Dynamic `.ics` calendar feed for iOS, macOS, Android, and Outlook.
- **Offline-First PWA:** Mobile web companion app with offline caching and background service worker.
