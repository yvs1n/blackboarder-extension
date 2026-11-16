import { Announcement, DeadlineTask, TaskSubmissionUpdate } from '../types';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, isBlackboardSystemNoise, hasValidAcademicCourseCode } from '../core/courseHelper';
import { parseDirectStreamCard, parseSubmissionOrGradeCard } from '../utils/streamParser';
import { extractDateStringFromText, fetchFullAnnouncementBodyFromCode } from './classicAnnouncementFetch';

/**
 * Scrapes direct deadline cards from the Blackboard Ultra Stream timeline
 * (e.g. items with "Due Date: 9/18/26, 11:59 PM (UTC+4)").
 * Supports incremental scanning by stopping when hitting items already scanned.
 */
export function scrapeUltraStreamDueItems(knownDirectTaskIds?: Set<string>): DeadlineTask[] {
  const directTasks: DeadlineTask[] = [];
  const scannedKeys = new Set<string>();
  let consecutiveKnown = 0;

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
      if (!hasChildMatch) leafDateElements.push(el);
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
        if (consecutiveKnown >= 3) break;
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
export function scrapeStreamSubmissionsAndGrades(): TaskSubmissionUpdate[] {
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
export function scrapeEnrolledCourses(): { courseName: string; courseCode?: string }[] {
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

  const courseElements = document.querySelectorAll(
    'a[href*="/ultra/courses/"], a[href*="course_id="], [data-course-id], .course-element-card, .bb-course-title, [class*="course-title"]'
  );
  courseElements.forEach(el => {
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
export async function scrapeAnnouncements(
  knownAnnIds?: Set<string>,
  knownKeys?: Set<string>,
  resolveCourseId?: (text: string) => Promise<string>
): Promise<Announcement[]> {
  const currentUrl = window.location.href;
  const pageTitle = document.title || '';

  const pageHeadingEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
  const rawPageCourseText = pageHeadingEl?.textContent?.trim() || (pageTitle !== 'Activity' ? pageTitle : '');
  const pageCourseInfo = parseCourseDetails(rawPageCourseText);

  const detectedCourseCode = pageCourseInfo.code;
  const detectedCourseName = pageCourseInfo.name;

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
    if (
      card.classList.contains('course-element-card') ||
      card.hasAttribute('data-course-id') ||
      card.closest('.base-courses, .course-org-list') ||
      card.querySelector('.multi-column-course-id, .js-course-title-element')
    ) {
      continue;
    }
    const cardText = card.textContent?.trim() || '';
    if (/Due Date:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(cardText)) continue;
    if (/(?:grade\s+posted|grades\s+available|score\s+posted|graded|new\s+grade|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(cardText)) continue;
    if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(cardText)) continue;
    if (/(?:discussion\s+board|new\s+post\s+in|someone\s+replied|منتدى\s+النقاش|مشاركة\s+جديدة)/i.test(cardText)) continue;
    if (/^\s*["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?\s*$/m.test(cardText)) continue;

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
    if (/^(?:added|updated|edited|new\s+content)\s*:/i.test(title) || /\/bbcswebdav\//i.test(href)) {
      continue;
    }

    const titleLower = title.toLowerCase().trim();
    const candidateId = announcementId ? `ann_ultra_${announcementId}` : `ann_ultra_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;

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
      if (consecutiveKnown >= 2) break;
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

    if (!courseId && resolveCourseId) {
      courseId = await resolveCourseId(`${cardCourseName} ${cardCourseCode} ${rawCourseStr} ${title}`);
    }

    const cardClone = card.cloneNode(true) as HTMLElement;
    const noiseSelectors = [
      'time', '[datetime]', '.timestamp', '.stream-entry-time', '[class*="timestamp"]',
      '[class*="date-time"]', '.course-name', '.context-title', '.course-title',
      '[data-course-id]', 'a[href*="/courses/"]', 'a[analytics-id="stream.entry.course"]',
      'button', 'svg', 'nav', '.bb-avatar', '.avatar', '[class*="author"]'
    ];
    noiseSelectors.forEach(sel => cardClone.querySelectorAll(sel).forEach(el => el.remove()));

    if (title) {
      cardClone.querySelectorAll('h1, h2, h3, h4, h5, [role="heading"], .announcement-title, .stream-entry-title, a.js-title-link').forEach(h => h.remove());
    }

    const candidateSelectors = [
      '.vtbegenerated', '.details', 'bb-read-more', '.announcement-body', '.entry-content',
      '.stream-entry-body', '.stream-item-content', '.stream-message', '.message-body',
      '[class*="body-content"]', '[bb-translate]', '.content', '.summary'
    ];

    let bestBodyEl = null as HTMLElement | null;
    let bestCandidateText = '';
    let bestCandidateHtml = '';

    for (const sel of candidateSelectors) {
      cardClone.querySelectorAll<HTMLElement>(sel).forEach(el => {
        const cText = el.textContent?.trim() || '';
        if (cText.length > bestCandidateText.length) {
          bestCandidateText = cText;
          bestCandidateHtml = el.innerHTML || '';
          bestBodyEl = el;
        }
      });
    }

    const cardCloneText = cardClone.textContent?.trim() || '';
    let text = bestCandidateText.length >= 25 ? bestCandidateText : cardCloneText;
    let fullHtml = bestCandidateHtml || bestBodyEl?.innerHTML || cardClone.innerHTML || '';

    const attrFullText = card.getAttribute('data-full-text') || card.getAttribute('data-content') || '';
    if (attrFullText && attrFullText.length > text.length) text = attrFullText.trim();
    const titleAttr = card.getAttribute('title') || bestBodyEl?.getAttribute('title') || card.querySelector('[title]')?.getAttribute('title') || '';
    if (titleAttr && titleAttr.length > text.length && !titleAttr.startsWith('http')) text = titleAttr.trim();

    const isTruncated = /(?:…|\.\.\.)\s*$/.test(text) || text.includes('…') || text.endsWith('...');
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
      title = (lines.length >= 1 && lines[0].length < 75) ? lines[0] : `Announcement ${index + 1}`;
    }
    if (text.trim().length <= 5 && titleEl) text = title;

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

  // Strategy 3: Generic Announcement/Post container heuristic fallback
  if (results.length === 0 && ultraCards.length === 0) {
    document.querySelectorAll(
      '[class*="announcement"], [class*="post"], [class*="notice"], [role="feed"] > article, [role="feed"] > li, [role="region"] article, main article, [class*="stream-container"] > *'
    ).forEach((post, index) => {
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
