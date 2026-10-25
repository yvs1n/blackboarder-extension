import { Announcement, DeadlineTask, TaskSubmissionUpdate } from '../types';
import { processAnnouncementsBatch, titleCourseKeyFor } from '../engine/hybridExtractor';
import { getSettings, getTasks, saveTasksMergingLatest, saveAnnouncements, getLastScanCheckpoint, saveLastScanCheckpoint, isExtensionContextValid, getUserCourses, autoRegisterDiscoveredCourses, setScanStatus } from '../utils/storage';
import { setActiveUserCourses } from '../core/userCourses';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, isBlackboardSystemNoise, hasValidAcademicCourseCode, isValidTask } from '../core/courseHelper';
import { parseDirectStreamCard, parseSubmissionOrGradeCard } from '../utils/streamParser';
import { deduplicateTaskList } from '../utils/taskMerge';
import { gradebookToUpdates, applySubmissionUpdates } from '../utils/gradebook';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../utils/announcementMerge';
import { startCourseColorPainter, discoveredCoursesWithColors } from './courseColorPainter';
import { startActivityFilter } from './activityFilter';

/**
 * Known University of Sharjah Blackboard Course IDs mapped to courses.
 * Used for instant, zero-click background API lookups when stream cards omit course parameters.
 */
// Ids checked against the owner's Blackboard course list on 2026-10-22 (they were swapped for
// Physics 1, Physics 1 Lab and Islamic Culture before). "Physics 1 - ALL" is the shared section
// that posts the homework.
export const KNOWN_UOS_COURSE_IDS = [
  { pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|1502101|0402101)/i, courseId: '_87148_1', name: 'Introduction to Computer Eng.', code: '1502 101' },
  { pattern: /(?:calculus|calc\b|حسبان|1440133|1440131)/i, courseId: '_86929_1', name: 'Calculus I for Engineering', code: '1440 133' },
  { pattern: /(?:english|eap\b|academic\s*purposes|إنجليزي|0202112)/i, courseId: '_87240_1', name: 'English for Academic Purposes', code: '0202 112' },
  { pattern: /(?:physics.*lab|فيزياء.*عملي|مختبر.*فيزياء|1430116)/i, courseId: '_85276_1', name: 'Physics 1 Lab', code: '1430 116' },
  { pattern: /(?:physics\s*1\s*-\s*all)/i, courseId: '_88369_1', name: 'Physics 1', code: '1430 115' },
  { pattern: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|1430115)/i, courseId: '_84837_1', name: 'Physics 1', code: '1430 115' },
  { pattern: /(?:islamic|ثقافة\s*إسلامية|0104100)/i, courseId: '_87186_1', name: 'Islamic Culture', code: '0104 100' }
];

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

  // 2. Pre-seed with any known registered course IDs if user is enrolled
  KNOWN_UOS_COURSE_IDS.forEach(k => {
    register(k.name, k.code);
  });

  return discovered;
}

/**
 * Scrapes announcements from Blackboard (Classic, Ultra Course, and Ultra Stream).
 * Supports incremental scanning by stopping when hitting announcements already processed.
 */
async function scrapeAnnouncements(knownAnnIds?: Set<string>, knownKeys?: Set<string>): Promise<Announcement[]> {
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

    // Fallback: If courseId is still empty, map from known UOS course database
    if (!courseId) {
      const courseStr = `${cardCourseName} ${cardCourseCode} ${rawCourseStr} ${title}`;
      for (const m of KNOWN_UOS_COURSE_IDS) {
        if (m.pattern.test(courseStr)) {
          courseId = m.courseId;
          break;
        }
      }
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

/** Course id -> course name, filled while collecting course ids. */
const courseNamesById = new Map<string, string>();

/**
 * Extracts all Blackboard course IDs from the URL, DOM elements, and student course API.
 */
async function extractAllCourseIdsFromPage(): Promise<string[]> {
  const ids = new Set<string>();

  // 0. Seed with known registered student course IDs
  KNOWN_UOS_COURSE_IDS.forEach(k => ids.add(k.courseId));

  // 1. Current URL
  const urlMatch = window.location.href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
  if (urlMatch) ids.add(urlMatch[1]);

  // 2. DOM elements with data attributes
  document.querySelectorAll('[data-course-id], [data-course]').forEach(el => {
    const cid = el.getAttribute('data-course-id') || el.getAttribute('data-course');
    if (cid && cid.startsWith('_')) ids.add(cid);
  });

  // 3. Links to courses on stream cards (their text is the course name)
  document.querySelectorAll('a[href*="/courses/"], a[href*="course_id="], a[href*="launcher?type=Course"]').forEach(a => {
    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
    const m = href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
    if (m) {
      ids.add(m[1]);
      const name = a.textContent?.trim() || '';
      if (name && !courseNamesById.has(m[1])) courseNamesById.set(m[1], name);
    }
  });

  // 4. Blackboard Learn user enrolled courses REST API
  try {
    const res = await bbFetch('/learn/api/public/v1/users/me/courses?expand=course', {
      headers: getBlackboardFetchHeaders(),
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        for (const item of data.results) {
          if (item.courseId && typeof item.courseId === 'string' && item.courseId.startsWith('_')) {
            ids.add(item.courseId);
            const name = item.course?.name;
            if (typeof name === 'string' && name.trim() && !courseNamesById.has(item.courseId)) {
              courseNamesById.set(item.courseId, name.trim());
            }
          }
        }
      }
    }
  } catch {
    // Ignore API discovery failure if offline or permissions restricted
  }

  return Array.from(ids);
}

/**
 * Extracts Blackboard course ID from the URL or DOM if present.
 */
export function extractCourseIdFromPage(): string | null {
  const urlMatch = window.location.href.match(/courses\/(_\d+_\d+)/) ||
                   window.location.href.match(/course_id=(_\d+_\d+)/);
  if (urlMatch) return urlMatch[1];
  const el = document.querySelector('[data-course-id]');
  if (el) {
    const cid = el.getAttribute('data-course-id');
    if (cid && cid.startsWith('_')) return cid;
  }
  return null;
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

/**
 * Attempts to fetch complete announcement bodies directly from Blackboard's authenticated REST API.
 */
async function fetchCourseAnnouncementsApi(
  courseId: string,
  fallbackCourseName?: string,
  fallbackCourseCode?: string
): Promise<Announcement[] | null> {
  try {
    // The public REST API can refuse students; Ultra's own pages use the internal one
    let results: any[] | null = null;
    for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
      try {
        const res = await bbFetch(`${base}/courses/${encodeURIComponent(courseId)}/announcements`, {
          headers: getBlackboardFetchHeaders(),
          credentials: 'same-origin'
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.results)) {
          results = data.results;
          break;
        }
      } catch {}
    }
    if (!results) return null;

    let cName = fallbackCourseName || '';
    let cCode = fallbackCourseCode || '';

    const knownName = courseNamesById.get(courseId);
    if (knownName) {
      const parsed = parseCourseDetails(knownName);
      cName = parsed.name;
      cCode = parsed.code;
    } else if ((!cName || !cCode) && window.location.href.includes(courseId)) {
      // Only trust the page heading on that course's own page; on the stream it says "Activity Stream"
      const pageHeadingEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
      const rawCourseText = pageHeadingEl?.textContent?.trim() || '';
      if (rawCourseText) {
        const parsed = parseCourseDetails(rawCourseText);
        if (!cName) cName = parsed.name;
        if (!cCode) cCode = parsed.code;
      }
    }

    return results.map((item: any, idx: number) => {
      const temp = document.createElement('div');
      // Public API: body is an HTML string. Internal API: { displayText, rawText }.
      const bodyHtml = typeof item.body === 'string' ? item.body : (item.body?.displayText || item.body?.rawText || '');
      item = { ...item, body: bodyHtml };
      temp.innerHTML = item.body || '';
      const text = temp.textContent?.trim() || temp.innerText?.trim() || '';
      const cleanCourseCode = (cCode && cCode !== 'UOS') ? cCode : '';
      const cleanCourseName = (cName && cName.toLowerCase() !== 'uos') ? cName : 'General Course';
      const cleanText = sanitizeDoctorAnnouncementText(text, cleanCourseName, cleanCourseCode, item.title);

      return {
        id: `ann_api_${item.id || idx}`,
        courseCode: cleanCourseCode,
        courseName: cleanCourseName,
        title: item.title || `Announcement ${idx + 1}`,
        postedAt: item.created || new Date().toISOString(),
        contentText: cleanText,
        contentHtml: item.body || '',
        sourceUrl: window.location.href,
        scannedAt: new Date().toISOString()
      };
    }).filter((a: Announcement) => a.contentText && a.contentText.length > 5);
  } catch (err) {
    console.info('[Scraper] Course announcements not readable, using the page instead:', String(err));
    return [];
  }
}

/**
 * Reads the student's marks from each course gradebook, the same requests Ultra's Grades page
 * makes: /learn/api/v1/users/me for the user id, then columns (names, max points) and grades
 * per course. A course that refuses is skipped.
 */
/** What the last gradebook read found, for the scan message and the console line. */
let lastGradebookRead = { signedIn: false, courses: 0, coursesRead: 0 };

async function fetchGradebookUpdates(): Promise<TaskSubmissionUpdate[]> {
  lastGradebookRead = { signedIn: false, courses: 0, coursesRead: 0 };
  const getJson = async (path: string) => {
    const res = await bbFetch(path, { headers: getBlackboardFetchHeaders(), credentials: 'same-origin' });
    return res.ok ? res.json() : null;
  };
  let userId = '';
  try {
    userId = (await getJson('/learn/api/v1/users/me'))?.id || '';
  } catch {}
  if (!userId) return [];
  lastGradebookRead.signedIn = true;

  const courseIds = await extractAllCourseIdsFromPage();
  lastGradebookRead.courses = courseIds.length;
  const perCourse = await Promise.all(courseIds.map(async cid => {
    try {
      const [cols, grades] = await Promise.all([
        getJson(`/learn/api/v1/courses/${encodeURIComponent(cid)}/gradebook/columns?includeInvisible=false`),
        getJson(`/learn/api/v1/courses/${encodeURIComponent(cid)}/gradebook/grades?limit=200&userId=${encodeURIComponent(userId)}`)
      ]);
      if (!Array.isArray(cols?.results) || !Array.isArray(grades?.results)) return [];
      lastGradebookRead.coursesRead++;
      // Blackboard's own course name first; the built-in list only when it is unknown
      const known = KNOWN_UOS_COURSE_IDS.find(k => k.courseId === cid);
      const apiName = courseNamesById.get(cid);
      const parsed = apiName ? parseCourseDetails(apiName) : null;
      const course = parsed && parsed.name !== 'General Course'
        ? { name: parsed.name, code: parsed.code || known?.code || '' }
        : known ? { name: known.name, code: known.code } : { name: '', code: '' };
      return gradebookToUpdates(cols.results, grades.results, {
        courseName: course.name !== 'General Course' ? course.name : undefined,
        courseCode: course.code
      });
    } catch {
      return [];
    }
  }));
  const updates = perCourse.flat();
  console.info(`[Blackboarder] Gradebook: ${updates.filter(u => u.submissionStatus === 'graded').length} marks from ${courseIds.length} courses`);
  return updates;
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
 * Orchestrates announcement scraping: auto-expands collapsed cards, checks REST API,
 * checks open drawers, and scrapes DOM cards with complete un-truncated text.
 * Supports incremental scanning by passing known checkpoint IDs.
 */
export async function scrapeAnnouncementsFull(options?: { fullRescan?: boolean }): Promise<Announcement[]> {
  const checkpoint = options?.fullRescan
    ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [], processedAnnouncementKeys: [] }
    : await getLastScanCheckpoint();

  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
  const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

  // 1. Expand any collapsed "...more" / "Show more" buttons (CSS only)
  await expandAllTruncatedAnnouncements();

  // 2. Scrape regular DOM announcements (skips already processed items and stops when reaching checkpoint)
  const domAnnouncements = await scrapeAnnouncements(
    options?.fullRescan ? undefined : knownAnnIds,
    options?.fullRescan ? undefined : knownKeys
  );

  // 3. Always fetch complete course announcements from Blackboard REST API in parallel
  // This guarantees complete, unabridged announcement bodies for students on /ultra/stream as well as course pages.
  const apiAnnouncements: Announcement[] = [];
  const courseIds = await extractAllCourseIdsFromPage();
  if (courseIds.length > 0) {
    const results = await Promise.all(
      courseIds.map(cid => {
        const matched = domAnnouncements.find(a => a.id.includes(cid) || a.sourceUrl.includes(cid));
        return fetchCourseAnnouncementsApi(cid, matched?.courseName, matched?.courseCode).catch(() => null);
      })
    );
    for (const arr of results) {
      if (arr) apiAnnouncements.push(...arr);
    }
    const refused = results.filter(r => r === null).length;
    // One line in the page console so a missed deadline can be traced without a debugger
    console.info(
      `[Blackboarder] Scan read ${domAnnouncements.length} stream announcements and ${apiAnnouncements.length} course announcements ` +
      `from ${courseIds.length - refused} of ${courseIds.length} courses` +
      (refused ? ` (${refused} refused: ${courseIds.filter((_, i) => results[i] === null).join(', ')})` : '')
    );
  }

  // 4. Scrape any currently open side drawer/modal
  const drawerAnn = scrapeOpenDrawerAnnouncement();

  // 5. Merge: full course bodies replace cut-short stream cards of the same course only
  return mergeStreamAndCourseAnnouncements(domAnnouncements, apiAnnouncements, drawerAnn);
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

/**
 * Shows a toast message on top-right of the page.
 */
function showSidekickToast(title: string, message: string, taskCount: number = 0) {
  let toast = document.getElementById('bbs-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bbs-toast';
    toast.className = 'bbs-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div class="bbs-toast-header">
      <span class="bbs-toast-title">${BOLT_SVG}${title}</span>
      <span style="cursor:pointer;opacity:0.6;" id="bbs-toast-close">✕</span>
    </div>
    <div class="bbs-toast-body">${message}</div>
    ${taskCount > 0 ? `
      <div class="bbs-toast-actions">
        <button class="bbs-toast-btn-primary" id="bbs-toast-view">Open Blackboarder</button>
      </div>
    ` : ''}
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

  setTimeout(() => {
    toast?.classList.remove('bbs-toast-visible');
  }, 6000);
}

// Lightning bolt line icon (the same shape as the extension's icon-bolt)
const BOLT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';

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
  root.appendChild(btn);
  document.body.appendChild(root);
}

/**
 * Main scan execution routine. Supports incremental scanning by default.
 */
let scanRunning = false;

/**
 * Runs a scan in this Blackboard tab and saves the result. Lives here, not in the popup,
 * so closing the popup does not cancel it; progress goes to storage for the popup to show.
 */
async function runScan(interactive: boolean = false, fullRescan: boolean = false) {
  if (scanRunning) return;
  scanRunning = true;
  try {
    await runScanInner(interactive, fullRescan);
  } finally {
    scanRunning = false;
  }
}

async function runScanInner(interactive: boolean, fullRescan: boolean) {
  if (!isExtensionContextValid()) {
    teardownOrphanedContentScript();
    if (interactive) {
      showExtensionReloadToast();
    } else {
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
    }
    return;
  }

  // Hydrate user-configured courses & schedules before scanning
  await getUserCourses().catch(() => {});

  if (interactive) {
    await setScanStatus({ state: 'running', message: fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...' });
  }

  try {
    const checkpoint = fullRescan
      ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] }
      : await getLastScanCheckpoint();

    const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
    const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);

    // 1. Scrape direct due date cards (incremental)
    // Stream task ids are deterministic, so a card the user deleted would come back on a full re-scan
    // unless the deletion record is honoured here
    const tombstones: Record<string, string> = await new Promise(resolve => {
      try {
        chrome.storage.local.get(['bbs_tombstones'], res => resolve((res?.bbs_tombstones as Record<string, string>) || {}));
      } catch {
        resolve({});
      }
    });
    const directStreamTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : knownDirectIds).filter(t => !tombstones[t.id]);

    // 2. Scrape announcement cards (incremental)
    const announcements = await scrapeAnnouncementsFull({ fullRescan });

    // 3. Submission receipts and posted marks: stream cards, then the gradebook (it has every mark, so it goes last and wins)
    const submissionUpdates = scrapeStreamSubmissionsAndGrades();
    submissionUpdates.push(...await fetchGradebookUpdates().catch(() => [] as TaskSubmissionUpdate[]));

    // 4. Auto-discover enrolled courses from page
    const discoveredCourses = scrapeEnrolledCourses();

    // New courses take the colour Blackboard gives them (courses already set up keep theirs)
    await autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getBlackboardJson)).catch(() => {});

    if (directStreamTasks.length === 0 && announcements.length === 0 && submissionUpdates.length === 0) {
      if (interactive) {
        showSidekickToast('Blackboarder', 'Up to date. No new deadlines found since last scan.');
        await setScanStatus({ state: 'done', message: 'Up to date. No new deadlines since the last scan.', newCount: 0 });
      }
      return;
    }

    // Progress is written at most every 400 ms so storage is not flooded
    let lastProgressWrite = 0;
    const reportProgress = (done: number, total: number) => {
      if (!interactive) return;
      const now = Date.now();
      if (done !== 0 && done !== total && now - lastProgressWrite < 400) return;
      lastProgressWrite = now;
      void setScanStatus({
        state: 'running',
        message: `Read ${announcements.length} announcements & ${directTasks.length} stream items. Extracting ${done}/${total}...`,
        done,
        total
      });
    };
    const directTasks = directStreamTasks;

    const settings = await getSettings();
    const existingTasks = await getTasks();

    // Save announcements to storage (merges with existing)
    if (announcements.length > 0) {
      await saveAnnouncements(announcements);
    }

    // Process announcements for deadlines (skips already processed IDs)
    const { newTasks: extractedTasks, allTasks: mergedAnnTasks } = await processAnnouncementsBatch(
      announcements,
      existingTasks,
      settings,
      fullRescan ? undefined : knownAnnIds,
      reportProgress
    );

    // Merge direct stream tasks with deduplication against existing stored tasks
    const existingIdMap = new Map<string, DeadlineTask>();
    const existingTitleCourseMap = new Map<string, DeadlineTask>();
    const existingDateKeySet = new Set<string>();

    for (const t of mergedAnnTasks) {
      existingIdMap.set(t.id, t);
      const tcKey = titleCourseKeyFor(t);
      if (tcKey) existingTitleCourseMap.set(tcKey, t);
      try {
        existingDateKeySet.add(`${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`);
      } catch {}
    }

    const newlyAddedDirect: DeadlineTask[] = [];

    for (const dt of directStreamTasks) {
      // '' when the course is unknown, so "Quiz 3" from two courses is never merged
      const titleCourseKey = titleCourseKeyFor(dt);
      let dateKey = '';
      try {
        dateKey = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`;
      } catch {}

      const matched = existingIdMap.get(dt.id)
        || (titleCourseKey ? existingTitleCourseMap.get(titleCourseKey) : undefined)
        || (dateKey && existingDateKeySet.has(dateKey) ? true : undefined);

      if (matched && typeof matched === 'object') {
        // Matched an existing task! If user edited it, never overwrite user changes.
        if (!matched.userEdited && matched.extractedBy !== 'manual') {
          if (!matched.hasSpecificTime && dt.hasSpecificTime) {
            matched.dueDate = dt.dueDate;
            matched.hasSpecificTime = dt.hasSpecificTime;
            matched.updatedAt = new Date().toISOString();
          }
        }
      } else if (!matched) {
        newlyAddedDirect.push(dt);
        existingIdMap.set(dt.id, dt);
        if (titleCourseKey) existingTitleCourseMap.set(titleCourseKey, dt);
        if (dateKey) existingDateKeySet.add(dateKey);
      }
    }

    const finalTasks = deduplicateTaskList([...newlyAddedDirect, ...mergedAnnTasks]).filter(isValidTask);

    // Put marks and submissions on their tasks (only changed tasks are touched)
    const marksChanged = applySubmissionUpdates(finalTasks, submissionUpdates);

    // Which gradebook marks found no deadline (shown in the scan message and the page console)
    const gradebookMarks = submissionUpdates.filter(u => u.sourceId && u.submissionStatus === 'graded');
    const unmatchedMarks = gradebookMarks.filter(u =>
      !finalTasks.some(t => t.gradeSourceId === u.sourceId || (t.gradeSourcesBefore || []).includes(u.sourceId!))
    );
    console.info(
      `[Blackboarder] Gradebook: ${lastGradebookRead.signedIn ? `${lastGradebookRead.coursesRead}/${lastGradebookRead.courses} courses read, ${gradebookMarks.length} marks` : 'not readable (signed out?)'}` +
      (unmatchedMarks.length ? `; no matching deadline for: ${unmatchedMarks.map(u => `${u.courseName || '?'}: ${u.title}`).join(' | ')}` : '')
    );
    const gradebookNote = !lastGradebookRead.signedIn
      ? ' Marks: gradebook not readable.'
      : ` Marks: ${gradebookMarks.length - unmatchedMarks.length} of ${gradebookMarks.length} matched${
        unmatchedMarks.length ? ` (no deadline for ${unmatchedMarks.slice(0, 4).map(u => u.title).join(', ')}${unmatchedMarks.length > 4 ? ', ...' : ''})` : ''}.`;

    // Correct weights and rooms saved by older rules (tasks the student edited are left alone)
    repairTaskWeightsAndRooms(finalTasks);

    // Auto-register any new courses found in scanned tasks or discovered courses
    await autoRegisterDiscoveredCourses([...finalTasks, ...discoveredCourses]).catch(() => {});

    // Merge with what is stored now: the popup or a phone edit may have saved while this scan ran
    await saveTasksMergingLatest(finalTasks);

    // Automatically push newly scanned tasks & courses to Firebase / sync server
    try {
      const currentSettings = await getSettings();
      if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
        chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
      }
    } catch {}

    // Update scan checkpoint with newly processed IDs
    const newAnnIds = announcements.map(a => a.id);
    const newDirectIds = directStreamTasks.map(d => d.id);
    const newKeys = announcements.flatMap(a => [
      a.title.toLowerCase().trim(),
      `${a.courseCode}_${a.title.toLowerCase().trim()}`
    ]);
    await saveLastScanCheckpoint({
      lastScannedAt: new Date().toISOString(),
      processedAnnouncementIds: newAnnIds,
      processedDirectTaskIds: newDirectIds,
      processedAnnouncementKeys: newKeys
    });

    const totalNewCount = newlyAddedDirect.length + extractedTasks.length;

    // Update floating badge
    const badge = document.getElementById('bbs-floating-badge');
    if (badge) {
      const pendingCount = finalTasks.filter(t => t.status === 'pending').length;
      if (pendingCount > 0) {
        badge.textContent = String(pendingCount);
        badge.style.display = 'inline-block';
      }
    }

    if (interactive || totalNewCount > 0) {
      const msg = totalNewCount > 0
        ? `Found <strong>${totalNewCount}</strong> new deadline${totalNewCount > 1 ? 's' : ''} (Quizzes & Assignments) from Blackboard!`
        : `All deadlines up to date. (${finalTasks.filter(t => t.status === 'pending').length} pending tasks in dashboard)`;
      showSidekickToast('Scan Complete', msg, totalNewCount);
    }
    if (interactive) {
      await setScanStatus({
        state: 'done',
        message: (totalNewCount > 0
          ? `Added ${totalNewCount} new deadline${totalNewCount > 1 ? 's' : ''} to calendar!`
          : (marksChanged > 0
            ? `Up to date. Added or updated ${marksChanged} mark${marksChanged > 1 ? 's' : ''}.`
            : `Up to date. Read ${announcements.length + directTasks.length} items with no new deadlines.`)) + gradebookNote,
        newCount: totalNewCount
      });
    }
  } catch (error: any) {
    if (error?.message?.includes('Extension context invalidated')) {
      teardownOrphanedContentScript();
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
      if (interactive) {
        showExtensionReloadToast();
      }
      return;
    }
    console.error('Error during Blackboard scan:', error);
    if (interactive) {
      showSidekickToast('Scan Notice', 'Blackboard scan encountered an issue. If page layout changed, try refreshing the tab.', 0);
      await setScanStatus({ state: 'error', message: 'Scan hit a problem. Refresh the Blackboard tab and try again.' });
    }
  }
}

function isBlackboardSite(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('blackboard.com') || host.includes('blackboard.sharjah.ac.ae') || host.includes('elearning.sharjah.ac.ae')) {
    return true;
  }
  if (host.includes('blackboard')) {
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

  // Hydrate custom courses on startup
  getUserCourses().catch(() => {});

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

  // Inject floating button (cards are only expanded when extract is explicitly triggered)
  injectFloatingButton(() => runScan(true));

  // Blackboard's course colours follow the student's course colours
  startCourseColorPainter(getBlackboardJson);

  // Course and type filter bar on the Activity page
  startActivityFilter(getBlackboardJson);

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
        } else if (message.type === 'PING_SCANNER') {
          sendResponse({ ok: true, scanning: scanRunning });
          return false;
        } else if (message.type === 'TRIGGER_SCAN') {
          runScan(true, Boolean(message.fullRescan))
            .then(() => sendResponse({ success: true }))
            .catch(() => sendResponse({ success: false }));
          return true; // async
        }
        return false;
      });
    }
  } catch {
    // Context may already be invalidated
  }

  // Auto-scan on load if enabled
  getSettings()
    .then(settings => {
      if (!isExtensionContextValid()) return;
      if (settings.autoScanOnPageLoad) {
        setTimeout(() => {
          if (isExtensionContextValid()) {
            runScan(false);
          }
        }, 2500);
      }
    })
    .catch(() => {});

  // Zero-click Ultra Stream Infinite Scroll Observer
  initUltraStreamObserver();
}

/**
 * Watches for dynamically rendered stream cards during infinite scrolling
 * and runs a quiet incremental micro-scan automatically.
 */
function initUltraStreamObserver() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isScanning = false;

  const observer = new MutationObserver(mutations => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      return;
    }

    let hasRelevantNodes = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i];
          if (node instanceof HTMLElement) {
            if (node.matches && (
              node.matches('[role="feed"] > *, .stream-item-container, .stream-item, [class*="activity-card"], bb-announcement-card, #announcementList > *') ||
              node.querySelector?.('.stream-item-container, .stream-item, bb-announcement-card, [class*="activity-card"], [class*="timeline"]')
            )) {
              hasRelevantNodes = true;
              break;
            }
          }
        }
      }
      if (hasRelevantNodes) break;
    }

    if (hasRelevantNodes && !isScanning) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!isExtensionContextValid()) {
          teardownOrphanedContentScript();
          return;
        }
        isScanning = true;
        try {
          console.log('[Blackboarder] Ultra stream scroll detected: running quiet incremental scan...');
          await runScan(false, false);
        } catch (e: any) {
          if (e?.message?.includes('Extension context invalidated')) {
            teardownOrphanedContentScript();
            console.info('[Blackboarder] Extension was reloaded during auto-scan; refresh this tab to reconnect.');
          } else {
            console.warn('[Blackboarder] Infinite scroll auto-scan error:', e);
          }
        } finally {
          isScanning = false;
        }
      }, 1500);
    }
  });

  activeStreamObserver = observer;
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Run after document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
