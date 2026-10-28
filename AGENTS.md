# Blackboarder

Student companion for Blackboard Learn, built at the University of Sharjah (`elearning.sharjah.ac.ae`) and set up for any university. It reads announcements and the gradebook, turns them into deadlines and marks, and shows them in a Chrome extension. A phone web app (hosted separately at blackboarder.pages.dev) syncs with it through Firebase.

This repository is the open-source extension only. It is published from a private source repository, so edits made directly here are overwritten by the next publish. This file holds what stays true. It has no change log and no bug history.

## Commands

```
npm run build     # build dist/; also stamps version and test count
npm run lint      # type-check, style, JSON and version-sync checks
npm test          # Vitest
npm run package   # release zip into release/
```

Run `npm run lint` and `npm test` before every commit. Generated files (`dist/`, `version.json`, `src/buildInfo.ts`) come from a fresh `npm run build`.

## What is where

- `src/core/`: courses, schedule, room and weight rules, syllabus data. Single source of truth for course logic.
- `src/engine/`: deadline extraction. Local regex first, then a keyword check, then an optional AI model (no key means the built-in parser's answer stands). The provider (OpenRouter, IFM, or a custom OpenAI-compatible URL) is chosen in `src/engine/aiProviders.ts`; content scripts reach it through the service worker.
- `src/utils/`: storage, Firebase sync, task merge, gradebook marks (marks drop when submitted, explicit points agree with maxScore via sanitizeTaskMarks), GPA and syllabus-progress lists, announcement merge, stream parsing.
- `src/content/scraper.ts`: runs on Blackboard pages and the Banner Student Exam Page (`StudentExamPage`, parsed by `src/core/examSchedule.ts`). Scans announcements, the Ultra stream (`POST /learn/api/v1/streams/ultra`), linked gradebook assessment columns (`gradebookColumnsToTasks`), the exam schedule table and the gradebook, then saves tasks. After a Scan the student starts on Blackboard (or directly over HTTP from the popup via `src/background/httpScanner.ts` when no Blackboard tab is open), the service worker fetches the university's `examSchedulePage` over HTTP with credentials (`src/background/examRefresh.ts`, zero tabs opened, at most hourly unless a full re-scan, never for automatic scans), and the result joins the scan message (signed out of Banner says so). Each existing exam task takes at most one row, nearest date first, so two midterms keep their own deadlines.
- `src/content/activityFilter.ts`: the course and type filter bar on the Activity page.
- `src/background/`: service worker (alarms, badge, sync, update checks).
- `src/popup/`: extension popup and side panel (plain TypeScript, no framework).
- `updater/`: the native messaging helper that updates the extension (`update.bat`, `update.sh` register it).
- `public/`: manifest template and icons.
- Store build: `npm run build` also writes `dist-store/` (and `npm run package` makes `blackboarder-extension-store.zip`) with `__STORE_BUILD__` true (`src/utils/storeBuild.ts`): no updater, no `nativeMessaging` or GitHub permissions. That is the file for the Chrome Web Store and Edge Add-ons.
- University: presets in `src/core/universities.ts` (grading scale, Blackboard hosts, built-in quick links: UOS only, a new install starts with none), picked in the walkthrough or Settings > General, or set by the first scan from the Blackboard address. Saved as the profile (`src/core/studentProfile.ts`) and synced. Other Blackboard addresses are added there with `optional_host_permissions` (`src/utils/blackboardSites.ts`).
- Popup tabs: Calendar, Deadlines, Courses. The calendar grid divides its fixed height evenly via `--cal-rows` (`grid-template-rows: repeat(var(--cal-rows, 5), minmax(0, 1fr))`) and maintains the exact same height and width across 4, 5, and 6 row months. Settings sections: General, Sync, Calendar, Alerts, Data, Updates, Scanning, the same order and card names as the phone app (minus Scanning); keep them matching.
- Course import (Courses > Import File): `src/core/documentText.ts` reads PDF (pdf.js in `dist/vendor/pdfjs/`, copied from `pdfjs-dist` by the build, loaded only when needed), Word .docx and text on the device; `src/core/courseDocument.ts` finds courses, class times and weights; an AI, when set up, goes first (`src/engine/aiCourseImport.ts`).
- Class reminders: `src/core/classSchedule.ts` and the `bbs_class_reminder` alarm. Settings > Calendar > Show My Classes (`showClassesInCalendar`) hides classes in the popup calendar. Calendar link (`src/core/calendarLink.ts`): `show=deadlines|classes|both` and `tz`.
- Privacy tools: Settings > Data > Delete My Online Data (`deleteSyncDataFromFirebase`), Settings > Sync > Download Recovery File, and a popup banner when the Blackboard session ends (`src/utils/sessionStatus.ts`).

## Rules

1. **Never `fetch('/...')` from the content script.** Blackboard sets `<base href>` to a CDN, so relative paths 404. Use `bbFetch()`.
2. **Never put `\b` around Arabic text in a regex.** JavaScript's `\b` only sees ASCII letters.
3. **Never overwrite tasks the student made or edited** (`userEdited`, `extractedBy: 'manual'`).
4. **Save tasks with `saveTasksMergingLatest`** when a save can race a scan, the popup or the phone.
5. **Bump `updatedAt` only when something really changed.** Every bump triggers a sync.
6. **Real faults use `console.error`; expected situations use `console.info`.**
7. **Two colours only** (near-black and near-white, plus greys), no gradients, `border-radius: 0 !important`, no em-dashes anywhere. Course colours and the red/amber stats numbers are the only exceptions.
8. **Never break sync isolation**: every Firebase read and write is scoped to `users/{syncKey}`. Sync keys are `BBS-` plus 26 characters (older keys of 8 or more characters still work).
9. **No secrets in the repo.** Never commit backups, API keys or sync keys. Tests use made-up values.
10. **Firebase object keys cannot contain `. $ # [ ] /`.** Maps keyed by task id go through `encodeCloudKeys` when written and `decodeCloudKeys` when read.
11. **Always bump the version and log changes.** Every update must bump `version` in `package.json`, record changes in `CHANGELOG.md` under the new version header, and commit as `yxsinja <62697781+yas-star@users.noreply.github.com>`. Never commit with bot or AI assistant imprints, and never push changes under an existing version.

## Verifying changes

- Unit tests cover logic. For popup UI, load the built `dist/` popup in a browser with a stubbed `chrome` object and look at it.
- The content script only runs on a signed-in Blackboard. Read-only checks of the gradebook endpoints are fine; never change anything on Blackboard.
