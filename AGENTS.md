# Blackboarder

Student companion for Blackboard at the University of Sharjah (`elearning.sharjah.ac.ae`). It reads announcements and the gradebook, turns them into deadlines and marks, and shows them in a Chrome extension. A phone web app (hosted separately at blackboarder.pages.dev) syncs with it through Firebase.

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
- `src/utils/`: storage, Firebase sync, task merge, gradebook marks, GPA and syllabus-progress lists, announcement merge, stream parsing.
- `src/content/scraper.ts`: runs on Blackboard pages. Scans announcements, the stream and the gradebook, then saves tasks.
- `src/content/activityFilter.ts`: the course and type filter bar on the Activity page.
- `src/background/`: service worker (alarms, badge, sync, update checks).
- `src/popup/`: extension popup and side panel (plain TypeScript, no framework).
- `updater/`: the native messaging helper that updates the extension (`update.bat`, `update.sh` register it).
- `public/`: manifest template and icons.
- Store build: `npm run build` also writes `dist-store/` (and `npm run package` makes `blackboarder-extension-store.zip`) with `__STORE_BUILD__` true (`src/utils/storeBuild.ts`): no updater, no `nativeMessaging` or GitHub permissions. That is the file for the Chrome Web Store and Edge Add-ons.
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

## Verifying changes

- Unit tests cover logic. For popup UI, load the built `dist/` popup in a browser with a stubbed `chrome` object and look at it.
- The content script only runs on a signed-in Blackboard. Read-only checks of the gradebook endpoints are fine; never change anything on Blackboard.
