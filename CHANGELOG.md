# Changelog

All notable changes to the Blackboarder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
