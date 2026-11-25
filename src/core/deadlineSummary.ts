import type { DeadlineTask } from '../types';
import { splitAnnouncementNotes } from './announcementReconcile';
import { sanitizeDoctorAnnouncementText } from './courseHelper';

export interface StructuredNoteSegment {
  label: string;
  text: string;
}

export interface StructuredDeadlineSummary {
  whenText: string;
  roomText: string;
  weightText: string;
  topicsText: string;
  formatText: string;
  scoreText: string | null;
  briefText: string | null;
  noteSegments: StructuredNoteSegment[];
  hasNotes: boolean;
  updateCount: number;
  rawNotes: string;
}

const BOILERPLATE_GREETING_RE = /^(?:(?:dear\s+(?:all|students?|everyone|class)|hello\s*(?:everyone|all|students)?|hi\s*(?:all|everyone|students)?|assalamu?\s+alaikum(?:\s+wa\s+rahmatullahi(?:\s+wa\s+barakatuh)?)?|kindly\s+note(?:\s+that)?|please\s+be\s+informed(?:\s+that)?|السلام\s*عليكم(?:\s*ورحمة\s*الله(?:\s*وبركاته)?)?|تحية\s*طيبة(?:\s*وبعد)?|أعزائي\s*(?:الطلبة|الطلاب))[\s,،.:!-]*)+/i;
const BOILERPLATE_SIGN_OFF_RE = /(?:(?:best\s+regards|regards|kind\s+regards|sincerely|good\s+luck(?:\s+(?:to\s+all|everyone))?|all\s+the\s+best|thank\s+you|thanks|مع\s+تمنياتي\s+(?:لكم\s+)?بالتوفيق|بالتوفيق)[\s,،.:!-]*.*)$/i;
const UPDATE_TAG_PREFIX_RE = /^(?:\[(?:Professor|Doctor)\s+Update\]:\s*|(?:Professor|Doctor)\s+Update:\s*)+/i;

function cleanNoteSegment(raw: string, task?: Partial<DeadlineTask>): string {
  const cleaned = sanitizeDoctorAnnouncementText(
    raw.replace(UPDATE_TAG_PREFIX_RE, '').trim(),
    task?.courseName,
    task?.courseCode,
    task?.title
  );
  return cleaned.replace(UPDATE_TAG_PREFIX_RE, '').trim();
}

function trimSentence(text: string, maxLen = 175): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 3).replace(/[\s,;:-]+$/, '')}...`;
}

/**
 * Extracts covered chapters, lectures, units, or topics from professor note segments
 * from oldest to newest so explicit updates enrich or supersede earlier notes.
 */
export function extractTopicsFromSegments(segments: string[]): string | null {
  let latestTopics: string | null = null;
  const collectedRanges: string[] = [];

  for (const seg of segments) {
    const clean = seg
      .replace(UPDATE_TAG_PREFIX_RE, '')
      .replace(/\r\n?/g, '\n');

    const topicClauseRe = /\b(?:covers?|covering|coverage|topics?|material\s+(?:included|covered)|chapters?\s*(?:covered|included)?|units?|modules?|lectures?|syllabus\s+scope)\b\s*(?:are|is|will\s+be|includes?|:|-)?\s*([^.!?\n;]+(?:[,;&]\s*[^.!?\n;]+)*)/gi;
    let m: RegExpExecArray | null;
    while ((m = topicClauseRe.exec(clean)) !== null) {
      let val = (m[1] || '').trim()
        .replace(/^(?:the\s+(?:final|midterm|lab(?:oratory)?)\s+exam(?:ination)?\s+will\s+cover\s+)/i, '')
        .replace(/^(?:only|the\s+following|from)\s+/i, '')
        .replace(/\b(?:listed\s+below|as\s+follows?|on|at|in\s+room|in\s+hall|at\s+\d)\b.*$/i, '')
        .replace(/[,\s:-]+$/, '')
        .trim();
      if (
        val.length >= 3 &&
        !/^(?:your|the)\s+(?:exam|quiz|midterm|test)$/i.test(val) &&
        !/\b(?:instructor|attendance|confirm|student\s+id|university\s+id)\b/i.test(val)
      ) {
        // Check if match itself started with Chapter/Lecture/Module so we keep the noun prefix
        const fullPrefix = (m[0] || '').trim();
        if (/^(?:chapters?|ch\.?|lectures?|units?|modules?)\b/i.test(fullPrefix) && !/^(?:chapters?|ch\.?|lectures?|units?|modules?)\b/i.test(val)) {
          const noun = fullPrefix.match(/^(chapters?|ch\.?|lectures?|units?|modules?)/i)?.[1] || 'Chapters';
          val = `${noun} ${val}`;
        }
        latestTopics = trimSentence(val, 150);
      }
    }

    const explicitRangeRe = /\b((?:Chapters?|Ch\.?|Lectures?|Units?|Modules?|Sections?|Weeks?)\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|&|,|and)\s*(?:Ch\.?\s*)?\d+(?:\.\d+)?)*)/gi;
    let r: RegExpExecArray | null;
    while ((r = explicitRangeRe.exec(clean)) !== null) {
      const token = (r[1] || '').replace(/\s+/g, ' ').trim();
      if (token && !collectedRanges.some(x => x.toLowerCase() === token.toLowerCase())) {
        collectedRanges.push(token);
      }
    }

    const arTopicRe = /(?:يشمل|يغطي|تغطي|المواضيع|الفصول|الوحدات|المحاضرات|المقرر)\s*(?::|-)?\s*([^\n.!؟]+)/g;
    let a: RegExpExecArray | null;
    while ((a = arTopicRe.exec(clean)) !== null) {
      const val = (a[1] || '').trim();
      if (val.length >= 3) latestTopics = trimSentence(val, 150);
    }
  }

  if (latestTopics) return latestTopics;
  if (collectedRanges.length > 0) return trimSentence(collectedRanges.join(', '), 150);
  return null;
}

/**
 * Extracts normalized delivery mode, duration, book policy, calculator rules, and submission/ID
 * rules in a deterministic fixed order across every course.
 */
export function extractFormatRulesFromSegments(
  segments: string[],
  task?: Partial<DeadlineTask>
): string | null {
  const joinedLatestLast = segments.join('\n');
  let mode: string | null = null;
  let duration: string | null = null;
  let bookPolicy: string | null = null;
  let calcPolicy: string | null = null;
  const extras: string[] = [];

  for (const seg of segments) {
    const low = seg.toLowerCase();
    if (/\b(?:moved\s+online|will\s+be\s+online|online\s+(?:quiz|exam|test|submission|via\s+blackboard)|on\s+blackboard|take[\s-]*home|أونلاين|عن\s+بعد)\b/i.test(low)) {
      mode = /\btake[\s-]*home\b/i.test(low) ? 'Take-home' : 'Online';
    } else if (/\b(?:in[\s-]*person|on[\s-]*campus|in\s+class|face\s+to\s+face|paper[\s-]*based|حضوري)\b/i.test(low)) {
      mode = 'In-person';
    } else if (!mode && task?.room && !/^(?:online|blackboard)$/i.test(task.room.trim())) {
      mode = 'In-person';
    }

    const durMatch = seg.match(/\b(?:duration(?:\s*(?:is|of|:))?\s*|for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|hrs?|hours?)\b|مدة\s*(?:الامتحان|الاختبار|الكويز)?\s*(\d+)\s*(?:دقيقة|دقائق|ساعة|ساعات)/i);
    if (durMatch) {
      const val = durMatch[1] || durMatch[3];
      const unitRaw = (durMatch[2] || '').toLowerCase();
      if (durMatch[3]) {
        const isHr = /ساعة|ساعات/.test(durMatch[0]);
        duration = isHr ? `${val} hr` : `${val} min`;
      } else {
        duration = unitRaw.startsWith('h') ? `${val} hr` : `${val} min`;
      }
    }

    if (/\b(?:closed[\s-]*book|no\s+books?\s+(?:or\s+notes?\s+)?(?:allowed|permitted))\b|كتاب\s*مغلق/i.test(low)) {
      bookPolicy = 'Closed book';
    } else if (/\bopen[\s-]*book\b|كتاب\s*مفتوح/i.test(low)) {
      bookPolicy = 'Open book';
    } else if (/\b(?:formula|cheat)\s*sheet(?:s)?\s*(?:are\s+|is\s+)?(?:allowed|permitted|provided)\b/i.test(low)) {
      bookPolicy = 'Formula sheet allowed';
    }

    if (/\b(?:no\s+calculators?(?:\s+allowed|\s+permitted)?|calculators?\s+(?:are\s+)?not\s+(?:allowed|permitted))\b|يمنع\s*استخدام\s*الآلة/i.test(low)) {
      calcPolicy = 'No calculators';
    } else if (/\bscientific\s+calculators?\s*(?:are\s+|is\s+)?(?:allowed|permitted)\b/i.test(low)) {
      calcPolicy = 'Scientific calculator allowed';
    } else if (/\bcalculators?\s*(?:are\s+|is\s+)?(?:allowed|permitted)\b|آلة\s*حاسبة\s*مسموحة/i.test(low)) {
      calcPolicy = 'Calculator allowed';
    }
  }

  const allLow = joinedLatestLast.toLowerCase();
  if (/\b(?:respondus|lockdown\s+browser)\b/i.test(allLow)) extras.push('LockDown Browser');
  if (/\b(?:multiple[\s-]*choice|mcq)\b/i.test(allLow)) extras.push('MCQ');
  if (/\b(?:bring\s+(?:your\s+)?(?:student|university)\s+id|id\s+card)\b|البطاقة\s*الجامعية/i.test(allLow)) extras.push('Bring Student ID');
  if (/\bbring\s+(?:your\s+)?laptop\b/i.test(allLow)) extras.push('Bring laptop');
  if (/\b(?:upload|submit)\s+(?:a\s+)?pdf\b/i.test(allLow)) extras.push('PDF submission');

  const parts = [mode, duration, bookPolicy, calcPolicy, ...extras].filter(Boolean) as string[];
  return parts.length > 0 ? trimSentence(parts.join(' · '), 150) : null;
}

/**
 * Distills a concise 1-2 sentence overview across announcement segments, preferring the latest
 * substantive update while stripping email greetings and sign-offs.
 */
export function extractBriefFromSegments(segments: string[]): string | null {
  if (segments.length === 0) return null;
  const preferredOrder = segments.length > 1
    ? [segments[segments.length - 1], ...segments.slice(0, -1).reverse()]
    : segments;

  for (const raw of preferredOrder) {
    let text = raw
      .replace(UPDATE_TAG_PREFIX_RE, '')
      .replace(/\r\n?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    text = text
      .replace(BOILERPLATE_GREETING_RE, '')
      .replace(BOILERPLATE_SIGN_OFF_RE, '')
      .trim();
    if (text.length >= 8) {
      return trimSentence(text, 175);
    }
  }
  return null;
}

function formatWhenText(task: Partial<DeadlineTask>, countdownLabel?: string): string {
  if (!task.dueDate) return countdownLabel || 'Date not set';
  const dt = new Date(task.dueDate);
  if (isNaN(dt.getTime())) return countdownLabel || 'Date not set';
  const datePart = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const timePart = task.hasSpecificTime
    ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Class Time';
  return `${datePart} · ${timePart}`;
}

function formatRoomText(task: Partial<DeadlineTask>, isPayment?: boolean): string {
  if (isPayment) return (task.room || '').trim() || 'Student Portal';
  const t = (task.type || '').toLowerCase();
  const room = (task.room || '').trim();
  if (room) return room;
  if (t === 'assignment' || t === 'hw' || t === 'project') return 'Online Submission';
  return 'TBA';
}

function formatWeightText(task: Partial<DeadlineTask>): string {
  if (task.isBonus) {
    if (typeof task.weight === 'number' && task.weight > 0) {
      const unit = task.bonusUnit === 'percent' ? '%' : ' pts';
      return `Bonus +${task.weight}${unit}${task.bonusTargetLabel ? ` (${task.bonusTargetLabel})` : ''}`;
    }
    return 'Bonus Credit';
  }
  if (task.weightDisplay && task.weightDisplay.trim()) return task.weightDisplay.trim();
  if (typeof task.weight === 'number' && task.weight > 0) return `${task.weight}% of Grade`;
  return 'Not set';
}

function formatScoreText(task: Partial<DeadlineTask>): string | null {
  if (task.submissionStatus === 'graded' || (typeof task.score === 'number' && !isNaN(task.score))) {
    if (task.scoreDisplay && task.scoreDisplay.trim()) return task.scoreDisplay.trim();
    if (typeof task.score === 'number' && task.maxScore) return `${task.score} / ${task.maxScore}`;
    if (typeof task.score === 'number') return `${task.score} pts`;
    return 'Graded';
  }
  if (task.submissionStatus === 'submitted') return 'Submitted (awaiting grade)';
  return null;
}

/**
 * Produces a single standardized summary representation (canonical field order and uniform
 * defaults across every course) plus chronological `Professor Notes` segments for collapsible display.
 */
export function buildStructuredDeadlineSummary(
  task: Partial<DeadlineTask>,
  options: { countdownLabel?: string; isPayment?: boolean } = {}
): StructuredDeadlineSummary {
  const rawDesc = (task.description || '').trim();
  const rawSnippet = (task.sourceSnippet || '').trim();
  const chosenRaw = rawDesc.length >= rawSnippet.length ? rawDesc : rawSnippet;
  const rawParts = splitAnnouncementNotes(chosenRaw);
  const cleanedSegments = rawParts
    .map(p => cleanNoteSegment(p, task))
    .filter(s => s.length >= 2);

  const noteSegments: StructuredNoteSegment[] = cleanedSegments.map((text, idx) => ({
    label: idx === 0 ? 'Initial Announcement' : `Professor Update #${idx}`,
    text
  }));

  const topicsExtracted = (task.summary?.topics || '').trim() || extractTopicsFromSegments(cleanedSegments);
  const formatExtracted = (task.summary?.formatRules || '').trim() || extractFormatRulesFromSegments(cleanedSegments, task);
  const briefExtracted = (task.summary?.brief || '').trim() || extractBriefFromSegments(cleanedSegments);

  const rawNotes = noteSegments
    .map((seg, i) => (i === 0 ? seg.text : `[Professor Update #${i}]:\n${seg.text}`))
    .join('\n\n');

  return {
    whenText: formatWhenText(task, options.countdownLabel),
    roomText: formatRoomText(task, options.isPayment),
    weightText: formatWeightText(task),
    topicsText: topicsExtracted || 'Not specified',
    formatText: formatExtracted || (options.isPayment ? 'Portal / Bank Transfer' : 'Standard course rules'),
    scoreText: formatScoreText(task),
    briefText: briefExtracted,
    noteSegments,
    hasNotes: noteSegments.length > 0,
    updateCount: Math.max(0, noteSegments.length - 1),
    rawNotes
  };
}

function escapeSummaryHtml(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface DeadlineSummaryRenderOptions {
  variant?: 'card' | 'reading';
  countdownLabel?: string;
  isPayment?: boolean;
  includeFullViewBtn?: boolean;
  includeCopyBtn?: boolean;
  copyBtnId?: string;
  svgIconFn?: (name: string, extraClass?: string) => string;
}

/**
 * Renders the single unified deadline Summary block (uniform fixed field order across every
 * course) followed by the collapsible `Professor Notes` dropdown containing the chronological
 * announcement and `[Professor Update]` history.
 */
export function renderDeadlineSummaryBlockHtml(
  task: Partial<DeadlineTask>,
  options: DeadlineSummaryRenderOptions = {}
): string {
  const sum = buildStructuredDeadlineSummary(task, {
    countdownLabel: options.countdownLabel,
    isPayment: options.isPayment
  });
  const isReading = options.variant === 'reading';
  const taskId = escapeSummaryHtml(task.id || '');
  const getIcon = options.svgIconFn;
  const msgIcon = getIcon ? getIcon('message', 'mr-1') : '';
  const copyIcon = getIcon ? getIcon('copy', 'mr-1') : '';
  const searchIcon = getIcon ? getIcon('search') : '';

  const rows: Array<{ key: string; value: string; muted?: boolean }> = [
    { key: 'When', value: sum.whenText },
    { key: 'Room', value: sum.roomText, muted: sum.roomText === 'TBA' },
    { key: 'Weight', value: sum.weightText, muted: sum.weightText === 'Not set' },
    { key: 'Topics', value: sum.topicsText, muted: sum.topicsText === 'Not specified' },
    { key: 'Rules', value: sum.formatText, muted: sum.formatText === 'Standard course rules' }
  ];
  if (sum.scoreText) {
    rows.push({ key: 'Score', value: sum.scoreText });
  }
  if (sum.briefText) {
    rows.push({ key: 'Summary', value: sum.briefText });
  }

  const rowsHtml = rows.map(r => `
    <div class="summary-grid-row${r.muted ? ' is-muted' : ''}">
      <span class="summary-grid-key">${escapeSummaryHtml(r.key)}</span>
      <span class="summary-grid-val">${escapeSummaryHtml(r.value)}</span>
    </div>
  `).join('');

  const updateBadge = sum.updateCount > 0
    ? `<span class="prof-notes-count">${sum.updateCount} ${sum.updateCount === 1 ? 'update' : 'updates'}</span>`
    : (sum.hasNotes ? '<span class="prof-notes-count">1 post</span>' : '');

  const notesBodyHtml = sum.hasNotes
    ? sum.noteSegments.map((seg, idx) => `
      <div class="prof-note-segment${idx > 0 ? ' is-update' : ''}">
        <div class="prof-note-segment-label">${escapeSummaryHtml(seg.label)}</div>
        <div class="prof-note-segment-text">${escapeSummaryHtml(seg.text)}</div>
      </div>
    `).join('')
    : '<div class="prof-notes-empty">No announcement text recorded for this item.</div>';

  const toolbarHtml = (sum.hasNotes && (options.includeFullViewBtn || options.includeCopyBtn))
    ? `<div class="prof-notes-toolbar">
        ${options.includeCopyBtn ? `<button type="button" class="btn-copy-announcement prof-notes-copy-btn" ${options.copyBtnId ? `id="${escapeSummaryHtml(options.copyBtnId)}"` : ''} data-task-id="${taskId}">${copyIcon}<span>Copy</span></button>` : ''}
        ${options.includeFullViewBtn ? `<button type="button" class="btn-inspect-quote prof-notes-inspect-btn" data-id="${taskId}" data-task-id="${taskId}" title="Open full details">${searchIcon}<span>Full View</span></button>` : ''}
      </div>`
    : '';

  const notesDropdownHtml = (sum.hasNotes || isReading)
    ? `<details class="prof-notes-dropdown"${isReading ? '' : ''}>
        <summary class="prof-notes-summary">
          <span class="prof-notes-title">
            ${msgIcon}
            <span>Professor Notes</span>
            ${updateBadge}
          </span>
          <span class="prof-notes-toggle-right">
            <svg class="prof-notes-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </span>
        </summary>
        <div class="prof-notes-content">
          ${toolbarHtml}
          <div class="prof-notes-segments">${notesBodyHtml}</div>
        </div>
      </details>`
    : '';

  return `
    <div class="deadline-summary-block${isReading ? ' is-reading' : ''}" data-task-id="${taskId}">
      <div class="summary-grid-header">Summary</div>
      <div class="summary-grid-rows">${rowsHtml}</div>
      ${notesDropdownHtml}
    </div>
  `;
}

