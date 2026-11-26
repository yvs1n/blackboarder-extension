import type {
  AiProvider,
  CustomScheduleSlot,
  CustomSyllabusComponent,
  TaskType,
  UiLanguage,
  UserCourseConfig,
  UserSettings,
  Weekday,
} from '../types';
import { matchExistingCourse, type CourseDraft } from './courseDocument';
import { parseCourseDetails } from './courseHelper';
import { round2 } from '../utils/ui/uiCommon';
import { esc } from '../utils/ui/uiCommon';

function cleanCourseName(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const parsed = parseCourseDetails(trimmed);
  if (parsed.name && parsed.name !== 'General Course') return parsed.name;
  return trimmed.replace(/\b(?:FALL|SPRING|SUMMER|WINTER)\d{2,4}(?:[-/]\d{2,4})?\b/gi, '').trim();
}

export const FIRST_CALIBRATION_DONE_KEY = 'bbs_first_calibration_done';

const ALL_DAYS: { key: Weekday; short: string; shortAr: string }[] = [
  { key: 'sun', short: 'Sun', shortAr: 'أحد' },
  { key: 'mon', short: 'Mon', shortAr: 'إثن' },
  { key: 'tue', short: 'Tue', shortAr: 'ثلا' },
  { key: 'wed', short: 'Wed', shortAr: 'أرب' },
  { key: 'thu', short: 'Thu', shortAr: 'خمي' },
  { key: 'fri', short: 'Fri', shortAr: 'جمع' },
  { key: 'sat', short: 'Sat', shortAr: 'سبت' },
];

const COMP_TYPES: { value: TaskType; en: string; ar: string }[] = [
  { value: 'quiz', en: 'Quiz', ar: 'اختبار قصير' },
  { value: 'assignment', en: 'Assignment', ar: 'واجب' },
  { value: 'exam', en: 'Exam', ar: 'امتحان' },
  { value: 'project', en: 'Project', ar: 'مشروع' },
  { value: 'lab', en: 'Lab', ar: 'مختبر' },
  { value: 'other', en: 'Other', ar: 'أخرى' },
];

export const AI_SETUP_GUIDES: Record<AiProvider, { title: string; titleAr: string; badge: string; badgeAr: string; placeholder: string; steps: string[]; stepsAr: string[] }> = {
  ifm: {
    title: 'IFM K2 Horizon (Free Tier)',
    titleAr: 'IFM K2 Horizon (مجاني)',
    badge: 'Free Key · Great for Arabic & English',
    badgeAr: 'مفتاح مجاني · ممتاز للعربية والإنجليزية',
    placeholder: 'ifm_...',
    steps: [
      '1. Visit platform.ifm.ai and sign in with Google or email.',
      '2. Open API Keys in the sidebar and click Create New Key.',
      '3. Copy the key, paste it below, and click Test & Save Key.'
    ],
    stepsAr: [
      '1. افتح platform.ifm.ai وسجّل الدخول بحساب جوجل أو البريد الإلكتروني.',
      '2. انتقل إلى API Keys واضغط على Create New Key.',
      '3. انسخ المفتاح، الصقه أدناه، واضغط اختبار وحفظ المفتاح.'
    ]
  },
  openrouter: {
    title: 'OpenRouter',
    titleAr: 'OpenRouter',
    badge: 'Multi-Model (Gemini / GPT / Claude)',
    badgeAr: 'نماذج متعددة',
    placeholder: 'sk-or-v1-...',
    steps: [
      '1. Visit openrouter.ai/keys and sign in.',
      '2. Click Create Key and copy your sk-or-v1-... token (supports free or low-cost models).',
      '3. Paste the key below and click Test & Save Key.'
    ],
    stepsAr: [
      '1. افتح openrouter.ai/keys وسجّل الدخول.',
      '2. اضغط Create Key وانسخ الرمز sk-or-v1-....',
      '3. الصق المفتاح أدناه واضغط اختبار وحفظ المفتاح.'
    ]
  },
  custom: {
    title: 'Custom OpenAI-Compatible API',
    titleAr: 'مزود مخصص (متوافق مع OpenAI)',
    badge: 'Bring Your Own Endpoint',
    badgeAr: 'نقطة نهاية مخصصة',
    placeholder: 'sk-...',
    steps: [
      '1. Enter your provider Base URL ending in /v1 (for example https://api.groq.com/openai/v1).',
      '2. Enter the exact Model ID and your API key below.',
      '3. Click Test & Save Key and allow site access when Chrome asks.'
    ],
    stepsAr: [
      '1. أدخل Base URL الخاص بالمزود وينتهي بـ /v1.',
      '2. أدخل اسم النموذج ومفتاح API أدناه.',
      '3. اضغط اختبار وحفظ ووافق على إذن الموقع عند الطلب.'
    ]
  }
};

function defaultScheduleSlot(): CustomScheduleSlot {
  return { days: ['mon', 'wed'], startTime: '09:30', endTime: '10:45', room: '' };
}

function defaultSyllabusComponent(courseId: string, idx: number): CustomSyllabusComponent {
  return {
    id: `${courseId}_comp_${idx}`,
    name: idx === 1 ? 'Quizzes' : idx === 2 ? 'Midterm Exam' : 'Final Exam',
    type: idx === 1 ? 'quiz' : 'exam',
    totalWeight: idx === 1 ? 20 : idx === 2 ? 30 : 50,
    ...(idx === 1 ? { count: 3, outOf: 4 } : { count: 1 }),
  };
}

function normalizeDays(days: unknown): Weekday[] {
  const map: Record<string, Weekday> = {
    sunday: 'sun', sun: 'sun',
    monday: 'mon', mon: 'mon',
    tuesday: 'tue', tue: 'tue',
    wednesday: 'wed', wed: 'wed',
    thursday: 'thu', thu: 'thu',
    friday: 'fri', fri: 'fri',
    saturday: 'sat', sat: 'sat',
  };
  if (!Array.isArray(days)) return [];
  const out: Weekday[] = [];
  for (const d of days) {
    const k = map[String(d || '').toLowerCase()];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Combines scanned courses with any auto-discovered Blackboard syllabus drafts so the calibration
 * wizard shows clean names, extracted class schedules, and assessment quotas ("best N of M").
 */
export function buildCalibrationCourseDrafts(
  existingCourses: UserCourseConfig[],
  extractedDrafts: CourseDraft[] = []
): UserCourseConfig[] {
  const cloned = (existingCourses || []).map(c => ({
    ...c,
    courseName: cleanCourseName(c.courseName || c.courseCode || 'Untitled Course') || c.courseName || 'Untitled Course',
    scheduleSlots: (c.scheduleSlots || []).map(s => ({ ...s, days: normalizeDays(s.days) })),
    syllabus: (c.syllabus || []).map(s => ({ ...s })),
    aliases: Array.isArray(c.aliases) ? [...c.aliases] : [],
  }));

  const usedDraftIndices = new Set<number>();
  const out = cloned.map(course => {
    const idx = extractedDrafts.findIndex((draft, i) => !usedDraftIndices.has(i) && matchExistingCourse(draft, [course]) !== null);
    if (idx === -1) return course;
    usedDraftIndices.add(idx);
    const draft = extractedDrafts[idx];
    const cleanDraftName = cleanCourseName(draft.courseName || '') || course.courseName;
    const betterName = (!course.courseName || /^general\s*course$/i.test(course.courseName) || (cleanDraftName.length > course.courseName.length && !cleanDraftName.toLowerCase().includes('crn')))
      ? cleanDraftName
      : course.courseName;
    return {
      ...course,
      courseCode: course.courseCode || draft.courseCode || '',
      courseName: betterName,
      creditHours: course.creditHours ?? draft.creditHours ?? 3,
      scheduleSlots: course.scheduleSlots.length > 0 ? course.scheduleSlots : (draft.scheduleSlots || []).map(s => ({ ...s, days: normalizeDays(s.days) })),
      syllabus: course.syllabus.length > 0 ? course.syllabus : (draft.syllabus || []).map((s, si) => ({
        ...s,
        id: s.id || `${course.id}_syl_${si + 1}`,
      })),
    };
  });

  extractedDrafts.forEach((draft, i) => {
    if (usedDraftIndices.has(i)) return;
    const id = `course_cal_${Date.now()}_${i}`;
    out.push({
      id,
      courseCode: draft.courseCode || '',
      courseName: cleanCourseName(draft.courseName || draft.courseCode || 'New Course') || 'New Course',
      creditHours: draft.creditHours ?? 3,
      colorHex: '#2563eb',
      aliases: [],
      scheduleSlots: (draft.scheduleSlots || []).map(s => ({ ...s, days: normalizeDays(s.days) })),
      syllabus: (draft.syllabus || []).map((s, si) => ({ ...s, id: s.id || `${id}_syl_${si + 1}` })),
    });
  });

  return out;
}

export function renderScheduleRowHtml(slot: CustomScheduleSlot, lang: UiLanguage = 'en'): string {
  const days = normalizeDays(slot.days);
  const isAr = lang === 'ar';
  const dayPills = ALL_DAYS.map(d => {
    const active = days.includes(d.key);
    return `<label class="cal-day-pill ${active ? 'is-on' : ''}"><input type="checkbox" class="cal-slot-day" value="${d.key}"${active ? ' checked' : ''}><span>${isAr ? d.shortAr : d.short}</span></label>`;
  }).join('');

  return `<div class="cal-slot-row">
    <div class="cal-slot-days">${dayPills}</div>
    <div class="cal-slot-times">
      <input type="time" class="form-input cal-slot-start" value="${esc(slot.startTime || '09:30')}" aria-label="${isAr ? 'وقت البدء' : 'Start time'}">
      <span class="cal-slot-to">${isAr ? 'إلى' : 'to'}</span>
      <input type="time" class="form-input cal-slot-end" value="${esc(slot.endTime || '10:45')}" aria-label="${isAr ? 'وقت الانتهاء' : 'End time'}">
      <input type="text" class="form-input cal-slot-room" value="${esc(slot.room || '')}" placeholder="${isAr ? 'القاعة (مثلاً M3-102)' : 'Room (e.g. M3-102)'}" maxlength="32">
      <button type="button" class="btn-secondary cal-remove-row-btn" data-action="remove-slot" title="${isAr ? 'حذف' : 'Remove'}">✕</button>
    </div>
  </div>`;
}

export function renderSyllabusRowHtml(comp: Partial<CustomSyllabusComponent>, lang: UiLanguage = 'en'): string {
  const isAr = lang === 'ar';
  const typeVal = COMP_TYPES.some(t => t.value === comp.type) ? (comp.type as TaskType) : 'quiz';
  const opts = COMP_TYPES.map(t => `<option value="${t.value}"${t.value === typeVal ? ' selected' : ''}>${isAr ? t.ar : t.en}</option>`).join('');
  const countVal = comp.count ?? '';
  const outOfVal = comp.outOf ?? '';
  const weightVal = comp.totalWeight ?? '';

  return `<div class="cal-syl-row" data-comp-id="${esc(comp.id || '')}">
    <input type="text" class="form-input cal-syl-name" value="${esc(comp.name || '')}" placeholder="${isAr ? 'مثال: اختبارات قصيرة' : 'e.g. Quizzes'}" maxlength="50">
    <select class="form-select cal-syl-type" aria-label="${isAr ? 'النوع' : 'Type'}">${opts}</select>
    <input type="number" class="form-input cal-syl-count" min="1" max="50" step="1" value="${esc(String(countVal))}" placeholder="${isAr ? 'المحتسب' : 'Graded'}" title="${isAr ? 'عدد البنود المحتسبة (مثلاً أفضل 4)' : 'How many count toward grade (e.g. best 4)'}">
    <input type="number" class="form-input cal-syl-outof" min="1" max="50" step="1" value="${esc(String(outOfVal))}" placeholder="${isAr ? 'الإجمالي' : 'Total held'}" title="${isAr ? 'إجمالي العدد الكلي (مثلاً 5 لاختيار أفضل 4 من 5)' : 'Total given (e.g. 5 for best 4 of 5; leave blank if all count)'}">
    <input type="number" class="form-input cal-syl-weight" min="0" max="100" step="0.5" value="${esc(String(weightVal))}" placeholder="%" title="${isAr ? 'الوزن الكلي %' : 'Total category weight %'}">
    <button type="button" class="btn-secondary cal-remove-row-btn" data-action="remove-syl" title="${isAr ? 'حذف' : 'Remove'}">✕</button>
  </div>`;
}

export function calculateCalibrationCourseTotal(cardEl: ParentNode): number {
  let sum = 0;
  cardEl.querySelectorAll<HTMLInputElement>('.cal-syl-weight').forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val > 0) sum += val;
  });
  return round2(sum);
}

export function renderCalibrationCourseCardHtml(course: UserCourseConfig, idx: number, lang: UiLanguage = 'en'): string {
  const isAr = lang === 'ar';
  const slots = course.scheduleSlots && course.scheduleSlots.length ? course.scheduleSlots : [defaultScheduleSlot()];
  const syl = course.syllabus && course.syllabus.length ? course.syllabus : [
    defaultSyllabusComponent(course.id || `c${idx}`, 1),
    defaultSyllabusComponent(course.id || `c${idx}`, 2),
    defaultSyllabusComponent(course.id || `c${idx}`, 3),
  ];
  const totalWeight = round2(syl.reduce((s, c) => s + (c.totalWeight || 0), 0));
  const weightOk = Math.abs(totalWeight - 100) <= 0.5;
  const color = course.colorHex || '#2563eb';

  return `<div class="cal-course-card" data-course-index="${idx}" data-course-id="${esc(course.id || '')}" data-course-color="${esc(color)}">
    <div class="cal-course-head">
      <label class="cal-keep-label">
        <input type="checkbox" class="cal-keep-course" checked>
        <span class="cal-course-dot" style="background: ${esc(color)};"></span>
        <span class="cal-course-head-title">${esc(course.courseName || course.courseCode || (isAr ? 'مادة جديدة' : 'New Course'))}</span>
      </label>
      <span class="cal-weight-total-pill ${weightOk ? 'is-ok' : 'is-warn'}">${totalWeight}% / 100%</span>
    </div>

    <div class="cal-meta-grid">
      <label class="cal-field">
        <span>${isAr ? 'رمز المادة' : 'Code'}</span>
        <input type="text" class="form-input cal-course-code" value="${esc(course.courseCode || '')}" maxlength="24" placeholder="1502101">
      </label>
      <label class="cal-field cal-field-wide">
        <span>${isAr ? 'اسم المادة' : 'Course Name'}</span>
        <input type="text" class="form-input cal-course-name" value="${esc(course.courseName || '')}" maxlength="90" placeholder="${isAr ? 'اسم المادة كما يظهر في البطاقات' : 'Display name'}">
      </label>
      <label class="cal-field">
        <span>${isAr ? 'الساعات' : 'Credits'}</span>
        <input type="number" class="form-input cal-course-credits" min="0" max="60" step="0.5" value="${esc(String(course.creditHours ?? 3))}">
      </label>
    </div>

    <div class="cal-subsec">
      <div class="cal-subsec-head">
        <span>${isAr ? 'أوقات المحاضرات والقاعات' : 'Class Times & Rooms'}</span>
        <button type="button" class="btn-outline-action cal-mini-add-btn" data-action="add-slot">+ ${isAr ? 'موعد' : 'Class Time'}</button>
      </div>
      <div class="cal-slots-list">${slots.map(s => renderScheduleRowHtml(s, lang)).join('')}</div>
    </div>

    <div class="cal-subsec">
      <div class="cal-subsec-head">
        <span>${isAr ? 'توزيع الدرجات (العدد وأفضل N من M)' : 'Grade Breakdown (Count & Best N of M)'}</span>
        <button type="button" class="btn-outline-action cal-mini-add-btn" data-action="add-syl">+ ${isAr ? 'تقييم' : 'Assessment'}</button>
      </div>
      <div class="cal-syl-col-hints">
        <span>${isAr ? 'البند' : 'Name'}</span>
        <span>${isAr ? 'النوع' : 'Type'}</span>
        <span>${isAr ? 'المحتسب' : 'Count'}</span>
        <span>${isAr ? 'الإجمالي' : 'Out Of'}</span>
        <span>%</span>
        <span></span>
      </div>
      <div class="cal-syl-list">${syl.map(c => renderSyllabusRowHtml(c, lang)).join('')}</div>
    </div>
  </div>`;
}

export function renderCalibrationAiSetupHtml(settings: Partial<UserSettings>, lang: UiLanguage = 'en'): string {
  const isAr = lang === 'ar';
  const provider: AiProvider = settings.aiProvider === 'ifm' || settings.aiProvider === 'custom' ? settings.aiProvider : 'openrouter';
  const hasKey = Boolean(
    (provider === 'ifm' && settings.ifmApiKey?.trim())
    || (provider === 'custom' && settings.customAiApiKey?.trim() && settings.customAiBaseUrl?.trim())
    || (provider === 'openrouter' && settings.openRouterApiKey?.trim())
  );
  const wantAi = Boolean(settings.useAiExtraction || hasKey);
  const guide = AI_SETUP_GUIDES[provider];
  const currentKey = provider === 'ifm'
    ? (settings.ifmApiKey || '')
    : provider === 'custom'
      ? (settings.customAiApiKey || '')
      : (settings.openRouterApiKey || '');

  return `<div class="cal-ai-panel">
    <div class="cal-ai-header">
      <div>
        <div class="cal-ai-title">${isAr ? '1. مفتاح الذكاء الاصطناعي (اختياري)' : '1. AI Extraction Key (Optional)'}</div>
        <div class="cal-ai-sub">${isAr ? 'الإضافة تعمل بدون مفتاح، لكن المفتاح يحسّن قراءة خطط PDF والإعلانات العربية/المعقدة ويترجم الإعلانات بدقة أكبر.' : 'Works offline out of the box, or add a free/custom key for deeper PDF syllabus & bilingual Arabic accuracy.'}</div>
      </div>
    </div>
    <div class="cal-ai-mode-row">
      <label class="cal-ai-mode-pill ${!wantAi ? 'is-selected' : ''}">
        <input type="radio" name="cal-ai-mode" value="offline"${!wantAi ? ' checked' : ''}>
        <span>${isAr ? 'بدون مفتاح (المحلل المحلي)' : 'Skip AI (Built-in Offline Parser)'}</span>
      </label>
      <label class="cal-ai-mode-pill ${wantAi ? 'is-selected' : ''}">
        <input type="radio" name="cal-ai-mode" value="ai"${wantAi ? ' checked' : ''}>
        <span>${isAr ? 'إضافة مفتاح AI (موصى به)' : 'Use AI API Key (Recommended)'}</span>
      </label>
    </div>

    <div id="cal-ai-config-fields" class="cal-ai-config-fields"${wantAi ? '' : ' hidden'}>
      <div class="cal-meta-grid" style="margin-bottom: 8px;">
        <label class="cal-field cal-field-wide">
          <span>${isAr ? 'المزود' : 'Provider'}</span>
          <select id="cal-ai-provider" class="form-select">
            <option value="ifm"${provider === 'ifm' ? ' selected' : ''}>IFM K2 Horizon (Free)</option>
            <option value="openrouter"${provider === 'openrouter' ? ' selected' : ''}>OpenRouter (Gemini / GPT / Free Tier)</option>
            <option value="custom"${provider === 'custom' ? ' selected' : ''}>Custom OpenAI-Compatible URL</option>
          </select>
        </label>
      </div>

      <div id="cal-ai-guide-box" class="cal-ai-guide-box">
        <div class="cal-ai-guide-head">
          <strong>${esc(isAr ? guide.titleAr : guide.title)}</strong>
          <span>${esc(isAr ? guide.badgeAr : guide.badge)}</span>
        </div>
        <ol class="cal-ai-steps">${(isAr ? guide.stepsAr : guide.steps).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>

      <div id="cal-ai-custom-wrap" class="cal-meta-grid" style="margin-bottom: 8px;"${provider === 'custom' ? '' : ' hidden'}>
        <label class="cal-field cal-field-wide">
          <span>${isAr ? 'رابط المزود Base URL' : 'Base URL'}</span>
          <input type="url" id="cal-ai-base-url" class="form-input" value="${esc(settings.customAiBaseUrl || '')}" placeholder="https://api.provider.com/v1">
        </label>
        <label class="cal-field cal-field-wide">
          <span>${isAr ? 'اسم النموذج' : 'Model ID'}</span>
          <input type="text" id="cal-ai-custom-model" class="form-input" value="${esc(settings.customAiModel || '')}" placeholder="model-name">
        </label>
      </div>

      <div class="cal-ai-key-row">
        <input type="password" id="cal-ai-key-input" class="form-input" value="${esc(currentKey)}" placeholder="${esc(guide.placeholder)}" autocomplete="off">
        <button type="button" id="btn-cal-test-save-ai" class="btn-secondary">${isAr ? 'اختبار وحفظ' : 'Test & Save'}</button>
        <button type="button" id="btn-cal-rescan-syllabi" class="btn-primary">${isAr ? 'إعادة مسح الخطط' : 'Re-Scan Syllabi'}</button>
      </div>
      <div id="cal-ai-test-status" class="cal-ai-test-status"></div>
    </div>
  </div>`;
}

/**
 * Reads back every confirmed/edited course card from the Calibration Wizard DOM into clean
 * `UserCourseConfig[]`, computing unitWeight and preserving existing colors/aliases.
 */
export function readCalibrationCourses(
  root: ParentNode,
  previousCourses: UserCourseConfig[] = []
): UserCourseConfig[] {
  const prevById = new Map(previousCourses.map(c => [c.id, c]));
  const result: UserCourseConfig[] = [];

  root.querySelectorAll<HTMLElement>('.cal-course-card').forEach((card, cardIdx) => {
    const keep = card.querySelector<HTMLInputElement>('.cal-keep-course');
    if (keep && !keep.checked) return;

    const prevId = card.dataset.courseId || '';
    const existing = (prevId && prevById.get(prevId)) || previousCourses[cardIdx];
    const courseId = existing?.id || `course_cal_${Date.now()}_${cardIdx}`;
    const courseCode = (card.querySelector<HTMLInputElement>('.cal-course-code')?.value || '').trim().slice(0, 24);
    const courseNameRaw = (card.querySelector<HTMLInputElement>('.cal-course-name')?.value || '').trim().slice(0, 90);
    const courseName = courseNameRaw || courseCode || `Course ${cardIdx + 1}`;
    const creditsRaw = parseFloat(card.querySelector<HTMLInputElement>('.cal-course-credits')?.value || '');
    const creditHours = !isNaN(creditsRaw) && creditsRaw >= 0 && creditsRaw <= 60 ? creditsRaw : existing?.creditHours;

    const scheduleSlots: CustomScheduleSlot[] = [];
    card.querySelectorAll<HTMLElement>('.cal-slot-row').forEach(slotEl => {
      const days: Weekday[] = [];
      slotEl.querySelectorAll<HTMLInputElement>('.cal-slot-day:checked').forEach(cb => {
        const val = cb.value as Weekday;
        if (val && !days.includes(val)) days.push(val);
      });
      const startTime = (slotEl.querySelector<HTMLInputElement>('.cal-slot-start')?.value || '').trim();
      const endTime = (slotEl.querySelector<HTMLInputElement>('.cal-slot-end')?.value || '').trim();
      const room = (slotEl.querySelector<HTMLInputElement>('.cal-slot-room')?.value || '').trim().slice(0, 32);
      if (days.length > 0 && startTime && endTime) {
        scheduleSlots.push({ days, startTime, endTime, room });
      }
    });

    const syllabus: CustomSyllabusComponent[] = [];
    card.querySelectorAll<HTMLElement>('.cal-syl-row').forEach((sylEl, sIdx) => {
      const name = (sylEl.querySelector<HTMLInputElement>('.cal-syl-name')?.value || '').trim().slice(0, 50);
      const type = (sylEl.querySelector<HTMLSelectElement>('.cal-syl-type')?.value || 'other') as TaskType;
      const weightNum = parseFloat(sylEl.querySelector<HTMLInputElement>('.cal-syl-weight')?.value || '');
      const countRaw = parseInt(sylEl.querySelector<HTMLInputElement>('.cal-syl-count')?.value || '', 10);
      const outOfRaw = parseInt(sylEl.querySelector<HTMLInputElement>('.cal-syl-outof')?.value || '', 10);
      if (!name || isNaN(weightNum) || weightNum < 0) return;

      const count = !isNaN(countRaw) && countRaw > 0 ? countRaw : undefined;
      const outOf = !isNaN(outOfRaw) && outOfRaw > 0 ? Math.max(count || 1, outOfRaw) : undefined;
      const compId = sylEl.dataset.compId || `${courseId}_comp_${sIdx + 1}`;
      const unitWeight = count && count > 0 ? round2(weightNum / count) : undefined;
      syllabus.push({
        id: compId,
        name,
        type,
        totalWeight: round2(weightNum),
        ...(count ? { count } : {}),
        ...(outOf ? { outOf } : {}),
        ...(unitWeight !== undefined ? { unitWeight } : {}),
      });
    });

    result.push({
      id: courseId,
      courseCode,
      courseName,
      creditHours,
      colorHex: card.dataset.courseColor || existing?.colorHex || '#2563eb',
      aliases: existing?.aliases || [],
      scheduleSlots,
      syllabus,
    });
  });

  return result;
}
