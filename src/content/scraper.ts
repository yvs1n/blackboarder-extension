import { Announcement, DeadlineTask, TaskSubmissionUpdate } from '../types';
import { getSettings, getTasks, saveTasksMergingLatest, getLastScanCheckpoint, isExtensionContextValid, getUserCourses, autoRegisterDiscoveredCourses, setScanStatus, getScanStatus } from '../utils/storage';
import { setActiveUserCourses, getActiveUserCourses } from '../core/userCourses';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, isBlackboardSystemNoise, hasValidAcademicCourseCode, isValidTask } from '../core/courseHelper';
import { parseDirectStreamCard, parseSubmissionOrGradeCard } from '../utils/streamParser';
import { deduplicateTaskList } from '../utils/taskMerge';
import { GRADEBOOK_REPORT_KEY } from '../utils/gradebook';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../utils/announcementMerge';
import { startCourseColorPainter, discoveredCoursesWithColors } from './courseColorPainter';
import { startActivityFilter } from './activityFilter';
import { SESSION_STATUS_KEY } from '../utils/sessionStatus';
import { GET_BLACKBOARD_XSRF, needsXsrf, XSRF_HEADER } from '../utils/blackboardXsrf';
import { ScanGate, ScanRun } from './scanGate';
import { detectUniversityFromHost } from '../utils/profile';
import { isExamSchedulePage, scrapeExamScheduleFromDoc, mergeExamScheduleTasks } from '../core/examSchedule';
import { ExamRefreshResult, examRefreshNote } from '../utils/examRefreshNote';
import {
  ApiResult,
  BbFetch,
  CourseMeta,
  fetchCourseAnnouncements,
  fetchEnrolledCourses,
  isOrientationOrSandboxCourse,
  mergeCourseMaps,
  readBlackboardApi
} from '../scan/blackboardApi';
import { runScanPipeline, emptyCheckpoint } from '../scan/scanPipeline';
import { findCourseIdForText } from '../scan/courseLookup';
import { claimAutoScan } from '../scan/autoScan';

/**
 * Scrapes direct deadline cards from the Blackboard Ultra Stream timeline
 * (e.g. items with "Due Date: 9/18/26, 11:59 PM (UTC+4)").
 * Supports incremental scanning by stopping when hitting items already scanned.
 */
function scrapeUltraStreamDueItems(knownDirectTaskIds?: Set<string>): DeadlineTask[] {
  const directTasks: DeadlineTask[] = [];
  const scannedKeys = new Set<string>();
  let consecutiveKnown = 0;

  // Find all elements containing "Due Date:" or "تاريخ الاستحقاق:"
  const candidateScope = document.querySelectorAll(
    '[role="feed"] *, .stream-item-container *, .stream-entry *, article *, .element-card *, [class*="activity-card"] *, [class*="stream-item"] *'
  );
  const allElements = candidateScope.length > 0 ? candidateScope : document.querySelectorAll('body *');
  const leafDateElements: Element[] = [];

  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    const text = el.textContent || '';
    if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(text)) {
      let hasChildMatch = false;
      for (let j = 0; j < el.children.length; j++) {
        if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(el.children[j].textContent || '')) {
          hasChildMatch = true;
          break;
        }
      }
      if (!hasChildMatch) {
        leafDateElements.push(el);
      }
    }
  }

  for (const dateEl of leafDateElements) {
    const card = dateEl.closest('li, [role="listitem"], .stream-item, [class*="stream-item"], [class*="stream-entry"], [class*="activity-card"], [class*="element-card"], [class*="timeline"], [class*="base-card"], div[class*="card"]') || dateEl.parentElement?.parentElement || dateEl.parentElement;
    if (!card) continue;

    const cardText = card.textContent || '';
    if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number|grade\s+posted|score\s+posted|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة)/i.test(cardText)) {
      continue;
    }

    const parsed = parseDirectStreamCard(cardText);
    if (parsed) {
      if (knownDirectTaskIds && knownDirectTaskIds.has(parsed.id)) {
        consecutiveKnown++;
        if (consecutiveKnown >= 3) {
          // Reached checkpoint where previous scan already captured older items
          break;
        }
        continue;
      }
      consecutiveKnown = 0;
      if (!scannedKeys.has(parsed.id)) {
        scannedKeys.add(parsed.id);
        directTasks.push(parsed);
      }
    }
  }

  return directTasks;
}

/**
 * Scrapes submission receipts and posted marks from Blackboard activity stream cards.
 */
function scrapeStreamSubmissionsAndGrades(): TaskSubmissionUpdate[] {
  const updates: TaskSubmissionUpdate[] = [];
  const seen = new Set<string>();

  const cards = document.querySelectorAll(
    'li.stream-item-container, bb-announcement-card, .stream-entry, article[aria-label], div[role="article"], .element-card, [class*="stream-item"], [class*="activity-card"]'
  );

  cards.forEach(card => {
    const cardText = card.textContent?.trim() || '';
    if (!cardText || cardText.length < 5) return;

    const parsed = parseSubmissionOrGradeCard(cardText);
    if (parsed) {
      const key = `${parsed.courseCode || parsed.courseName || ''}_${parsed.title.toLowerCase().trim()}_${parsed.submissionStatus}`;
      if (!seen.has(key)) {
        seen.add(key);
        updates.push(parsed);
      }
    }
  });

  return updates;
}

/**
 * Auto-discovers enrolled courses from page links, course navigation, and DOM cards.
 */
function scrapeEnrolledCourses(): { courseName: string; courseCode?: string }[] {
  const discovered: { courseName: string; courseCode?: string }[] = [];
  const seen = new Set<string>();

  function register(rawName: string, rawCode?: string) {
    if (isBlackboardSystemNoise(rawName) || isBlackboardSystemNoise(rawCode)) return;
    const { name, code } = parseCourseDetails(`${rawCode || ''} ${rawName || ''}`.trim());
    if (!name || name === 'General Course' || name.toLowerCase() === 'uos') return;
    if (isBlackboardSystemNoise(name) || isBlackboardSystemNoise(code)) return;
    const cleanCode = (code && code !== 'UOS' && hasValidAcademicCourseCode(code)) ? code : undefined;
    if (!cleanCode) return;
    const normCode = cleanCode.replace(/[\s_-]+/g, '').toLowerCase();
    if (!seen.has(normCode)) {
      seen.add(normCode);
      discovered.push({ courseName: name, courseCode: cleanCode });
    }
  }

  // 1. Scan course links and cards on page (exclude [analytics-id*="course"] which matches Details & Actions sidebar items)
  const courseElements = document.querySelectorAll(
    'a[href*="/ultra/courses/"], a[href*="course_id="], [data-course-id], .course-element-card, .bb-course-title, [class*="course-title"]'
  );
  courseElements.forEach(el => {
    // Ignore links that are course navigation tabs or Details & Actions sidebar items
    if (el.closest('nav, aside, [role="navigation"], .course-org-navigation, .tab-bar, [class*="navigation"], [class*="details"], [class*="outline"]')) {
      return;
    }
    const href = el.getAttribute('href') || '';
    if (/\/ultra\/courses\/[^/]+\/(outline|calendar|discussions|gradebook|messages|analytics|groups|roster|tools|achievements|attendance)/i.test(href)) {
      return;
    }
    const text = el.textContent?.trim() || '';
    if (text && text.length > 3 && text.length < 120) {
      if (isBlackboardSystemNoise(text)) return;
      const parsed = parseCourseDetails(text);
      if (parsed.name && parsed.name !== 'General Course' && !isBlackboardSystemNoise(parsed.name) && hasValidAcademicCourseCode(parsed.code)) {
        register(parsed.name, parsed.code);
      }
    }
  });

  return discovered;
}

/**
 * Scrapes announcements from Blackboard (Classic, Ultra Course, and Ultra Stream).
 * Supports incremental scanning by stopping when hitting announcements already processed.
 */
async function scrapeAnnouncements(
  knownAnnIds?: Set<string>,
  knownKeys?: Set<string>,
  resolveCourseId?: (text: string) => Promise<string>
): Promise<Announcement[]> {
  const currentUrl = window.location.href;
  const pageTitle = document.title || '';

  // Extract page-level course info from headings or document title
  const pageHeadingEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
  const rawPageCourseText = pageHeadingEl?.textContent?.trim() || (pageTitle !== 'Activity' ? pageTitle : '');
  const pageCourseInfo = parseCourseDetails(rawPageCourseText);

  let detectedCourseCode = pageCourseInfo.code;
  let detectedCourseName = pageCourseInfo.name;

  const results: Announcement[] = [];
  const scannedIds = new Set<string>();

  // Strategy 1: Blackboard Learn Classic Announcement List
  const classicItems = document.querySelectorAll('#announcementList > li, .announcementListItem');
  if (classicItems.length > 0) {
    classicItems.forEach((el, index) => {
      const titleEl = el.querySelector('h3, .announcementTitle, a');
      const bodyEl = el.querySelector('.vtbegenerated, .announcementBody, .details') || el;
      const dateEl = el.querySelector('.details, .date, .posted-date');

      const title = titleEl?.textContent?.trim() || `Announcement ${index + 1}`;
      let text = bodyEl?.textContent?.trim() || '';
      text = sanitizeDoctorAnnouncementText(text, detectedCourseName, detectedCourseCode, title);
      const rawDate = dateEl?.textContent?.trim() || '';

      const id = `ann_classic_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;
      if (!scannedIds.has(id) && text.length > 10) {
        scannedIds.add(id);
        results.push({
          id,
          courseCode: detectedCourseCode,
          courseName: detectedCourseName,
          title,
          postedAt: extractDateStringFromText(rawDate),
          contentText: text,
          contentHtml: bodyEl?.innerHTML || '',
          sourceUrl: currentUrl,
          scannedAt: new Date().toISOString()
        });
      }
    });
  }

  // Strategy 2: Blackboard Ultra Stream / Announcements Cards
  const ultraCards = Array.from(document.querySelectorAll<HTMLElement>(
    'li.stream-item-container, bb-announcement-card, .stream-entry, article[aria-label], div[role="article"], .element-card, [class*="stream-item"], [class*="activity-card"]'
  ));

  let consecutiveKnown = 0;

  for (let index = 0; index < ultraCards.length; index++) {
    const card = ultraCards[index];
    // Never treat course tiles on the Courses list page (/ultra/course) as announcements
    if (
      card.classList.contains('course-element-card') ||
      card.hasAttribute('data-course-id') ||
      card.closest('.base-courses, .course-org-list') ||
      card.querySelector('.multi-column-course-id, .js-course-title-element')
    ) {
      continue;
    }
    const cardText = card.textContent?.trim() || '';
    // Skip if it's already a direct due date card
    if (/Due Date:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(cardText)) {
      continue;
    }

    // Skip grade notifications, submission confirmations, discussion posts, or score reports
    if (/(?:grade\s+posted|grades\s+available|score\s+posted|graded|new\s+grade|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(cardText)) {
      continue;
    }
    if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(cardText)) {
      continue;
    }
    if (/(?:discussion\s+board|new\s+post\s+in|someone\s+replied|منتدى\s+النقاش|مشاركة\s+جديدة)/i.test(cardText)) {
      continue;
    }
    if (/^\s*["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?\s*$/m.test(cardText)) {
      continue;
    }

    // Identify title link and extract courseId / announcementId
    const titleLink = card.querySelector<HTMLAnchorElement>(
      'a.js-title-link, [analytics-id="stream.entry.title"], a[bb-peek-sref*="announcement"], a[href*="announcementId"]'
    );
    const peekSref = titleLink?.getAttribute('bb-peek-sref') || '';
    const href = titleLink?.getAttribute('href') || '';

    let courseId = '';
    let announcementId = '';
    let courseNameFromAttr = '';

    if (peekSref) {
      const cidMatch = peekSref.match(/courseId["']?\s*:\s*["']([^"']+)["']/);
      if (cidMatch) courseId = cidMatch[1];
      const aidMatch = peekSref.match(/announcementId["']?\s*:\s*["']([^"']+)["']/);
      if (aidMatch) announcementId = aidMatch[1];
      const cnameMatch = peekSref.match(/courseName["']?\s*:\s*["']([^"']+)["']/);
      if (cnameMatch) courseNameFromAttr = cnameMatch[1];
    }

    if (!courseId && href) {
      const cidMatch = href.match(/[?&]courseId=([^&]+)/);
      if (cidMatch) courseId = cidMatch[1];
    }
    if (!announcementId && href) {
      const aidMatch = href.match(/[?&]announcementId=([^&]+)/);
      if (aidMatch) announcementId = aidMatch[1];
    }

    // Extract courseId / announcementId from analytics-context JSON on card or element-details
    const analyticsContextEl = card.querySelector('[analytics-context]') || (card.hasAttribute('analytics-context') ? card : null);
    const analyticsContextRaw = analyticsContextEl?.getAttribute('analytics-context') || '';
    if (analyticsContextRaw) {
      try {
        const parsedContext = JSON.parse(analyticsContextRaw.replace(/&quot;/g, '"'));
        if (!courseId && parsedContext.courseId) courseId = parsedContext.courseId;
        if (!announcementId && parsedContext.announcementId) announcementId = parsedContext.announcementId;
        if (!announcementId && parsedContext.id && parsedContext.id.startsWith('_')) announcementId = parsedContext.id;
      } catch {}
    }

    // Extract courseId from course outline / content links inside card
    if (!courseId) {
      const courseLink = card.querySelector<HTMLAnchorElement>('a[href*="/courses/"], a[href*="course_id="], a[analytics-id="stream.entry.course"]');
      const cHref = courseLink?.getAttribute('href') || '';
      const cMatch = cHref.match(/(?:courses\/|course_id=)(_\d+_\d+)/);
      if (cMatch) courseId = cMatch[1];
      if (!peekSref && courseLink) {
        const cPeek = courseLink.getAttribute('bb-peek-sref') || '';
        const cPeekMatch = cPeek.match(/courseId["']?\s*:\s*["']([^"']+)["']/);
        if (cPeekMatch) courseId = cPeekMatch[1];
      }
    }

    const titleEl = card.querySelector('h3, h4, .announcement-title, .stream-entry-title, [role="heading"], a.js-title-link, [analytics-id="stream.entry.title"]');
    const timeEl = card.querySelector('time, [datetime], .timestamp, .stream-entry-time, [class*="timestamp"]');
    const courseEl = card.querySelector('.course-name, .context-title, a[analytics-id="stream.entry.course"], a[href*="/courses/"], [data-course-id], .course-title, .context a');

    let title = titleEl?.textContent?.trim() || '';

    // "Added: Friction.ppt" cards are course files, not announcements. They have no text,
    // so reading them only ever produced tasks dated by their posting time.
    if (/^(?:added|updated|edited|new\s+content)\s*:/i.test(title) || /\/bbcswebdav\//i.test(href)) {
      continue;
    }

    const titleLower = title.toLowerCase().trim();
    const candidateId = announcementId ? `ann_ultra_${announcementId}` : `ann_ultra_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;

    // Incremental Check: Check by ID, raw announcementId, or title key
    const isKnown = (knownAnnIds && (
      knownAnnIds.has(candidateId) ||
      (announcementId && knownAnnIds.has(announcementId)) ||
      (announcementId && knownAnnIds.has(`ann_ultra_${announcementId}`)) ||
      (announcementId && knownAnnIds.has(`ann_api_${announcementId}`))
    )) || (knownKeys && (
      (titleLower && knownKeys.has(titleLower)) ||
      (courseNameFromAttr && titleLower && knownKeys.has(`${courseNameFromAttr}_${titleLower}`))
    ));

    if (isKnown) {
      consecutiveKnown++;
      // Blackboard Ultra stream is strictly descending by date; encountering 2 consecutive known items means we caught up!
      if (consecutiveKnown >= 2) {
        break;
      }
      continue;
    }
    consecutiveKnown = 0;

    let cardCourseCode = detectedCourseCode;
    let cardCourseName = detectedCourseName;

    const rawCourseStr = courseNameFromAttr || courseEl?.textContent?.trim() || '';
    if (rawCourseStr) {
      const parsed = parseCourseDetails(rawCourseStr);
      if (parsed.name !== 'General Course') cardCourseName = parsed.name;
      if (parsed.code !== 'UOS') cardCourseCode = parsed.code;
    } else {
      const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const parsedFirstLine = parseCourseDetails(lines[0]);
        if (parsedFirstLine.name !== 'General Course') {
          cardCourseName = parsedFirstLine.name;
          cardCourseCode = parsedFirstLine.code;
        }
      }
    }

    // No course link on the card: find it among the student's own Blackboard courses (enrolment
    // list and page links) by code, name, or the saved course the card matches
    if (!courseId && resolveCourseId) {
      courseId = await resolveCourseId(`${cardCourseName} ${cardCourseCode} ${rawCourseStr} ${title}`);
    }

    // Clone card to prune non-announcement elements safely
    const cardClone = card.cloneNode(true) as HTMLElement;

    const noiseSelectors = [
      'time',
      '[datetime]',
      '.timestamp',
      '.stream-entry-time',
      '[class*="timestamp"]',
      '[class*="date-time"]',
      '.course-name',
      '.context-title',
      '.course-title',
      '[data-course-id]',
      'a[href*="/courses/"]',
      'a[analytics-id="stream.entry.course"]',
      'button',
      'svg',
      'nav',
      '.bb-avatar',
      '.avatar',
      '[class*="author"]'
    ];
    noiseSelectors.forEach(sel => {
      cardClone.querySelectorAll(sel).forEach(el => el.remove());
    });

    if (title) {
      cardClone.querySelectorAll('h1, h2, h3, h4, h5, [role="heading"], .announcement-title, .stream-entry-title, a.js-title-link').forEach(h => h.remove());
    }

    // Candidate body elements: iterate to select the container with the longest unabridged text
    const candidateSelectors = [
      '.vtbegenerated',
      '.details',
      'bb-read-more',
      '.announcement-body',
      '.entry-content',
      '.stream-entry-body',
      '.stream-item-content',
      '.stream-message',
      '.message-body',
      '[class*="body-content"]',
      '[bb-translate]',
      '.content',
      '.summary'
    ];

    // Assigned inside a forEach callback, so widen the type to stop TS narrowing it to `never`
    let bestBodyEl = null as HTMLElement | null;
    let bestCandidateText = '';
    let bestCandidateHtml = '';

    for (const sel of candidateSelectors) {
      const candidateElements = cardClone.querySelectorAll<HTMLElement>(sel);
      candidateElements.forEach(el => {
        const cText = el.textContent?.trim() || '';
        if (cText.length > bestCandidateText.length) {
          bestCandidateText = cText;
          bestCandidateHtml = el.innerHTML || '';
          bestBodyEl = el;
        }
      });
    }

    const cardCloneText = cardClone.textContent?.trim() || '';
    // Never fall back to the raw card text: on the Ultra stream the body is empty, and the raw
    // text is just the course, title and posting time, which then became the due date.
    let text = bestCandidateText.length >= 25 ? bestCandidateText : cardCloneText;
    let fullHtml = bestCandidateHtml || bestBodyEl?.innerHTML || cardClone.innerHTML || '';

    const attrFullText = card.getAttribute('data-full-text') || card.getAttribute('data-content') || '';
    if (attrFullText && attrFullText.length > text.length) {
      text = attrFullText.trim();
    }
    const titleAttr = card.getAttribute('title') || bestBodyEl?.getAttribute('title') || card.querySelector('[title]')?.getAttribute('title') || '';
    if (titleAttr && titleAttr.length > text.length && !titleAttr.startsWith('http')) {
      text = titleAttr.trim();
    }

    // Check if text ends in ellipsis or is truncated
    const isTruncated = /(?:…|\.\.\.)\s*$/.test(text) || text.includes('…') || text.endsWith('...');

    // Fetch complete unabridged text directly from code (REST API / Classic Webapp) - ZERO DOM clicks or mutations
    if (isTruncated || (courseId && announcementId)) {
      const fullRes = await fetchFullAnnouncementBodyFromCode(courseId, announcementId, title);
      if (fullRes && fullRes.text.length > text.length) {
        text = fullRes.text;
        fullHtml = fullRes.html;
      }
    }

    text = sanitizeDoctorAnnouncementText(text, cardCourseName, cardCourseCode, title);

    if (!title) {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 1 && lines[0].length < 75) {
        title = lines[0];
      } else {
        title = `Announcement ${index + 1}`;
      }
    }

    // No body anywhere: the title is all we know (often enough, e.g. "Quiz 3 - Thursday 29 October 2026")
    if (text.trim().length <= 5 && titleEl) {
      text = title;
    }

    const postedAt = timeEl?.getAttribute('datetime') || extractDateStringFromText(timeEl?.textContent || '');

    const id = candidateId;
    if (!scannedIds.has(id) && text.length > 5) {
      scannedIds.add(id);
      results.push({
        id,
        courseCode: cardCourseCode,
        courseName: cardCourseName,
        title,
        postedAt,
        contentText: text,
        contentHtml: fullHtml || bestBodyEl?.innerHTML || '',
        sourceUrl: currentUrl,
        scannedAt: new Date().toISOString()
      });
    }
  }

  // Strategy 3: Generic Announcement/Post container heuristic fallback, only for pages with no
  // stream cards at all. On the stream it re-read skipped cards whole, timestamp included.
  if (results.length === 0 && ultraCards.length === 0) {
    const genericPosts = document.querySelectorAll(
      '[class*="announcement"], [class*="post"], [class*="notice"], [role="feed"] > article, [role="feed"] > li, [role="region"] article, main article, [class*="stream-container"] > *'
    );
    genericPosts.forEach((post, index) => {
      let text = post.textContent?.trim() || '';
      if (text.length > 30 && text.length < 5000) {
        const titleEl = post.querySelector('h1, h2, h3, h4, h5, strong');
        const title = titleEl?.textContent?.trim() || `Notice ${index + 1}`;
        text = sanitizeDoctorAnnouncementText(text, detectedCourseName, detectedCourseCode, title);
        const id = `ann_gen_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;
        if (!scannedIds.has(id)) {
          scannedIds.add(id);
          results.push({
            id,
            courseCode: detectedCourseCode,
            courseName: detectedCourseName,
            title,
            contentText: text,
            sourceUrl: currentUrl,
            scannedAt: new Date().toISOString()
          });
        }
      }
    });
  }

  return results;
}

/**
 * Expansion is handled purely via CSS (.bbs-extracted-expanded) on extract to prevent clicking or shifting.
 */
async function expandAllTruncatedAnnouncements(): Promise<void> {
  // Purely CSS-based expansion on extract; no synthetic clicks on DOM buttons
}

/**
 * Resolves standard Blackboard AJAX headers including CSRF token if present.
 */
/**
 * fetch() for a Blackboard path such as "/learn/api/...". Ultra pages set <base href> to a
 * CloudFront asset host, so a bare path resolves there and every request 404s. Always send it
 * to the Blackboard site itself.
 */
/** GET a Blackboard API path as JSON (throws on a failed request). */
async function getBlackboardJson(path: string): Promise<any> {
  const res = await bbFetch(path, { headers: getBlackboardFetchHeaders(), credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Blackboard ${res.status}`);
  return res.json();
}

export function bbFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, window.location.origin).href, init);
}

function getBlackboardFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  };
  try {
    const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|xsrfToken|Bb-Xsrf)=([^;]+)/i);
    if (match) {
      const token = decodeURIComponent(match[1]);
      headers['X-Blackboard-XSRF'] = token;
      headers['X-XSRF-TOKEN'] = token;
    }
  } catch {}
  return headers;
}

/**
 * bbFetch with Blackboard's AJAX headers and the session cookie: the fetch the shared API
 * readers (src/scan/blackboardApi.ts) use in this tab.
 */
const tabFetch: BbFetch = async (path, init) => {
  const extra: Record<string, string> = {};
  if (needsXsrf(init)) {
    const token = await tabXsrfToken();
    if (token) extra[XSRF_HEADER] = token;
  }
  return bbFetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...getBlackboardFetchHeaders(), ...extra, ...((init?.headers as Record<string, string>) || {}) }
  });
};

/** The session's XSRF token from the service worker (the cookie holding it is HttpOnly). */
function tabXsrfToken(): Promise<string | null> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: GET_BLACKBOARD_XSRF }, res => {
        void chrome.runtime.lastError;
        resolve(typeof res?.token === 'string' ? res.token : null);
      });
    } catch {
      resolve(null);
    }
  });
}

type EnrolledCourses = ApiResult<{ courses: Map<string, CourseMeta>; skipped: Set<string> }>;

/** A course name as a page link writes it ("Calculus I for Engineering- 21 - حسبان 1"). */
function courseMetaFromPageText(raw: string): CourseMeta {
  const parsed = parseCourseDetails(raw);
  return {
    name: parsed.name !== 'General Course' ? parsed.name : raw,
    code: parsed.code !== 'UOS' ? parsed.code : ''
  };
}

/**
 * Course ids and names the page itself shows (URL, data attributes, course links), and the
 * orientation or sandbox courses it links to. The enrolment list adds the rest.
 */
function collectPageCourses(): { courses: Map<string, CourseMeta>; skipped: Set<string> } {
  const courses = new Map<string, CourseMeta>();
  const skipped = new Set<string>();
  const add = (cid: string, rawName: string = '') => {
    if (!cid || !cid.startsWith('_') || skipped.has(cid)) return;
    if (rawName && isOrientationOrSandboxCourse(rawName)) {
      skipped.add(cid);
      courses.delete(cid);
      return;
    }
    const known = courses.get(cid);
    if (known && known.name) return;
    courses.set(cid, rawName ? courseMetaFromPageText(rawName) : { name: '', code: '' });
  };

  // 1. Current URL (on the course's own page the heading names it)
  const urlMatch = window.location.href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);

  // 2. DOM elements with data attributes
  document.querySelectorAll('[data-course-id], [data-course]').forEach(el => {
    add(el.getAttribute('data-course-id') || el.getAttribute('data-course') || '');
  });

  // 3. Links to courses on stream cards (their text is the course name)
  document.querySelectorAll('a[href*="/courses/"], a[href*="course_id="], a[href*="launcher?type=Course"]').forEach(a => {
    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
    const m = href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
    if (!m) return;
    const name = a.textContent?.trim() || '';
    if (isOrientationOrSandboxCourse(name)) {
      skipped.add(m[1]);
      courses.delete(m[1]);
      return;
    }
    add(m[1], name);
  });

  if (urlMatch && !skipped.has(urlMatch[1]) && !courses.get(urlMatch[1])?.name) {
    const heading = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
    const hText = heading?.textContent?.trim() || '';
    if (isOrientationOrSandboxCourse(hText)) {
      skipped.add(urlMatch[1]);
      courses.delete(urlMatch[1]);
    } else {
      courses.delete(urlMatch[1]);
      add(urlMatch[1], hText);
    }
  }

  return { courses, skipped };
}

/**
 * Starts reading the enrolment list once per scan. Stream cards without a course link find their
 * course in it (and in the page's course links), by name, code, or the saved course they match.
 */
function startCourseLookup(page: { courses: Map<string, CourseMeta>; skipped: Set<string> }) {
  const enrolled: Promise<EnrolledCourses> = fetchEnrolledCourses(tabFetch)
    .catch(err => ({ ok: false as const, error: String(err) }));
  const courses = async () => mergeCourseMaps(await enrolled, page.courses, page.skipped);
  const resolve = async (text: string) => findCourseIdForText(text, await courses(), getActiveUserCourses());
  return { enrolled, courses, resolve };
}


// Cache for classic Blackboard course announcements to prevent redundant fetches
const classicCourseAnnouncementsCache = new Map<string, Map<string, { html: string; text: string }>>();

/**
 * Fetches course announcements directly from Blackboard's classic webapp endpoint.
 * This endpoint is 100% cookie-authenticated for enrolled students and returns
 * the unabridged HTML without any summary clipping.
 */
async function fetchCourseAnnouncementsClassicWebapp(courseId: string): Promise<Map<string, { html: string; text: string }>> {
  if (classicCourseAnnouncementsCache.has(courseId)) {
    return classicCourseAnnouncementsCache.get(courseId)!;
  }
  const map = new Map<string, { html: string; text: string }>();
  try {
    const res = await bbFetch(`/webapps/blackboard/execute/announcement?method=search&course_id=${encodeURIComponent(courseId)}`, {
      credentials: 'same-origin'
    });
    if (res.ok) {
      const htmlText = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const items = doc.querySelectorAll('#announcementList > li, .announcementList > li, li[id*="announcement"], .item');
      items.forEach(item => {
        const titleEl = item.querySelector('h3, .item h3, .announcement-title, [role="heading"]');
        const title = titleEl?.textContent?.trim().toLowerCase() || '';
        const bodyEl = item.querySelector('.vtbegenerated, .details, .announcement-content, .announcement-body') || item;
        const html = bodyEl.innerHTML || '';
        const text = bodyEl.textContent?.trim() || '';
        const itemId = item.getAttribute('id') || '';
        if (title && text) {
          map.set(title, { html, text });
          if (itemId) map.set(itemId, { html, text });
        }
      });
    }
  } catch {
    // webapp search unavailable
  }
  classicCourseAnnouncementsCache.set(courseId, map);
  return map;
}

/**
 * Orchestrates unabridged announcement retrieval directly via code:
 * 1. Public REST API
 * 2. Internal v1 REST API
 * 3. Classic Blackboard Course Announcement Webapp
 * ZERO DOM clicks. ZERO drawers opened. Pure background memory retrieval.
 */
async function fetchFullAnnouncementBodyFromCode(
  courseId: string | null,
  announcementId: string | null,
  title: string
): Promise<{ text: string; html: string } | null> {
  if (courseId) {
    const bbHeaders = getBlackboardFetchHeaders();

    // 1. Try public REST API endpoint
    if (announcementId) {
      try {
        const res = await bbFetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`, {
          headers: bbHeaders,
          credentials: 'same-origin'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.body) {
            const temp = document.createElement('div');
            temp.innerHTML = data.body;
            const clean = temp.textContent?.trim() || '';
            if (clean) return { text: clean, html: data.body };
          }
        }
      } catch {}

      // 2. Try internal v1 REST API endpoint
      try {
        const res = await bbFetch(`/learn/api/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`, {
          headers: bbHeaders,
          credentials: 'same-origin'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.body) {
            const temp = document.createElement('div');
            temp.innerHTML = data.body;
            const clean = temp.textContent?.trim() || '';
            if (clean) return { text: clean, html: data.body };
          }
        }
      } catch {}
    }

    // 3. Try classic Blackboard course announcements webapp (100% cookie authenticated, returns full HTML)
    const classicMap = await fetchCourseAnnouncementsClassicWebapp(courseId);
    if (classicMap.size > 0) {
      if (announcementId && classicMap.has(announcementId)) {
        return classicMap.get(announcementId)!;
      }
      const titleLower = title.toLowerCase().trim();
      if (classicMap.has(titleLower)) {
        return classicMap.get(titleLower)!;
      }
      const cleanTokens = titleLower.replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
      for (const [key, val] of classicMap.entries()) {
        const keyLower = key.toLowerCase().trim();
        if (titleLower && (keyLower.includes(titleLower) || titleLower.includes(keyLower))) {
          return val;
        }
        if (cleanTokens.length > 0) {
          const matchCount = cleanTokens.filter(t => keyLower.includes(t)).length;
          if (matchCount >= Math.min(2, cleanTokens.length)) {
            return val;
          }
        }
      }
    }

    // 4. Try REST course announcements list endpoint
    try {
      const listRes = await bbFetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements`, {
        headers: bbHeaders,
        credentials: 'same-origin'
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData && Array.isArray(listData.results)) {
          const titleLower = title.toLowerCase().trim();
          const cleanTokens = titleLower.replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

          for (const item of listData.results) {
            if (!item.body) continue;
            const itemTitle = (item.title || '').toLowerCase().trim();
            const matchesId = announcementId && item.id === announcementId;
            const matchesSub = titleLower && (itemTitle.includes(titleLower) || titleLower.includes(itemTitle));
            const tokenMatch = cleanTokens.length > 0 && cleanTokens.filter((t: string) => itemTitle.includes(t)).length >= Math.min(2, cleanTokens.length);

            if (matchesId || matchesSub || tokenMatch) {
              const temp = document.createElement('div');
              temp.innerHTML = item.body;
              const clean = temp.textContent?.trim() || '';
              if (clean) return { text: clean, html: item.body };
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

/** Saves whether the Blackboard session is alive (from the users/me call), for the popup's banner. */
function saveSessionStatus(expired: boolean): void {
  try {
    chrome.storage.local.set({ [SESSION_STATUS_KEY]: { expired, checkedAt: new Date().toISOString() } });
  } catch {
    // The extension may have been reloaded; the next scan saves it again
  }
}

/** What the last gradebook read found, for the scan message and the console line. */
let lastGradebookRead = { signedIn: false, expired: false, courses: 0, coursesRead: 0, skipped: [] as string[] };

/** One line in the page console so a missed deadline can be traced without a debugger. */
function logCourseAnnouncementRead(streamCount: number, courseCount: number, courseIds: string[], failedIds: string[]): void {
  if (courseIds.length === 0) return;
  console.info(
    `[Blackboarder] Scan read ${streamCount} stream announcements and ${courseCount} course announcements ` +
    `from ${courseIds.length - failedIds.length} of ${courseIds.length} courses` +
    (failedIds.length ? ` (${failedIds.length} refused: ${failedIds.join(', ')})` : '')
  );
}

/** Small deterministic string hash (djb2) for building stable ids. */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Scrapes announcements from an open side panel / drawer / peek panel if visible.
 */
function scrapeOpenDrawerAnnouncement(): Announcement | null {
  const drawer = document.querySelector('aside.bb-slideout, div[role="dialog"], div.bb-peek-panel, bb-drawer, .panel-content');
  if (!drawer) return null;

  const titleEl = drawer.querySelector('h1, h2, h3, [role="heading"], .panel-header-title');
  const bodyEl = drawer.querySelector('.panel-content, .panel-body, .announcement-body, .vtbegenerated, [bb-translate]') || drawer;
  const courseEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, .bb-course-title');

  const title = titleEl?.textContent?.trim() || '';
  const text = bodyEl?.textContent?.trim() || '';
  if (!title && text.length < 20) return null;

  const courseInfo = parseCourseDetails(courseEl?.textContent || (document.title !== 'Activity' ? document.title : ''));
  const cleanText = sanitizeDoctorAnnouncementText(text, courseInfo.name, courseInfo.code, title);

  return {
    // Stable id so the same open drawer is not re-processed as a new announcement every scan
    id: `ann_drawer_${stableHash(`${courseInfo.code}|${title}|${cleanText.slice(0, 200)}`)}`,
    courseCode: courseInfo.code,
    courseName: courseInfo.name,
    title: title || 'Course Announcement',
    contentText: cleanText,
    contentHtml: bodyEl?.innerHTML || '',
    sourceUrl: window.location.href,
    scannedAt: new Date().toISOString()
  };
}

/**
 * Orchestrates announcement scraping: auto-expands collapsed cards, reads the page's cards with
 * complete un-truncated text, reads every course's announcements over the REST API, and checks
 * open drawers. Supports incremental scanning by passing known checkpoint IDs.
 */
export async function scrapeAnnouncementsFull(options?: { fullRescan?: boolean }): Promise<Announcement[]> {
  const checkpoint = options?.fullRescan ? emptyCheckpoint() : await getLastScanCheckpoint();

  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
  const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

  // 1. Expand any collapsed "...more" / "Show more" buttons (CSS only)
  await expandAllTruncatedAnnouncements();

  // 2. Scrape regular DOM announcements (skips already processed items and stops when reaching checkpoint)
  const lookup = startCourseLookup(collectPageCourses());
  const domAnnouncements = await scrapeAnnouncements(
    options?.fullRescan ? undefined : knownAnnIds,
    options?.fullRescan ? undefined : knownKeys,
    lookup.resolve
  );

  // 3. Always fetch complete course announcements from Blackboard REST API in parallel
  // This guarantees complete, unabridged announcement bodies for students on /ultra/stream as well as course pages.
  const courses = await lookup.courses();
  const courseIds = Array.from(courses.keys());
  const results = await Promise.all(
    courseIds.map(cid => fetchCourseAnnouncements(tabFetch, cid, courses.get(cid), window.location.origin))
  );
  const apiAnnouncements = results.flatMap(r => (r.ok ? r.announcements : []));
  logCourseAnnouncementRead(domAnnouncements.length, apiAnnouncements.length, courseIds, courseIds.filter((_, i) => !results[i].ok));

  // 4. Merge: full course bodies replace cut-short stream cards of the same course only; an open side drawer replaces its card
  return mergeStreamAndCourseAnnouncements(domAnnouncements, apiAnnouncements, scrapeOpenDrawerAnnouncement());
}

/**
 * Extracts a rough ISO date string from free text if present.
 */
function extractDateStringFromText(text: string): string | undefined {
  if (!text) return undefined;
  const dateMatch = text.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/) ||
                    text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/i);
  if (dateMatch) {
    const d = new Date(dateMatch[0]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

/**
 * Displays a friendly notification prompting user to refresh tab when extension was reloaded.
 */
function showExtensionReloadToast() {
  showSidekickToast(
    'Extension Updated',
    'Blackboarder was reloaded or updated. Please refresh this page (press F5 or Reload) to reconnect.',
    0
  );
}

let activeStreamObserver: MutationObserver | null = null;

// Marks the floating button this copy of the script made, so a copy left behind by an
// extension update never relabels the button of the fresh copy that replaced it
const CONTENT_INSTANCE_ID = Math.random().toString(36).slice(2);

function teardownOrphanedContentScript() {
  if (activeStreamObserver) {
    try {
      activeStreamObserver.disconnect();
    } catch {}
    activeStreamObserver = null;
  }
  const floatingRoot = document.getElementById('bbs-floating-root');
  if (floatingRoot && floatingRoot.dataset.instance === CONTENT_INSTANCE_ID) {
    floatingRoot.style.opacity = '0.7';
    floatingRoot.style.cursor = 'pointer';
    // The button is only an icon; this is the one time it needs words
    const label = floatingRoot.querySelector('.bbs-pill-label') as HTMLElement | null;
    if (label) {
      label.textContent = 'Extension updated - reload tab (F5)';
      label.hidden = false;
    }

    floatingRoot.title = 'Extension reloaded. Please refresh the page (F5) to reconnect.';
  }
}

let toastDismissTimer: any = null;
let lastTabScanToastAt = 0;

// Lightning bolt line icon (the same shape as the extension's icon-bolt)
const BOLT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';
const SPARKLE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="animation: hsb-spin 1.8s linear infinite;"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"></path></svg>';

/**
 * Shows a toast message on top-right of the page with an animated bottom progress line.
 */
function showSidekickToast(
  title: string,
  message: string,
  taskCount: number = 0,
  inProgress: boolean = false
) {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  let toast = document.getElementById('bbs-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bbs-toast';
    toast.className = 'bbs-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div class="bbs-toast-header">
      <span class="bbs-toast-title">
        ${inProgress ? SPARKLE_SVG : BOLT_SVG}
        <span>${title}</span>
      </span>
      <span style="cursor:pointer;opacity:0.6;font-size:13px;padding:2px 4px;" id="bbs-toast-close" title="Dismiss">✕</span>
    </div>
    <div class="bbs-toast-body">${message}</div>
    ${taskCount > 0 ? `
      <div class="bbs-toast-actions">
        <button class="bbs-toast-btn-primary" id="bbs-toast-view">Open Blackboarder</button>
      </div>
    ` : ''}
    <div class="bbs-toast-progress">
      <div class="bbs-toast-progress-fill ${inProgress ? 'is-loading' : 'is-done'}"></div>
    </div>
  `;

  toast.classList.add('bbs-toast-visible');

  document.getElementById('bbs-toast-close')?.addEventListener('click', () => {
    toast?.classList.remove('bbs-toast-visible');
  });

  document.getElementById('bbs-toast-view')?.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, () => {
        if (chrome.runtime?.lastError) {
          // ignore if popup could not be opened
        }
      });
    } catch {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
    }
    toast?.classList.remove('bbs-toast-visible');
  });

  if (!inProgress) {
    toastDismissTimer = setTimeout(() => {
      toast?.classList.remove('bbs-toast-visible');
    }, 4500);
  }
}

/**
 * Injects the floating quick-scan button (a bolt icon) onto Blackboard pages.
 */
function injectFloatingButton(onScanClick: () => void) {
  const existing = document.getElementById('bbs-floating-root');
  if (existing?.dataset.instance === CONTENT_INSTANCE_ID) return;
  // A button from before an extension update no longer works; replace it
  existing?.remove();

  const root = document.createElement('div');
  root.id = 'bbs-floating-root';
  root.dataset.instance = CONTENT_INSTANCE_ID;

  const btn = document.createElement('div');
  btn.className = 'bbs-pill-btn';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', 'Scan Blackboard');
  btn.title = 'Scan Blackboard';
  btn.innerHTML = `
    <span class="bbs-pill-icon">${BOLT_SVG}</span>
    <span class="bbs-pill-label" hidden></span>
    <span class="bbs-pill-badge" id="bbs-floating-badge" style="display:none">0</span>
  `;
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });

  btn.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    onScanClick();
  });

  try {
    const tipSeen = localStorage.getItem('bbs_first_visit_note_seen') === 'true';
    if (!tipSeen) {
      const callout = document.createElement('div');
      callout.className = 'bbs-first-visit-callout';
      callout.innerHTML = `
        <div class="bbs-callout-header">
          <span style="font-weight: 700; font-size: 11.5px;">Blackboarder Ready</span>
          <button type="button" class="bbs-callout-close" aria-label="Dismiss">✕</button>
        </div>
        <div style="font-size: 11px; margin: 4px 0 8px; line-height: 1.4; color: inherit; opacity: 0.85;">
          Click <strong>Scan Blackboard</strong> to find deadlines and marks. Configure or turn off features anytime (Alt+B).
        </div>
      `;
      const dismiss = () => {
        try { localStorage.setItem('bbs_first_visit_note_seen', 'true'); } catch {}
        callout.remove();
      };
      callout.querySelector('.bbs-callout-close')?.addEventListener('click', e => {
        e.stopPropagation();
        dismiss();
      });
      btn.addEventListener('click', dismiss, { once: true });
      root.appendChild(callout);
    }
  } catch {}

  root.appendChild(btn);
  document.body.appendChild(root);
}

/** What the last scan in this tab did, for the RUN_TAB_SCAN reply to the service worker. */
let lastTabScanResult: { ok: boolean; newCount: number; message: string } | null = null;

/**
 * Main scan execution routine. Supports incremental scanning by default.
 */
const scanGate = new ScanGate({
  scan: runScanInner,
  onBecameInteractive: run => setScanStatus({
    state: 'running',
    message: run.fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...'
  }),
  onUnreported: async run => {
    run.reported = true;
    await setScanStatus({ state: 'done', message: 'Scan finished.', newCount: 0 });
  }
});

/**
 * Runs a scan in this Blackboard tab and saves the result. Lives here, not in the popup,
 * so closing the popup does not cancel it; progress goes to storage for the popup to show.
 * A Scan press during a quiet scan joins it instead of being dropped (see ScanGate).
 */
export function runScan(interactive: boolean = false, fullRescan: boolean = false): Promise<void> {
  return scanGate.run(interactive, fullRescan);
}

async function runScanInner(run: ScanRun) {
  const onExamPage = isExamSchedulePage(window.location, document);
  await runBlackboardScan(run);
  if (!onExamPage) await refreshExamScheduleAfterScan(run);
}

async function waitForExamScheduleTasks(maxWaitMs = 5000): Promise<DeadlineTask[]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const tasks = scrapeExamScheduleFromDoc(document);
    if (tasks.length > 0) return tasks;
    await new Promise(r => setTimeout(r, 250));
  }
  return scrapeExamScheduleFromDoc(document);
}

async function runExamScheduleScan(run: ScanRun, waitMs?: number): Promise<{ found: number; added: number; updated: number }> {
  if (run.interactive) {
    await setScanStatus({ state: 'running', message: 'Reading exam schedule...' });
  }

  const tombstones: Record<string, string> = await new Promise(resolve => {
    try {
      chrome.storage.local.get(['bbs_tombstones'], res => resolve((res?.bbs_tombstones as Record<string, string>) || {}));
    } catch {
      resolve({});
    }
  });

  const examTasks = (await waitForExamScheduleTasks(waitMs ?? (run.interactive ? 5000 : 3500))).filter(t => !tombstones[t.id]);
  if (examTasks.length === 0) {
    lastTabScanResult = { ok: true, newCount: 0, message: 'No exam schedule rows found on this page.' };
    if (run.interactive) {
      showSidekickToast('Blackboarder', 'No exam rows found on this page yet. Wait for the table to load and try again.');
      run.reported = true;
      await setScanStatus({ state: 'done', message: 'No exam schedule rows found on this page.', newCount: 0 });
    }
    return { found: 0, added: 0, updated: 0 };
  }

  const existingTasks = await getTasks();
  const { tasks: mergedTasks, addedCount, updatedCount } = mergeExamScheduleTasks(existingTasks, examTasks, tombstones);
  const finalTasks = deduplicateTaskList(mergedTasks).filter(isValidTask);

  await autoRegisterDiscoveredCourses(examTasks).catch(() => {});
  repairTaskWeightsAndRooms(finalTasks);
  await saveTasksMergingLatest(finalTasks);

  try {
    const currentSettings = await getSettings();
    if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
      chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
    }
  } catch {}

  const badge = document.getElementById('bbs-floating-badge');
  if (badge) {
    const pendingCount = finalTasks.filter(t => t.status === 'pending').length;
    if (pendingCount > 0) {
      badge.textContent = String(pendingCount);
      badge.style.display = 'inline-block';
    }
  }

  const changedTotal = addedCount + updatedCount;
  lastTabScanResult = { ok: true, newCount: addedCount, message: `Read ${examTasks.length} exams from the exam schedule.` };
  if (run.interactive || changedTotal > 0) {
    const msg = addedCount > 0
      ? `Added <strong>${addedCount}</strong> exam${addedCount > 1 ? 's' : ''}${updatedCount > 0 ? ` and updated ${updatedCount}` : ''} from your Exam Schedule!`
      : updatedCount > 0
        ? `Updated <strong>${updatedCount}</strong> exam${updatedCount > 1 ? 's' : ''} from your Exam Schedule!`
        : `All ${examTasks.length} exams on this schedule are already in your calendar.`;
    showSidekickToast('Exam Schedule Scanned', msg, changedTotal);
  }
  if (run.interactive) {
    run.reported = true;
    await setScanStatus({
      state: 'done',
      message: addedCount > 0
        ? `Added ${addedCount} exam${addedCount > 1 ? 's' : ''}${updatedCount > 0 ? ` and updated ${updatedCount}` : ''} from the exam schedule!`
        : updatedCount > 0
          ? `Updated ${updatedCount} exam${updatedCount > 1 ? 's' : ''} from the exam schedule.`
          : `Up to date. All ${examTasks.length} exams on this page are in your calendar.`,
      newCount: addedCount
    });
  }
  return { found: examTasks.length, added: addedCount, updated: updatedCount };
}

/**
 * After a Scan the student started on Blackboard: the service worker reads the university's exam
 * schedule page in a background tab (at most hourly), and the result joins the scan message.
 */
async function refreshExamScheduleAfterScan(run: ScanRun): Promise<void> {
  if (!run.interactive || !isExtensionContextValid()) return;
  const before = await getScanStatus();
  if (!before || before.state !== 'done') return;
  await setScanStatus({ state: 'running', message: `${before.message} Reading your exam schedule...` });
  const res: ExamRefreshResult | null = await new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_EXAM_SCHEDULE', force: run.fullRescan }, r => {
        void chrome.runtime.lastError;
        resolve(r || null);
      });
    } catch {
      resolve(null);
    }
  });
  const added = res?.state === 'read' ? res.added || 0 : 0;
  const updated = res?.state === 'read' ? res.updated || 0 : 0;
  await setScanStatus({
    state: 'done',
    message: before.message + examRefreshNote(res),
    newCount: (before.newCount || 0) + added
  });
  if (added + updated > 0) {
    showSidekickToast('Exam Schedule', `${added ? `Added <strong>${added}</strong> exam${added > 1 ? 's' : ''}` : ''}${added && updated ? ' and ' : ''}${updated ? `updated ${updated}` : ''} from your exam schedule.`, added);
  }
}

async function runBlackboardScan(run: ScanRun) {
  const { fullRescan } = run;
  if (!isExtensionContextValid()) {
    teardownOrphanedContentScript();
    if (run.interactive) {
      showExtensionReloadToast();
    } else {
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
    }
    lastTabScanResult = { ok: false, newCount: 0, message: 'Blackboarder was reloaded. Refresh the Blackboard tab and try again.' };
    return;
  }

  // Hydrate user-configured courses & schedules before scanning
  await getUserCourses().catch(() => {});

  if (isExamSchedulePage(window.location, document)) {
    await runExamScheduleScan(run);
    return;
  }

  if (run.interactive) {
    await setScanStatus({ state: 'running', message: fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...' });
  }

  try {
    const checkpoint = fullRescan ? emptyCheckpoint() : await getLastScanCheckpoint();
    const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
    const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
    const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

    // 1. Page-only sources: direct due date cards (incremental), stream submission and grade cards
    const domDirectTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : knownDirectIds);
    const domSubmissionUpdates = scrapeStreamSubmissionsAndGrades();
    await expandAllTruncatedAnnouncements();
    const page = collectPageCourses();
    const lookup = startCourseLookup(page);

    // 2. The HTTP sources the service worker scanner reads too (session, courses, stream,
    // course announcements, gradebooks), in parallel with the page's announcement cards
    const [api, domAnnouncements] = await Promise.all([
      readBlackboardApi(tabFetch, {
        origin: window.location.origin,
        pageCourses: page.courses,
        pageSkipped: page.skipped,
        enrolled: lookup.enrolled
      }),
      scrapeAnnouncements(fullRescan ? undefined : knownAnnIds, fullRescan ? undefined : knownKeys, lookup.resolve)
    ]);
    const { sources } = api;
    lastGradebookRead = {
      signedIn: sources.session === 'ok',
      expired: sources.session === 'expired',
      courses: api.courseIds.length,
      coursesRead: sources.gradebook.ok,
      skipped: api.skippedGrades
    };
    // Tell the popup whether the session is alive, so it can show a banner when it is not
    if (lastGradebookRead.signedIn || lastGradebookRead.expired) saveSessionStatus(lastGradebookRead.expired);
    if (lastGradebookRead.signedIn) {
      // What each gradebook held on the last scan, kept on this device only, to explain a missing mark
      try {
        chrome.storage.local.set({ [GRADEBOOK_REPORT_KEY]: { readAt: new Date().toISOString(), rows: api.gradebookReport } });
      } catch {}
      logCourseAnnouncementRead(domAnnouncements.length, api.courseAnnouncements.length, api.courseIds, sources.announcements.failedCourseIds);
    }

    // 3. Full course bodies replace cut-short page cards of the same course only; an open side drawer replaces its card
    const tabAnnouncements = mergeStreamAndCourseAnnouncements(domAnnouncements, api.courseAnnouncements, scrapeOpenDrawerAnnouncement());

    // New courses take the colour Blackboard gives them (courses already set up keep theirs)
    await autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getBlackboardJson)).catch(() => {});

    // 4. Extract, put marks on tasks, save and checkpoint: the same steps as the service worker scan.
    // Marks: stream cards + stream API, then the gradebook (it has every mark, so it goes last and wins)
    const result = await runScanPipeline({
      streamAnnouncements: api.stream.announcements,
      courseAnnouncements: tabAnnouncements,
      directTasks: [...domDirectTasks, ...api.stream.directTasks],
      submissionUpdates: [...domSubmissionUpdates, ...api.stream.submissionUpdates, ...api.gradebookUpdates],
      discoveredCourses: scrapeEnrolledCourses(),
      gradebook: {
        expired: lastGradebookRead.expired,
        courses: lastGradebookRead.courses,
        coursesRead: lastGradebookRead.coursesRead,
        skipped: lastGradebookRead.skipped
      },
      sources: lastGradebookRead.signedIn ? sources : undefined,
      checkpoint,
      fullRescan,
      isInteractive: () => run.interactive
    });
    lastTabScanResult = { ok: true, newCount: result.newCount, message: result.message };

    // Automatically push newly scanned tasks & courses to Firebase / sync server
    try {
      const currentSettings = await getSettings();
      if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
        chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
      }
    } catch {}

    const totalNewCount = result.newCount;

    // Update floating badge
    const badge = document.getElementById('bbs-floating-badge');
    if (badge && result.pendingCount > 0) {
      badge.textContent = String(result.pendingCount);
      badge.style.display = 'inline-block';
    }

    if (run.interactive || totalNewCount > 0) {
      const msg = totalNewCount > 0
        ? `Found <strong>${totalNewCount}</strong> new deadline${totalNewCount > 1 ? 's' : ''} (Quizzes & Assignments) from Blackboard!`
        : `All deadlines up to date. (${result.pendingCount} pending tasks in dashboard)`;
      showSidekickToast('Scan Complete', msg, totalNewCount);
      lastTabScanToastAt = Date.now();
    }
    if (run.interactive) {
      run.reported = true;
      await setScanStatus({ state: 'done', message: result.message, newCount: totalNewCount });
    }
  } catch (error: any) {
    if (error?.message?.includes('Extension context invalidated')) {
      teardownOrphanedContentScript();
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
      if (run.interactive) {
        showExtensionReloadToast();
      }
      lastTabScanResult = { ok: false, newCount: 0, message: 'Blackboarder was reloaded. Refresh the Blackboard tab and try again.' };
      return;
    }
    console.error('Error during Blackboard scan:', error);
    lastTabScanResult = { ok: false, newCount: 0, message: 'Scan hit a problem. Refresh the Blackboard tab and try again.' };
    if (run.interactive) {
      showSidekickToast('Scan Notice', 'Blackboard scan encountered an issue. If page layout changed, try refreshing the tab.', 0);
      run.reported = true;
      await setScanStatus({ state: 'error', message: 'Scan hit a problem. Refresh the Blackboard tab and try again.' });
    }
  }
}

function isBlackboardSite(): boolean {
  if (isExamSchedulePage(window.location, document)) {
    return true;
  }
  const host = window.location.hostname.toLowerCase();
  if (host.includes('blackboard.com') || host.includes('blackboard.sharjah.ac.ae') || host.includes('elearning.sharjah.ac.ae')) {
    return true;
  }
  if (host.includes('blackboard') || host.startsWith('learn.') || host.startsWith('ilearn.') || host.startsWith('elearning.')) {
    return true;
  }
  // Any university's Blackboard Learn: its pages live under /ultra/ or /webapps/
  if (/^\/(?:ultra|webapps)(?:\/|$)/i.test(window.location.pathname)) {
    return true;
  }
  if (host.endsWith('sharjah.ac.ae')) {
    return host.includes('bb') || host.includes('learn') || host.includes('elearning') || Boolean(document.querySelector('#courseMenuPalette, .bb-course-title, #announcementList, bb-announcement-card, .stream-item-container, #activity-stream, [data-course-id]'));
  }
  return false;
}

// Initialize on page load
function init() {
  if (!isBlackboardSite()) {
    return;
  }
  const onExamPage = isExamSchedulePage(window.location, document);

  // Hydrate custom courses on startup
  getUserCourses().catch(() => {});
  // First visit: take the university from this Blackboard address, unless the student chose one
  detectUniversityFromHost(window.location.hostname).catch(() => null);

  // Listen for custom course updates from popup or background
  try {
    if (isExtensionContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes['bbs_user_courses']) {
          const newCourses = changes['bbs_user_courses'].newValue;
          if (Array.isArray(newCourses)) {
            setActiveUserCourses(newCourses);
          } else {
            setActiveUserCourses([]);
          }
        }
      });
    }
  } catch {
    // Context may already be invalidated
  }

  // Floating button: HTTP first in the service worker; when Blackboard does not answer over HTTP
  // the service worker runs the scan here, in this tab (RUN_TAB_SCAN), instead of opening another
  injectFloatingButton(() => {
    if (!isExtensionContextValid()) return;
    const scanStartedAt = Date.now();
    showSidekickToast('Scanning Blackboard...', 'Checking announcements and enrolled courses...', 0, true);

    chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', interactive: true }, async res => {
      void chrome.runtime.lastError;
      const tasks = await getTasks().catch(() => []);
      const pendingCount = tasks.filter(t => t.status === 'pending').length;
      const badge = document.getElementById('bbs-floating-badge');
      if (badge) {
        if (pendingCount > 0) {
          badge.textContent = String(pendingCount);
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }

      // If scanPage() ran in this tab and already showed the completion toast, don't show a second duplicate toast!
      if (lastTabScanToastAt >= scanStartedAt) {
        return;
      }

      const msg = res?.ok
        ? (res.newCount ? `Added <strong>${res.newCount}</strong> new deadlines to calendar!` : (res.message || 'All deadlines up to date.'))
        : (res?.message || 'Could not reach Blackboard.');
      showSidekickToast(res?.ok ? 'Scan Complete' : 'Scan Notice', msg, res?.newCount || 0);
    });
  });

  if (!onExamPage) {
    // Blackboard's course colours follow the student's course colours
    startCourseColorPainter(getBlackboardJson);

    // Course and type filter bar on the Activity page
    startActivityFilter(getBlackboardJson);
  }

  // Keyboard shortcut listener: Alt+B (or Option+Shift+B on Mac) to open popup
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'b' || e.key === 'B')) {
      if (isExtensionContextValid()) {
        try {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        } catch {
          // Extension context might be invalidated or unavailable
        }
      }
    }
  });

  // Listen for messages from popup or background
  try {
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'SCRAPE_PAGE') {
          (async () => {
            try {
              await getUserCourses().catch(() => {});
              if (isExamSchedulePage(window.location, document)) {
                const directTasks = await waitForExamScheduleTasks(3500);
                await autoRegisterDiscoveredCourses(directTasks).catch(() => {});
                sendResponse({
                  announcements: [],
                  directTasks,
                  submissionUpdates: [],
                  discoveredCourses: [],
                  isIncremental: false,
                  lastScannedAt: new Date().toISOString()
                });
                return;
              }
              const fullRescan = Boolean(message.fullRescan);
              const checkpoint = fullRescan
                ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] }
                : await getLastScanCheckpoint();

              const directTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : new Set(checkpoint.processedDirectTaskIds));
              const announcements = await scrapeAnnouncementsFull({ fullRescan });
              const submissionUpdates = scrapeStreamSubmissionsAndGrades();
              const discoveredCourses = scrapeEnrolledCourses();

              // Auto-register discovered courses immediately
              await autoRegisterDiscoveredCourses([...directTasks, ...announcements, ...discoveredCourses]).catch(() => {});

              sendResponse({
                announcements,
                directTasks,
                submissionUpdates,
                discoveredCourses,
                isIncremental: !fullRescan,
                lastScannedAt: checkpoint.lastScannedAt
              });
            } catch (err) {
              console.error('[Scraper] SCRAPE_PAGE failed:', err);
              sendResponse({ announcements: [], directTasks: [], submissionUpdates: [], discoveredCourses: [] });
            }
          })();
          return true; // Keep message channel open for async response
        } else if (message.type === 'READ_EXAM_SCHEDULE') {
          // Sent by the service worker after it opened this page in a background tab
          if (!isExamSchedulePage(window.location, document)) {
            sendResponse({ found: 0 });
            return false;
          }
          getUserCourses().catch(() => {})
            .then(() => runExamScheduleScan({ interactive: false, fullRescan: false, reported: false }, 15000))
            .then(res => sendResponse(res))
            .catch(() => sendResponse({ found: 0 }));
          return true;
        } else if (message.type === 'PING_SCANNER') {
          sendResponse({ ok: true, scanning: scanGate.running, loginPage: isSignInPage() });
          return false;
        } else if (message.type === 'RUN_TAB_SCAN') {
          // Sent by the service worker when Blackboard did not answer over HTTP: scan this page
          // and answer when the scan (and, for a visible one, the exam schedule read) is done
          const startedAt = Date.now();
          const interactive = Boolean(message.interactive);
          lastTabScanResult = null;
          runScan(interactive, Boolean(message.fullRescan))
            .then(async () => {
              const status = interactive ? await getScanStatus() : null;
              if (status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt) {
                sendResponse({ ok: status.state === 'done', newCount: status.newCount || 0, message: status.message });
              } else {
                sendResponse(lastTabScanResult || { ok: true, newCount: 0, message: 'Scan finished.' });
              }
            })
            .catch(err => sendResponse({ ok: false, newCount: 0, message: String(err) }));
          return true; // async
        } else if (message.type === 'TRIGGER_SCAN') {
          chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', fullRescan: Boolean(message.fullRescan) }, res => {
            sendResponse({ success: Boolean(res?.ok) });
          });
          return true; // async
        }
        return false;
      });
    }
  } catch {
    // Context may already be invalidated
  }

  // Automatic scan when a Blackboard page loads (Settings > Scanning), at most every 30 minutes
  if (!onExamPage) scheduleAutoScan();
}

/** A Blackboard sign-in page rather than a signed-in one (the service worker treats it as a signed-out session). */
function isSignInPage(): boolean {
  return Boolean(document.querySelector('input[type="password"]')) || /(?:^|\/)login(?:\/|$)/i.test(window.location.pathname);
}

/**
 * Asks the service worker for a quiet scan: HTTP first, never reading the exam schedule. When
 * Blackboard does not answer over HTTP the scan runs in this tab; no other tab is opened.
 */
function scheduleAutoScan(): void {
  getSettings()
    .then(settings => {
      if (!settings.autoScanOnPageLoad || !isExtensionContextValid() || isSignInPage()) return;
      setTimeout(async () => {
        if (!isExtensionContextValid()) return;
        if (!(await claimAutoScan(chrome.storage.local as any))) return;
        try {
          chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', auto: true }, () => {
            void chrome.runtime.lastError;
          });
        } catch {
          // Extension context invalidated: the next page load asks again
        }
      }, 2500);
    })
    .catch(() => {});
}

// Run after document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
