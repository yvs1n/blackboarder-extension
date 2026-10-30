# Changelog

All notable changes to the Blackboarder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.15] - 2026-10-30

### Fixed

- **Exclusion of orientation courses and noise.** Any course mentioning "orientation" (such as "Student Hands-On Orientation" or Arabic equivalents) is strictly excluded from discovered courses, enrolled courses, user courses, activity stream ingestion, and the Grades and marks cards.
- **CI test cleanliness.** Removed machine-dependent test checking local desktop paths, restoring automated CI builds and public repository export.


### Fixed

- **Permanent elimination of duplicate deadlines.** Fixed task ID mutations where merging reassigned gradebook column IDs over stable announcement task IDs, causing cloud sync to see them as distinct entities and resurrect duplicates. Added automatic deduplication and tombstoning on task persistence.
- **Rescheduling and date protection.** Guarded deadline reschedule logic to never modify due dates or titles of completed or graded tasks, preventing completed quizzes and assignments from being shifted to yesterday.
- **Synthetic gradebook task deduplication.** Prevented gradebook scanning from generating duplicate entries when matching announced or activity stream tasks already exist.
- **Space-separated course code normalization.** Fixed matching for course codes with spaced numbering (e.g. "1502 101" vs "1502101") to prevent cross-course deadline collisions.
- **Course and syllabus data recovery.** Restored full course configurations, credit hours, meeting times, syllabus assessment rules, marks, and clean deadlines to both desktop recovery backup and Firebase cloud sync under BBS-IK0T.

---

## [1.4.13] - 2026-10-29

### Fixed

- **The activity stream is read again over HTTP.** Blackboard refused the stream request with 403 because it carried no XSRF token, so deadlines that only appear on stream cards were missed. Both scanners now send the session's token (`X-Blackboard-XSRF`, from the `BbRouter` cookie) on that request. This needs the `cookies` permission, which Chrome grants without a new prompt.

---

## [1.4.12] - 2026-10-29

### Added

- **Scan fallback.** Every scan tries Blackboard over HTTP first. If Blackboard cannot be reached, or the course list and the activity stream both fail, the scan runs again in a Blackboard tab: the tab that asked, an open one, or a background tab that is opened and closed again. A signed-out session never falls back, and a partial failure says how many courses could not be read.
- **One scan pipeline.** The HTTP scanner and the tab scanner share the same Blackboard readers and the same save steps (`src/scan/`), so a fix lands in both.

### Fixed

- **Auto-scan works again.** The "Auto-scan" setting scans quietly when a Blackboard page loads, at most every 30 minutes. It had no effect since 1.4.10.
- **Phone scan requests are no longer lost.** Every sync from the extension, the phone or the server dropped a pending "Scan Blackboard" request. They now keep it, and a request older than 15 minutes expires instead of waiting forever.
- **Lost updates between devices.** Cloud writes use Firebase ETags, so a write that raced another device is merged again and retried.
- **The server no longer wipes data.** A cloud copy with no deadlines was read as empty, and the next server sync deleted courses, quick links and deletion records. A failed read now refuses to write, and a refused write is reported as a failure instead of success.
- **Real marks dated October 28 are kept.** Hardcoded dates in the gradebook cleanup removed any student's real completed item due on 2026-10-28 or 2026-10-29. The cleanup no longer changes the tasks it checks, and deletions it makes are recorded on this device too.
- **No more doubled deadlines ("Quiz 2, Quiz 2").** The same deadline from the HTTP scan and the page scan showed twice when the two named its course differently ("PHYS 101 - Physics I" and "Physics I") or one gave no course. Course names are now compared without codes in front or sections after, and a copy with no course merges only with the same title on the same day.
- **Lighter background checks.** The extension checks for a phone scan request by reading only that request every minute, instead of downloading all synced data.
- **Sync key kept out of calendars.** The calendar subscription name no longer shows the sync key.
- **Server checks.** The sync API checks sizes and shapes, accepts only known task states, blocks more private addresses for custom AI URLs, and never falls back to the database root without a sync key.

### Removed

- **Built-in courses and syllabus data.** There are no default courses, class schedules, syllabus weights, course colours or Blackboard course ids built in any more. Courses come only from your enrolment list, file import or manual entry; saved courses are kept. Reset Courses now clears the list for every university.

---

## [1.4.11] - 2026-10-29

### Fixed

- **Instant settings persistence.** In the extension popup, all setting controls (toolbar badge, notification window, midnight sync, scan sync, background auto-scan, personal sync key) now save immediately on change with confirmation feedback, ensuring no settings changes are lost when closing the popup.
- **Guaranteed released mark badge on deadline cards.** Deadline cards in both the extension and mobile companion app now consistently display the grade badge whenever a released numeric score is present or the task is graded, falling back to a clean score fraction when custom scoreDisplay formatting is absent.
- **Coursework grade update linking.** Hardened `findAllTasksForUpdate` in `streamParser.ts` to attach released gradebook marks to announced deadline tasks (e.g. attaching "Quiz 3 - Projectile Motion" to "3rd quiz", or "EAP Midterm Exam" to "Midterm worth 25%") through shared assessment numbering and exam keywords within the same course.

---

## [1.4.10] - 2026-10-29

### Added

- **PWA cloud scan via Firebase Realtime Database.** Students can now trigger full Blackboard scans directly from the mobile companion web app under Sync settings. The request dispatches a pending scan request to Firebase, where the connected extension service worker detects it, runs background HTTP scanning, saves fresh tasks, and updates the mobile app.

### Fixed

- **Pure HTTP background scanning.** Scans now run 100% via background HTTP requests (RUN_HTTP_SCAN) without querying browser tabs, injecting scrapers, or running MutationObserver loops in Blackboard tabs, preventing race conditions and duplicated tasks.
- **Quiz and assessment deduplication across types.** Updated reTasksDuplicates and uildGpaSummary to merge assessment items matching on sequence numbers (e.g. 3rd quiz and Quiz 3) or normalized core titles regardless of type differences (quiz vs ssignment), preserving marks and eliminating duplicate entries in task lists and GPA quota drop lists.
---

## [1.4.9] - 2026-10-29

### Fixed

- **Eliminated mark disappearing and layout flickering on reopen.** In the extension popup, `initApp` now fetches directly from `chrome.storage.local` before the initial view render instead of rendering stale `localStorage` first, eliminating intermediate visual state changes and flickering when opening and closing the extension.
- **Removed fake calendar deadlines for yesterday and today.** Unannounced gradebook marks (`sourceSnippet: 'gradebook'` and synthetic `gbcol_` entries) now strictly use empty due dates (`dueDate: ''`) and are filtered out of calendar day cells and day drawers, keeping the calendar clean and dedicated exclusively to student deadlines.
- **Seamless announcement matching for exams with stated weights.** Titles like "Midterm worth 25%" now normalize cleanly to "midterm" without treating "worth 25%" as a 25-point limit (`maxScore`), allowing official gradebook columns ("EAP Midterm Exam" 20/20) to attach directly to the announced midterm task without generating duplicate entries or phantom dropped quiz rows.

---

## [1.4.8] - 2026-10-29

### Fixed

- **Gradebook mark persistence across popup sessions.** Exempted gradebook items (`sourceSnippet: 'gradebook'`, `gradeSourceId`, and `submissionStatus: 'graded'`) from `isValidTask` filtering, allowing legitimate unannounced marks (e.g. "Graded Item", "Participation", "Quiz 1 Grade") with empty due dates to persist cleanly through popup load and background refresh.
- **Cloud sanitization support for unannounced marks.** Updated `sanitizeCloudTasks` in `src/utils/cloudSanitize.ts` to permit empty `dueDate: ''` on tasks originating from the gradebook, ensuring unannounced marks are retained across Firebase sync cycles without being dropped.
- **Safe deduplication and sorting with empty due dates.** Hardened `isDuplicateCandidate` and `mergeCloudTasks` in `src/utils/taskMerge.ts` against empty due dates, eliminating `RangeError` from `.toISOString()` and `NaN` comparisons during sorting.
- **Popup lifecycle safety.** Replaced unmerged `saveTasks` calls with `saveTasksMergingLatest` during synthetic task purging in `src/popup/popup.ts`, and guarded schedule time resolution against empty due dates.

## [1.4.7] - 2026-10-29

### Fixed

- **Dynamic assessment matching without hardcoded values.** Completely removed all hardcoded date filters and course-specific titles. Core title matching (`coreTitle`) now generically normalizes exam titles (midterm, final) and delivery modes (in-class, online, paper, take-home, bonus) across all courses, and expands Arabic assessment matching to handle both ordinals (الاول through العاشر) and digit numbers (واجب 1, كويز 2, تقرير 3, مشروع 1).
- **100% gradebook mark synchronization.** Resolved missing marks in the Grades card (Courses tab) for assessments posted directly to Blackboard gradebook columns without an announcement. Unannounced gradebook marks are preserved as completed items with their official column due date (or empty if none) and `sourceSnippet: 'gradebook'`, allowing full synchronization into the Marks section and GPA without creating fake deadlines on the calendar for "today".
- **Deduplicated GPA components and drop list.** Eliminated duplicated assessment entries in the GPA calculation and dropped-items breakdown (e.g. "Quizzes: not counted Quiz 1 90%, Quiz 1 90%") by deduplicating graded course tasks in `buildGpaSummary` across matching `gradeSourceId`, `coreTitle`, and assessment numbers.

## [1.4.6] - 2026-10-29

### Fixed

- **Purged October 28 synthetic gradebook deadlines.** Eliminated the 21 synthetic completed tasks created by the previous synthesis pass on October 28. `purgeSyntheticGradebookTasks` targets tasks with `gbmark_`, completed `gbcol_` tasks on October 28, and duplicate exam columns. Purged tasks are tombstoned immediately in local storage, the companion phone app, and cloud sync.
- **Removed gradebook column injection into task lists.** Removed the injection loops in `scraper.ts` and `httpScanner.ts` that pushed unannounced gradebook columns into direct deadlines. Gradebook columns are now strictly used to read grades and marks via `gradebookToUpdates`, never synthesized as calendar deadlines.
- **Eliminated duplicate midterm rows.** Resolved duplicate midterm entries (e.g. "EAP Midterm Exam" and "Midterm" in English for Academic Purposes) by purging the synthetic gradebook column task and safely transferring its 20 / 20 grade onto the student's real midterm deadline task.

---

## [1.4.5] - 2026-10-28

### Fixed

- **Purged synthetic gradebook deadline tasks.** Gradebook columns without announcements or student due dates are no longer synthesized into fake deadline tasks scheduled for today. Added `purgeSyntheticGradebookTasks` to permanently delete any previously generated synthetic tasks (`id` prefixed with `gbmark_` or untimed `gbcol_`) across local storage, companion web app, and cloud sync tombstones, while safely transferring marks to real matching course tasks.
- **Deduplicated midterm exams in grades and deadlines.** Streamlined course assessment titles so prefixed variations like "EAP Midterm Exam" and "Midterm" normalize to the same core title. Midterm rows in the Grades summary are deduplicated per course, merging earned scores so the legitimate midterm score (e.g. 20 / 20) is preserved as a single row.

---

## [1.4.4] - 2026-10-28

### Fixed

- **Unannounced gradebook marks permanently saved.** Gradebook marks recorded directly in Blackboard without an announcement or linked Ultra assessment content item are automatically synthesized into completed tasks (`createTasksForUnmatchedMarks`) with resolved syllabus weights and course assignments, preventing scan marks from being discarded.
- **Race condition in popup persistence fixed.** `persistTasksInBackground`, `addTask`, `updateTask`, and task action event handlers now use `saveTasksMergingLatest` instead of `saveTasks`, preventing concurrent user edits in the popup from wiping out marks written by background scans.
- **Marked items strictly ranked newest to oldest.** In `buildMarksSummary` (the Grades card) and the Deadlines tab, marked and completed items are ranked descending (newest first, oldest last) using the mark's recording timestamp (`gradedAt`), falling back to `dueDate` and `submittedAt`, ensuring newly received marks appear at the top.

---

## [1.4.3] - 2026-10-28

### Changed

- **Documentation & feature sync.** Synchronized all project documentation files (`README.md`, `export/extension/README.md`, `AGENTS.md`, and `export/extension/AGENTS.md`) to document submitted assessment mark safety rules, and updated `scripts/build.js` to automatically synchronize public extension templates on every build.

---

## [1.4.2] - 2026-10-28

### Fixed

- **Submitted assessments never show fabricated or stale marks.** Sync merges (`mergeCloudTasks`), local storage loads, gradebook updates, and task card badges now strictly clear `score`, `maxScore`, and `scoreDisplay` whenever `submissionStatus` is `'submitted'` (not `'graded'`), preventing ungraded assignments or research papers (such as `واجب (10 درجات)` and `البحث العلمي (واجب جماعي) 15 درجة`) from displaying `10 / 10` or cross-matched `6 / 10` scores.
- **Submission receipt cards never extract title points as scores.** Stream submission cards containing point labels in the assessment title no longer parse those numbers as earned marks.
- **Arabic research extension announcements deduplicate with gradebook columns.** Deadline extension announcements (such as `تمديد فترة تسليم البحث العلمي ومحاولات التسليم`) normalize and merge cleanly with their corresponding `project` gradebook column (`15%`) instead of appearing as a separate graded assignment.
- **Public extension repository CI and release sync.** Removed local filesystem dependencies from tests and improved commit resolution in `scripts/build.js` so automated builds, public extension syncs, and GitHub Releases run cleanly under `yxsinja`.

---

## [1.4.1] - 2026-10-28

### Added

- **Background exam schedule scan.** The exam schedule page is now scanned directly over HTTP with credentials, without opening background browser tabs.

### Fixed

- **Post-exam review and viewing announcements filtered.** Announcements regarding post-exam paper reviews, Akkindi answer sheet checks, and grade viewing sessions are no longer falsely extracted as upcoming exam deadlines.
- **Submitted assessments mark safety.** Items marked as submitted in the gradebook (such as term papers or research projects) without published scores are accurately preserved as submitted without spurious zero or mock scores.
- **Early graded homework auto-completion.** Homework and assignments with released grades are automatically marked as completed, even when their due date is far in the future.
- **Ordinal assessment deduplication.** Matches and merges ordinal and numeric assessment titles across announcements and gradebooks (e.g. "Quiz 2" and "2nd Quiz", "واجب 1" and "الواجب الأول").

### Changed

- **Announcement details view.** Announcement reading modal updated to a clean, minimal Linear styling consistent with the rest of the app.

---

## [1.4.0] - 2026-10-28

### Added

- **Exam schedule.** Midterms and finals come from your university's exam schedule page (UOS: the Banner Student Exam Page) with their date, time, room, exam method and any room override, and take their syllabus weight. Press Scan on that page, or just press Scan on Blackboard: it now also reads the exam page in a background tab and closes it again (at most once an hour; a full re-scan always reads it). If you are signed out of Banner, the scan message says so.
- **AURAK.** The American University of Ras Al Khaimah is in the university list, with its grading scale from the 2023-2024 catalog (A from 95%).

### Fixed

- **Two midterms in one course** each keep their own deadline; before, both exam rows could land on the same one.
- **Calendar grid** keeps the same height and width in 4, 5 and 6 week months.

### Changed

- **Finding the phone app.** The landing page and the pairing help now give the address, blackboarder.pages.dev/companion, and say it is a web app, so there is nothing to look for in the App Store.

---

## [1.3.4] - 2026-10-27

### Changed

- **One place for courses on the phone.** The phone's Courses tab no longer has the separate Class Schedule and Syllabus Grade Distribution cards. Like the extension, each course in **My Courses** shows its code, CRN, credit hours, class times and mark breakdown, and you edit all of it there.
- **Quick links start empty.** Every student's links are different, so a new install has none and you add your own. UOS students get the UOS links filled in when the university is set (picked or found by a scan), since those are the only ones checked to be right. The "+ Attendance" style buttons no longer fill in a UOS address for other universities.

### Fixed

- **Nothing is lost when two devices save.** Every save to the cloud now reads the cloud copy first and merges it: the newer copy of each deadline wins, deleted deadlines stay deleted, and the newer course list, quick links and university choice win. Before, a course edit in the extension or a save from the phone could overwrite a change the other device had just made. If the cloud cannot be read, nothing is overwritten (the phone tries again later).
- **Quick links sync by date.** Quick links now carry a last-changed date, so the newer list wins instead of whichever device saved last.
- **A cleared note stays cleared.** Emptying a deadline's note, room or weight no longer brings the old value back on the next sync.
- **Changing the sync key on the phone** no longer keeps the old key's courses or quick links date, which could block the new key's courses.

---

## [1.3.3] - 2026-10-27

### Changed

- **Grades live in the Courses tab.** The Marks and GPA cards are now one **Grades** card: your projected GPA, then each course's grade so far with every mark under it. It sits at the top of the Courses tab with **Syllabus Progress**, in the extension and the phone app, so the Deadlines tab is just deadlines. Each card stays open or closed as you left it.
- **Clearer GPA points.** Under each course, "3.0 points" now reads like "B = 3.0 of 4.0 GPA points", and "38% of 46.7% graded" reads "38 of 46.7 marks so far".
- **Courses tab fits the extension.** The tab has margins like the other tabs, course names are no longer cut short (the code, CRN and credit hours sit on a line below), and the card text is shorter.

---

## [1.3.2] - 2026-10-27

### Fixed

- **Deadlines no longer disappear on the phone after visiting Settings.** The Settings section tabs share the look of the Pending / All / Completed filters, and tapping one (General, Sync and so on) also set the deadline filter to nothing, so Deadlines showed "No Matching Deadlines" until the app was reopened.
- **"In 2 days" counts calendar days.** A deadline on Thursday seen on Tuesday evening said "in 1 days"; it now says "in 2 days", and one day away is "in 1 day".

### Changed

- **Up-to-date guides.** The landing page, setup guides, README and docs describe the university choice, the Courses tab and Import File, classes on the calendar and in the calendar link, and the new Settings layout. The landing page's search data now carries the current version.

---

## [1.3.1] - 2026-10-27

### Added

- **Show My Classes switch.** Settings > Calendar > Blackboarder Calendar, in the extension and the phone app, turns the day's classes in Blackboarder's calendar on or off. It takes effect straight away and is kept on that device. Class reminders have their own setting in Alerts.

### Changed

- **Calendar Link Shows.** The calendar link's choice is now labelled Calendar Link Shows, since it only changes what the subscription link shows in Apple, Google or Outlook Calendar, not Blackboarder's own calendar.

---

## [1.3.0] - 2026-10-27

### Added

- **Any university.** Pick your university in the setup guide or Settings > General (UOS, UAEU, ADU, ZU, AUD, AUS or Other), or scan any Blackboard page and it is set from the address. It sets the GPA grading scale, which you can edit, and the quick links. A Blackboard address that is not built in can be added there; the browser asks for that one site.
- **Import your syllabus or class schedule.** Courses > Import File reads a PDF, Word (.docx) or text file, or pasted text, on your device and fills in courses, class times, rooms, credit hours and assessment weights. You check and correct each course before saving, and can still add or edit courses by hand. With an AI set up, it reads the file first and the built-in reader is the fallback. Saved courses sync to your other devices.
- **Class reminders and today's classes.** A reminder a set time before each class (Settings > Alerts, 15 minutes by default, or off), on the extension and the phone, and your classes for the day on the calendar.
- **Classes in your calendar app.** Settings > Calendar now asks what the calendar link shows: deadlines and classes, deadlines only, or the class schedule only. Class times follow your time zone, including daylight saving. Links copied before keep showing deadlines only.

### Changed

- **Courses tab.** Courses, class times and the mark breakdown are one tab in both apps, called Courses (it was Schedule on the phone and Settings > Courses in the extension), with Add Course and Import File at the top and quick links below.
- **Same layout in the extension and the phone app.** Main tabs Calendar, Deadlines, Courses. Settings sections General, Sync, Calendar, Alerts, Data, Updates in the same order (the extension adds Scanning last), with the same card names and button labels: the calendar link has its own Calendar section, Backup & Data and Updates have their own sections on the phone, and Replay Setup Guide sits in Appearance & Help on both.

---

## [1.2.9] - 2026-10-27

### Fixed

- **The Scan button no longer spins forever.** Blackboard pages run a quiet scan on load and while the stream scrolls. Pressing Scan during one was dropped without a word, so the popup kept showing "Scanning" even though the scan had finished and saved the marks. Now the press joins the running scan, which reports its result to the popup; a full re-scan asked for meanwhile runs right after it. The popup also resets the button once the tab says no scan is running, in case a scan ends without reporting.

---

## [1.2.8] - 2026-10-27

### Fixed

- **A mark posted before the exam date no longer stays hidden forever.** Blackboard gives no grade dates, so a gradebook column already graded before an exam's date was set aside as a practice run, permanently. That is how the English midterm (EAP Midterm Exam, 20 / 20) never reached the Midterm deadline. Once the exam's date has passed, such a column is used when the deadline has no other mark; if another column turns up later, it takes over.

---

## [1.2.7] - 2026-10-27

### Fixed

- **Presentation tasks made by older scans are removed**, on the extension and the phone, unless you made or edited them yourself. New scans already skipped them.
- **Student notes a scan wrote no longer come back.** Older scans put the AI's summary of the announcement into a task's notes; syncing kept restoring it from the other device's copy. Notes are now kept only on tasks you made or edited, everywhere they are read or merged.
- **Long gradebooks are read in full.** Every page of a course's gradebook columns and grades is read, not only the first.

### Added

- **Gradebook report.** Each scan keeps a short list, on this device only, of every grade the course gradebooks returned and why any was not read, to explain a mark that does not arrive.

---

## [1.2.6] - 2026-10-27

### Changed

- **The scan message says when a gradebook grade could not be read.** A grade that sits in a course's gradebook but is hidden, not released, calculated, exempt, or has no number is now named with the reason (for example "Midterm Exam (hidden in the gradebook)"), instead of being skipped silently.

---

## [1.2.5] - 2026-10-27

### Added

- **Edit your courses from the phone.** The Schedule tab has a **My Courses** card: add a course, or edit its name, code, CRN, credit hours, colour, keywords, weekly meeting times and rooms, and mark breakdown, or delete it. These are the same fields as in the extension, and changes sync both ways.

### Fixed

- **A midterm grade could stay missing after an earlier, undated column was applied.** When two gradebook columns fit one exam (a practice run and the real one), the one Blackboard dated as graded last now wins. A column refused because it looked graded before the exam is tried again once the exam's date is corrected.

---

## [1.2.4] - 2026-10-27

### Fixed

- **Presentation dates are no longer added as deadlines**, by the built-in parser or the AI.
- **An announcement explaining how an exam will go no longer adds the exam again.** If the course already has that exam (midterm, final or a numbered exam), the announcement updates it instead of making a second one, and does not move its date.
- **Student notes stay yours.** The AI no longer copies its summary of an announcement into a task's notes. Notes it already filled in on tasks you never edited are cleared the next time the popup opens.

---

## [1.2.3] - 2026-10-27

### Changed

- **Simpler Sync settings.** The "Advanced Server & Endpoints" box is gone. The two switches that were inside it, **Auto-sync every day at 12:00 AM midnight** and **Auto-push to mobile after scanning Blackboard**, now sit on the Sync page. Everyone already syncs through the standard online service, so the optional own-sync-server field and the web dashboard address field are removed; the extension always pairs with blackboarder.pages.dev.
- **Fewer permissions.** The extension no longer asks for access to every `pages.dev` and `workers.dev` site, only to `blackboarder.pages.dev`.

---

## [1.2.2] - 2026-10-27

### Added

- **Delete My Online Data.** Settings > Data has a button that erases everything stored online under your sync key (deadlines, courses, quick links, the encrypted AI key and your phone's reminder subscription) and gives you a new sync key. Two clicks, since it cannot be undone. Your deadlines stay on the device, and your phone needs to be paired again.
- **A banner when your Blackboard session ends.** If a scan finds you signed out of Blackboard, the popup shows a hard-edged banner with a warning icon and an **Open Blackboard** button until a scan finds you signed in again. The scan message says so too, instead of only "gradebook not readable".
- **Recovery file.** Settings > Sync has **Download Recovery File**, a small text file with your sync key, so you can get your online deadlines back after clearing the browser or changing computers.
- **Store build.** Every build now also makes `dist-store/` and `blackboarder-extension-store.zip`: the same extension without the self-updater (no update helper, no native messaging permission, no GitHub access), for the Chrome Web Store and Edge Add-ons, which update extensions themselves. In that build the Updates page says updates come from the store.

### Changed

- **New sync keys are much longer**: `BBS-` plus 26 characters (130 bits) instead of 10 (50 bits), so they cannot be guessed. Keys you already have keep working; press New Key to switch to a long one, then pair your phone again.

---

## [1.2.1] - 2026-10-25

### Changed

- **The extension now lives in its own repository**, `yvs1n/blackboarder-extension`. Automatic updates, the update helper and the download link all point there. Installed copies move over on their own; a git clone made from the old address should be cloned again from the new one.
- **Docs and links** now point to the new repository, and the phone app and website are served only from blackboarder.pages.dev.

---

## [1.2.0] - 2026-10-25

### Changed

- **Blackboard shows your course colours.** Each course now looks the same on Blackboard as in Blackboarder: the Activity stream bars, calendar events, Grades and Messages tiles, and inside a course the banner and the selected tab all use the colour you set for that course, and change straight away when you change it. Blackboard's colours no longer jump around when new announcements arrive. The first scan reads the colour Blackboard gives each course and uses it for courses Blackboarder did not know yet; courses you already have keep their colour. Courses you have not set up keep Blackboard's colour.
- **Blackboard dark mode, polished.** Pages are near-black instead of grey (the extension no longer switches on Blackboard's own unfinished dark mode), the selected menu item, calendar switches (Schedule / Due Dates, Day / Month) and the selected day are clearly marked, field labels no longer sit on dark patches, grade pills have readable dark text, the new-announcement count is light on dark, and the Grades page's empty boxes are a quiet dashed outline instead of bright stripes. Hovering an Activity item no longer turns it near-white, so its text and icon stay readable.

- **Quick Links use line icons.** Each Quick Link category (Attendance, Study Plan, Marks, Portal, other links) now has its own line icon in the extension and the phone app, instead of an emoji or a coloured dot. Category badges are plain grey, in line with the two-colour design.
- **The floating Scan Blackboard button is just a lightning bolt.** On Blackboard pages the bottom-right button is now a small square bolt icon with no text (hover for "Scan Blackboard"; it also works with the keyboard). Scan results show the bolt icon instead of an emoji.

### Added

- **Filter Blackboard's Activity page.** A bar above the Activity list lets you show only some courses (each in its own colour) and some kinds of item: Exams & quizzes, Assignments & labs, Grades, Materials and Announcements. Pick several in a row to see any of them. Items are sorted by what they say, so a "Final_2025.pdf" upload counts as an exam and "Exp. (08)" as a lab. While a filter is on, Blackboard keeps loading older items until the screen is filled or everything is loaded, so short filtered lists still fill in. Your choice is remembered.
- **Pair by scanning a QR code.** The extension's Settings > Sync has **Show Pairing QR Code**, and the phone app has **Scan QR** (Settings > Sync and the Setup Guide). Scanning pairs the phone with your sync key and AI pass, with nothing to copy or type, and works in iPhone home screen apps too. The phone uses the browser's own QR reader where there is one (Android) and a bundled reader (jsQR) on iPhone, loaded only when the scanner opens. The QR code carries the AI pass, so only show it to your own phone.
- **GPA card.** The extension and the phone app now show each course's grade so far on the University of Sharjah scale (A 90+ is 4.0, B+ 85+ is 3.5, B 80+ is 3.0, C+ 75+ is 2.5, C 70+ is 2.0, D+ 65+ is 1.5, D 60+ is 1.0, F below 60) and a projected GPA weighted by credit hours, rounded to two decimals like the registrar. A grade is your score on what has been graded so far. Where the syllabus counts only the best items (best 2 of 3 quizzes), only the best ones count and the card lists the ones left out. Courses have a **Credit hours** field and syllabus parts an **Of** field (the 3 in "best 2 of 3") in Settings > Courses; the standard courses come set up (Physics 1 Lab is 1 credit hour, the others 3).
- **Phone app Settings in groups.** Settings is split into Sync, Calendar, Alerts and General tabs, like the extension, instead of one long page. The last tab is remembered, and an unpaired phone opens on Sync.
- **Choose your AI provider.** Settings has an AI Provider dropdown under the API key: OpenRouter (as before), IFM K2 Horizon with a free key from platform.ifm.ai, or any OpenAI-compatible API with your own base URL and model. Each provider keeps its own key, and a Test connection button checks the key before a scan needs it.


### Fixed

- **Task cards show only the course name.** Some cards (for example Calculus in the day view) also showed the course code in brackets, depending on whether the task had a code saved. The code is no longer shown on any card in the extension or the phone app; it is still in the badge tooltip.
- **IFM K2 Horizon works from the extension.** IFM refuses any request that a browser sends (it answers "The model ... is not available", 403), so Test connection and scans failed with a valid key. The extension now removes the browser header IFM blocks from its own requests to api.ifm.ai, and Test connection says what to do if it still happens. The phone app was not affected (its server calls IFM).
- **Reminders while the phone app is closed.** The background check was never registered (it was looked up in the wrong place), so reminders only came while the app was open. On Android and desktop Chrome or Edge, an installed app now checks for due deadlines in the background, fetching the newest list from sync first. How often is up to the browser, often a few times a day. iPhones do not run background checks for web apps; they get reminders from the new push reminders (above) or the calendar feed (Settings > Calendar), whose events carry alerts a day and two hours before. A reminder shown in the background is not shown again when the app opens.
- **Settings tabs no longer scroll the page** when you switch between them.
- **Releases update themselves.** After every passing build on main, the GitHub release (and the website's download link) is rebuilt from the newest commit. A test that only passed in UAE time no longer fails the build on GitHub.
- **In-app guides brought up to date.** The phone app's Setup Guide and the extension's Quick Tour now match the apps: the pairing link is under Settings > Sync and carries the AI pass, iPhone home screen apps can paste it, the phone app works offline, AI is optional (Settings > Scanning), and the scan button, badges and Marks and Syllabus Progress cards are described as they look. The tour can copy the pairing link directly. The phone guide's Pair step showed a missing icon.
- **The phone app works offline again from the home screen.** Home screen apps that open at the site root (installed before the app moved to `/companion/`, or added from the landing page) had no offline copy, because the root service worker removed itself. It now stays and, with no connection, opens the saved app at `/companion/`. Offline, the app shows its real state at launch, pasting announcements is turned off with a note, and marking deadlines done, editing, adding and deleting still work: changes are kept on the phone, shown as waiting to sync, and sent as soon as the connection is back (retried every few seconds on a flaky network).
- **"The Sunday after next" no longer lands on the coming Sunday.** The built-in parser now understands "<day> after next", "a week from <day>", "<day> next week" / "next week on <day>", and the Arabic "الأحد بعد القادم", "الأسبوع القادم يوم ..." and "المقبل".

### Removed

- **Jev classifier.** It only skipped announcements without a deadline and guessed a category before the AI ran. Code now does both: a keyword check, and the wording sets the type, time and room hints. The Jev key, setting, server route and SDK dependency are gone.

### Changed
- **The phone app only sends reminders.** It no longer notifies "New Deadline Added" when it opens and finds deadlines it had not seen; notifications are only the reminders before a deadline is due.
- **Theme follows your system**: the extension and the phone app now match your computer's or phone's light/dark setting by default and switch along with it. You can still pick Light or Dark in Settings. Everyone is moved to the system setting once with this update.
- **Phone app on a computer**: on wide screens the app shows the calendar on the left, with Up Next and Quick Links under it, and your deadline list on the right, side by side. Clicking a day opens that day's deadlines in a pop-up. The header is slimmer, matching the extension: Quick Links, the Setup Guide and the theme are in the page and in Settings. The phone layout is unchanged.
- **Tidier header**: the top row of the extension now holds only Scan, Add deadline and Settings, on one row even in a narrow side panel. The other buttons moved into Settings: Sync Now to Mobile is on the Sync page, the calendar (.ics) export is on the Data page, Manage Quick Links is on the General page (the calendar's Quick Links bar still opens it too), and the theme is the Theme dropdown on the General page, which now changes the theme straight away.
- **Settings split into pages**: the extension's Settings screen has a tab strip (General, Courses, Scanning, Sync, Alerts, Data, Updates) and shows one group at a time instead of one long list. Every setting works and saves as before, and Save Settings still saves all pages. In a narrow side panel the tabs wrap onto two rows. Switching between short and long pages no longer shifts the layout sideways.
- **Credit**: the landing page footer, the README, the license, `package.json` and the Settings screens of the extension and companion now say who built Blackboarder: Yassin Ragab, a freshman at UOS, linking to [yassinr.me](https://yassinr.me).
- **One design system everywhere**: the extension, the companion and the landing page share the system in `docs/DESIGN_SYSTEM.md`: the two-tone colours (near-black `#18181b` and near-white `#f4f4f6`, with grey shades between), Inter Tight headings and Inter body text (bundled, no Google requests), square corners, no gradients, and one solid primary action per screen. Every other colour was removed from the interface, red included (errors and delete buttons use the two tones; overdue badges are solid inverted blocks). Course colours are the one exception and stay as they are.
- **Landing page at the root, phone app at `/companion/`**: `blackboarder.pages.dev` now shows the landing page and the phone app moved to `blackboarder.pages.dev/companion/`. Old pairing links and phones that installed the app from the root are sent to `/companion/` automatically, and their saved key and deadlines carry over. The calendar feed and API addresses did not change. The extension builds pairing links with `/companion/` and accepts the site address with or without it.

### Security
- **Sync key required everywhere**: `/api/tasks`, `/api/sync`, `/api/task-status` and `/feed.ics` now return `400` without a valid key instead of falling back to the shared default bucket. `/api/status` no longer reads data without a key or exposes the database URL.
- **Rate limits per IP and per key**: counting only per key let anyone guessing keys use a new key each time. The calendar feed is limited per key, since calendar services share IPs. The in-memory map is capped so it cannot grow without bound.
- **Server AI keys only for paired devices**: the worker's own AI keys are no longer lent to anonymous callers, and a caller's own `apiKey` now takes priority.
- **Firebase rules fixed**: the 1.1.0 rules validated `users/{key}` itself, but clients write to `users/{key}/data`, so every sync would have been rejected once published. Key names are now limited to 8-64 safe characters.
- **Longer sync keys**: new keys have 10 random characters (50 bits) instead of 6 (30 bits). Existing keys keep working.

### Added
- **SEO & web efficiency**: added robots.txt with sitemap directive, sitemap.xml with canonical landing and companion URLs, Schema.org JSON-LD structured data (WebApplication, WebSite, and FAQPage rich snippets), OpenGraph and Twitter card metadata, keyboard accessibility skip link, semantic <main> content wrapper, and long-term immutable caching for static fonts and media.
- **Course picker**: when adding or editing a deadline, the course field lists your courses and narrows as you type.
- **The popup remembers unfinished work**: closing it while adding or editing a deadline, or in Settings, reopens right there; otherwise it opens on the calendar.
- **Scan reports marks**: the scan message says how many gradebook marks matched a deadline and names the ones that did not.
- **Syllabus Progress**: the course-by-course tracker of how much of each syllabus is done is back, as its own card under Marks.
- **Marks**: one card lists every mark by course, newest first (score, percent and the share of the grade it earned), in the extension and the phone app.
- **Marks from the gradebook**: every scan now reads your marks straight from each course's Blackboard gradebook and shows them on the matching deadline (for example "4.5 / 5 (90%)"). Work waiting to be marked shows as submitted.

### Fixed
- **Phone sync error "Invalid data; couldn't parse key"**: deleted-task records are keyed by task id, and ids with a dot or slash (like "HW1_Phys.1") were refused by Firebase. The keys are now encoded when saved and decoded when read.
- **Phone replaces junk rooms**: a saved room like "s" is looked up again on the phone too.
- **Marks no longer disappear after a scan**: the popup could save an older copy of your deadlines over the one a scan had just saved with your marks. Saves now keep the newer copy of each deadline.
- **Marks land on the right item**: a practice exam's mark is never put on the real exam (a mark cannot come before the exam date), and deadlines you add yourself now get their gradebook marks.
- **Weights and rooms no longer change by themselves**: a percentage elsewhere in an announcement ("final exam out of 75%") is no longer taken as the weight, the phone no longer overwrites weights, edited tasks are left alone when courses sync, rooms written like "A10:006" are read, and junk rooms like "s" are replaced on the next scan.
- **Fewer false errors**: normal situations (a course whose announcements cannot be read, a reloaded extension, the AI falling back) no longer show up on the extension's Errors page.
- **Marks for every course**: Physics 1, Physics 1 Lab and Islamic Culture were mixed up inside the extension, so their marks could not be placed. Marks also now find deadlines whose names differ slightly from Blackboard's (for example "Free Fall Exp. Student's Lab Report" and "Free Fall Exp. - Lab Report", or "2nd Quiz" and "Quiz 2"), and names with "&" match.
- **Stats row colours**: the Urgent count is red and the This Week count is amber again, in light and dark.
- **Marks**: a "Grade posted" card now attaches its mark to the matching deadline (the "Grade posted:" words in the title stopped it from matching), and a mark never lands on a same-named task in another course.
- **Same-named posts in two courses**: when two courses post an announcement with the same title (for example "Quiz 3" in Physics 1 Lab and Intro to Computer Engineering), each deadline now keeps its own course's text instead of one course's text showing on both.
- **Website on phones**: the landing page no longer scrolls sideways on small phones (the hero and footer grids were wider than the screen). The section links stay visible on phones and tablets as a swipeable row under the logo, and footer and step links are big enough to tap.
- **Update prompt**: Blackboarder now checks for a new version every 15 minutes and each time you open it (it was hourly, and the popup could reuse a result an hour old). As soon as an update is installed, the popup shows "Update ready - restart to finish" with a Restart now button, even if it was already open. A git clone that could not be updated now says why instead of showing nothing.
- **Junk tasks called "Exam", "Meeting" or "Other"**: when a dated line in an announcement had no name (office hours, a start date, a presentation schedule, "Date: Thursday 22 October"), the scanner titled the task with its type and never asked the AI. It now takes the name from the announcement heading or leaves it to the AI. Existing junk tasks, and a Quiz 3 copied into the wrong course, are removed the next time the popup opens and stay removed on the phone and in the cloud. Scanned extras that are not graded work (office hours, paper review days, presentation schedules) are left out too. Tasks you created or edited are never removed.
- **Closing the popup cancelled a scan**: the scan now runs in the Blackboard tab, so it finishes and saves even if you close the popup, and reopening the popup shows its progress ("Extracting 12/40..."). Announcements are also processed four at a time, so scans with AI on are faster.
- **Course announcements never loaded**: Blackboard Ultra pages point their base address at a CloudFront file server, so every announcement request the scanner made went there and failed with 404. Requests now always go to the Blackboard site, so announcements that aren't visible in the stream (like a quiz date) are imported again.
- **Fake deadlines dated by when something was posted**: the activity stream doesn't show announcement text, so the scanner read the card's posting time ("Oct 18, 2026 2:20 PM") as the text and the due date, creating tasks like an overdue "Exam". It no longer does, it skips "Added: file" cards, and tasks made this way are removed on the next scan.
- **Course announcements missing on the stream page**: announcements fetched from each course were labelled with the page title instead of their course, and were lost if Blackboard refused the public announcements address. They now get the real course name, fall back to the address Ultra itself uses, and each scan writes a one-line summary to the page console.
- **New deadlines merged into old ones and disappeared**: when the course of an announcement could not be detected, a new "Quiz 3" was treated as the same task as any older "Quiz 3" and silently dropped, keeping the old date. Title matching now needs a known course, and a known course re-announcing a task on a new date moves it (unless you edited it). An announcement with two deadlines also kept only the first; both are kept now.
- **Arabic announcements never reached the AI**: the check that decides whether an announcement is worth an AI call wrapped Arabic words in `\b`, which never matches Arabic in JavaScript, so Arabic-only announcements without a readable date were dropped. It also missed presentations, tests, reports and essays. Both are fixed, and the local parser now recognises عروض (presentations).
- **AI Deep Extraction toggle would not stay on**: the AI settings (the toggle, OpenRouter key, model, Jev toggle and Jev key) only saved with the Save Settings button at the bottom of the page, so closing the popup threw the change away and the toggle showed off again. They now save the moment they change, with a toast (and a reminder to add a key if the toggle is on without one).
- **Auto-update for git clones**: the helper skipped any extension inside a git clone, and the copy in a clone's top-level `updater/` folder treated the whole repository as the extension (and was registered under the wrong extension ID). It now finds `dist/` itself and updates a clone with `git pull --ff-only`, only on `main` with no uncommitted changes. Run `update.bat` once to re-register.
- **No more "Server Offline" in Settings**: sync runs through Firebase, but the extension still pinged a local server at `localhost:3456` on every sync and showed it as offline. The own-server field is now optional and empty by default; nothing is sent or shown unless you fill it in.
- **Month title spacing**: the month name had a 140px minimum width and was left-aligned, so the next-month arrow sat far from the text. The arrows now sit 8px from the name on both sides, as in the companion.
- **Cleanup**: removed unused one-off scripts (`generate_icons.js`, `generate_vector_icons.py`, `parsePhy1.py`, `package.bat`), the committed local-server data files (now ignored), and the four `src/utils` files that only re-exported `src/core`; imports point at `src/core` directly.
- **CI checks sync**: the build workflow runs `npm run lint`, so a version mismatch between the extension, companion, landing page and README fails the build.
- **Side panel layout**: the side panel opened the popup at its fixed 480px size, cutting off course chips and the calendar. Only the toolbar popup keeps the fixed size now (Chrome is asked directly), so the side panel uses the full width even before Chrome reloads the manifest. Calendar columns can also no longer be widened by long task names.
- **Scan button after an extension update**: open Blackboard tabs get a fresh copy of the scraper after an install or update, and the old copy no longer relabels the new button as "reload tab".

---

## [1.1.0] - 2026-10-21 (Milestone Release)

### Security & Privacy
- **Automatic Sync Key Provisioning**: Ensured every new extension install automatically generates a unique 32-bit cryptographically random key (`BBS-XXXXXX`), preventing any student from falling back to or writing into a shared global bucket.
- **Minimum Privilege Extension Permissions**: Removed `file:///*` matches and unnecessary `"downloads"` permission from `public/manifest.json`. Replaced with standard in-tab browser downloads.
- **Repository Privacy & Course Anonymization**: Removed proprietary course syllabus PDFs from `docs/syllabus/`. Anonymized default course schedules to generic `Course Faculty` and campus room references.

### Design System & Two-Tone Theme
- **Swiss Grid Universal 0px Radius**: Implemented universal `*, *::before, *::after { border-radius: 0 !important; }` across `src/popup/popup.css` and `mobile-web/styles.css`, establishing a razor-sharp, geometric, flat Swiss Grid design system.
- **Monochrome Neutral Two-Tone Theme**: Replaced legacy neon green accents (`#10b981`, `#34d399`, `#059669`) across urgency badges, completion chips, syllabus progress bars, and device pairing indicators with clean, high-contrast monochrome tokens (`#18181b` light, `#f4f4f6` dark).
- **Typography Standardization**: Eliminated all em-dashes (`—`) in user-facing UI text, buttons, and documentation in favor of standard hyphens (`-`).

### Scraper & Runtime Resilience
- **Scoped Stream Queries**: Replaced expensive `querySelectorAll('*')` DOM traversals in `scrapeUltraStreamDueItems` with scoped container selectors (`[role="feed"] *`, `.stream-item-container *`), dramatically accelerating timeline parsing.
- **Extension Context Invalidation Recovery**: Hardened content script against Manifest V3 extension reloads (`Extension context invalidated`). The floating scan pill now safely transitions state, disconnects orphaned observers, and prompts users with `"Extension updated - reload tab (F5)"`.
- **Heuristic Layout Fallback**: Added Strategy 3 fallback selectors in `scrapeAnnouncements` to handle custom web-components or future Blackboard DOM structure updates.

### Code Hygiene & Testing
- **Automated Hygiene Script**: Added `scripts/lint-check.js` (`npm run lint`, `npm run check`) verifying TypeScript compilation, Swiss Grid rules, two-tone color compliance, JSON validity, typography standards, and universal 4-way version synchronization.
- **Universal Multi-Component Synchronization**: Automated build synchronization in `scripts/build.js` ensuring the Chrome Extension, Companion PWA, Landing Page, and GitHub README stay in byte-level lockstep across every release.
- **Comprehensive Test Suite**: 34 test suites and 322 tests verifying sync key isolation, course matching, syllabus weights, ICS feeds, bidirectional updates, popup accessibility, and context invalidation fallbacks.

### UI & Layout Polishing
- **Fixed Extension Popup Dimensions**: Permanently locked toolbar popup at 480px by 600px, eliminating dynamic jumping and shrink-to-fit sizing on high-DPI screens while preserving responsive full-screen behavior in standalone windows.
- **Companion Header Synchronization Banner**: Resolved text truncation on the mobile web companion header; sync status now displays `Updated [Date], [Time] · [X] deadlines` with multi-line word wrap and flexible brand header sizing.

---

## [1.0.0] - 2026-09-28 (Initial Release)

- **3-Tier Hybrid Extraction Pipeline**: Local regex parsing, Jev System One classification, and OpenRouter Generative AI deep extraction.
- **Academic Quick Links**: Quick access bar for attendance records, marks portal, and degree audit.
- **Syllabus Grade Tracker**: Weight calculation for assignments, quizzes, and exams.
- **Live RFC 5545 WebCal Feed**: Dynamic `.ics` calendar feed for iOS, macOS, Android, and Outlook.
- **Offline-First PWA**: Mobile web companion app with offline caching and background service worker.
