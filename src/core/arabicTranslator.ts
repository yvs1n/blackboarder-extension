import type { DeadlineTask, TaskArabicMirror, UiLanguage } from '../types';
import { splitAnnouncementNotes } from './announcementReconcile';

const AR_LETTER_RE = /[\u0600-\u06FF]/;
const COURSE_TERM_AR: Array<[RegExp, string]> = [
  [/\bcalculus\s*i{3}\b|\bcalculus\s*3\b/gi, 'حسبان 3'],
  [/\bcalculus\s*ii\b|\bcalculus\s*2\b/gi, 'حسبان 2'],
  [/\bcalculus\s*i\b|\bcalculus\s*1\b/gi, 'حسبان 1'],
  [/\bfor\s+engineering\b/gi, 'للهندسة'],
  [/\bfor\s+sciences\b/gi, 'للعلوم'],
  [/\bphysics\s*1\b|\bphysics\s*i\b/gi, 'فيزياء 1'],
  [/\bphysics\s*2\b|\bphysics\s*ii\b/gi, 'فيزياء 2'],
  [/\bgeneral\s+physics\b/gi, 'الفيزياء العامة'],
  [/\bgeneral\s+chemistry\b/gi, 'الكيمياء العامة'],
  [/\bchemistry\b/gi, 'الكيمياء'],
  [/\bislamic\s+culture\b/gi, 'الثقافة الإسلامية'],
  [/\benglish\s+for\s+academic\s+purposes\b|\beap\b/gi, 'اللغة الإنجليزية للأغراض الأكاديمية'],
  [/\bintro(?:duction)?\s+to\s+programming\b/gi, 'مقدمة في البرمجة'],
  [/\bprogramming\b/gi, 'البرمجة'],
  [/\bdata\s+structures\b/gi, 'تراكيب البيانات'],
  [/\blinear\s+algebra\b/gi, 'الجبر الخطي'],
  [/\bdiscrete\s+mathematics\b/gi, 'الرياضيات المتقطعة'],
  [/\bdifferential\s+equations\b/gi, 'المعادلات التفاضلية'],
  [/\bengineering\s+ethics\b/gi, 'أخلاقيات الهندسة'],
  [/\bstatics\b/gi, 'علم السكون (ستاتيكا)'],
  [/\bdynamics\b/gi, 'الديناميكا'],
  [/\bthermodynamics\b/gi, 'الديناميكا الحرارية'],
  [/\bcircuits\b/gi, 'الدوائر الكهربائية'],
  [/\blab(?:oratory)?\b/gi, 'مختبر']
];

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bExtended\s+Deadline\b/gi, 'تم تمديد الموعد'],
  [/\bExtension\b/gi, 'تمديد'],
  [/\bMakeup\b|\bMake[\s-]*up\b/gi, 'تعويضي'],
  [/\bfor\s+Any\b/gi, 'لأي اختبار فائت'],
  [/\bfor\s+those\s+who\s+missed\b/gi, 'لمن فاته الموعد'],
  [/\bFinal\s+Exam(?:ination)?\b/gi, 'الامتحان النهائي'],
  [/\bMidterm\s+Exam(?:ination)?\b|\bMidterm\b/gi, 'امتحان منتصف الفصل'],
  [/\bQuiz(?:zes)?\b/gi, 'كويز'],
  [/\bLab(?:oratory)?\s+Report\b/gi, 'تقرير المختبر'],
  [/\bLab(?:oratory)?\s+Exam\b/gi, 'امتحان المختبر'],
  [/\bAssignments?\b/gi, 'الواجب'],
  [/\bHomeworks?\b|\bHW\b/gi, 'الواجب'],
  [/\bCourse\s+Project\b/gi, 'مشروع المساق'],
  [/\bProject\b/gi, 'مشروع'],
  [/\bPresentation\b/gi, 'عرض تقديمي'],
  [/\bExam\s+(?:sheet\s+)?Review\b|\bPaper\s+Viewing\b/gi, 'مراجعة أوراق الامتحان'],
  [/\bReview\s+Session\b/gi, 'جلسة مراجعة']
];

const FORMAT_RULE_MAP: Array<[RegExp, string]> = [
  [/\bOnline\b/gi, 'أونلاين'],
  [/\bIn-person\b/gi, 'حضوري'],
  [/\bTake-home\b/gi, 'تسليم منزلي'],
  [/\bPaper-based\b/gi, 'ورقي'],
  [/\bClosed\s+book\b/gi, 'كتاب مغلق'],
  [/\bOpen\s+book\b/gi, 'كتاب مفتوح'],
  [/\bFormula\s+sheet\s+allowed\b/gi, 'يُسمح بورقة القوانين'],
  [/\bNo\s+calculators\b/gi, 'يُمنع استخدام الآلة الحاسبة'],
  [/\bScientific\s+calculator\s+allowed\b/gi, 'الآلة الحاسبة العلمية مسموحة'],
  [/\bCalculator\s+allowed\b/gi, 'الآلة الحاسبة مسموحة'],
  [/\bLockDown\s+Browser\b/gi, 'متصفح LockDown'],
  [/\bMCQ\b/gi, 'اختيار من متعدد'],
  [/\bBring\s+Student\s+ID\b/gi, 'إحضار البطاقة الجامعية'],
  [/\bBring\s+laptop\b/gi, 'إحضار الحاسوب المحمول'],
  [/\bPDF\s+submission\b/gi, 'تسليم بصيغة PDF'],
  [/\bStandard\s+course\s+rules\b/gi, 'قواعد المساق القياسية'],
  [/(\d+(?:\.\d+)?)\s*min\b/gi, '$1 دقيقة'],
  [/(\d+(?:\.\d+)?)\s*hr\b/gi, '$1 ساعة']
];

export function hasArabicLetters(text?: string): boolean {
  return Boolean(text && AR_LETTER_RE.test(text));
}

export function isPredominantlyArabic(text?: string): boolean {
  if (!text) return false;
  const arCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const enCount = (text.match(/[A-Za-z]/g) || []).length;
  return arCount >= 4 && arCount >= enCount * 0.6;
}

/** Deterministic fingerprint of English task text so updates immediately invalidate stale Arabic mirrors. */
export function computeTaskTranslationSig(task: Partial<DeadlineTask>): string {
  const desc = (task.description || task.sourceSnippet || '').trim();
  const base = [
    task.title || '',
    task.courseName || '',
    task.weightDisplay || '',
    task.room || '',
    task.hiddenReason || '',
    task.hiddenReasonLabel || '',
    task.summary?.brief || '',
    task.summary?.topics || '',
    task.summary?.formatRules || '',
    desc.slice(0, 240),
    String(desc.length)
  ].join('|');
  let h = 5381;
  for (let i = 0; i < base.length; i++) {
    h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function translateCourseNameToArabic(name?: string): string {
  const raw = (name || '').trim();
  if (!raw || isPredominantlyArabic(raw)) return raw;
  if (/^general\s+course$/i.test(raw)) return 'مساق عام';
  let out = raw;
  for (const [re, ar] of COURSE_TERM_AR) {
    out = out.replace(re, ar);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function translateTaskTitleToArabic(title?: string, type?: string): string {
  const raw = (title || '').trim();
  if (!raw) {
    const fallback: Record<string, string> = {
      quiz: 'كويز',
      exam: 'امتحان',
      assignment: 'واجب',
      lab: 'مختبر',
      project: 'مشروع',
      meeting: 'جلسة',
      other: 'مهمة'
    };
    return fallback[(type || 'other').toLowerCase()] || 'موعد';
  }
  if (isPredominantlyArabic(raw)) return raw;

  let out = raw;
  const isPluralAssign = /\bAssignments\s+\d/i.test(out);
  const isPluralQuiz = /\bQuizzes\s+\d/i.test(out);

  for (const [re, ar] of PHRASE_REPLACEMENTS) {
    out = out.replace(re, ar);
  }
  if (isPluralAssign) out = out.replace(/^الواجب\b/, 'الواجبات');
  if (isPluralQuiz) out = out.replace(/^كويز\b/, 'الكويزات');

  out = out
    .replace(/\(\s*(تم تمديد الموعد)\s*\)/g, '($1)')
    .replace(/\bBonus\b/gi, 'بونص')
    .replace(/\bReview\b/gi, 'مراجعة')
    .replace(/\bChapter\s*/gi, 'الفصل ')
    .replace(/\bChapters\s*/gi, 'الفصول ')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

export function translateWeightDisplayToArabic(weightDisplay?: string, task?: Partial<DeadlineTask>): string | undefined {
  if (!weightDisplay && !task?.isBonus) return weightDisplay;
  if (task?.isBonus && (!weightDisplay || /^bonus credit$/i.test(weightDisplay))) {
    return 'درجة إضافية (بونص)';
  }
  const raw = (weightDisplay || '').trim();
  if (!raw || isPredominantlyArabic(raw)) return raw || undefined;
  return raw
    .replace(/\bof\s+Grade\b/gi, 'من الدرجة')
    .replace(/\bFinal\s+Exam\b/gi, 'الامتحان النهائي')
    .replace(/\bMidterm\s+Exam\b|\bMidterm\b/gi, 'امتحان منتصف الفصل')
    .replace(/\bHomeworks?\b|\bAssignments?\b/gi, 'الواجبات')
    .replace(/\bQuizzes\b|\bQuiz\b/gi, 'الكويزات')
    .replace(/\bLab(?:oratory)?(?:\s+Reports?)?\b/gi, 'تقارير المختبر')
    .replace(/\bProjects?\b/gi, 'المشاريع')
    .replace(/\bBonus\b/gi, 'بونص')
    .replace(/\bCourse\s+Total\b/gi, 'المجموع الكلي')
    .replace(/(\d+)\s+of\s+(\d+)/gi, '$1 من $2');
}

export function translateRoomToArabic(room?: string): string | undefined {
  const raw = (room || '').trim();
  if (!raw) return undefined;
  if (/^online$/i.test(raw)) return 'أونلاين';
  if (/^online\s+submission$/i.test(raw)) return 'تسليم إلكتروني';
  if (/^tba$/i.test(raw)) return 'لم يُحدد بعد';
  return raw;
}

export function translateTopicsToArabic(topics?: string): string | undefined {
  const raw = (topics || '').trim();
  if (!raw || isPredominantlyArabic(raw)) return raw || undefined;
  if (/^not\s+specified$/i.test(raw)) return 'غير محدد';
  return raw
    .replace(/\bChapters?\b|\bCh\.?\b/gi, 'الفصل')
    .replace(/\bLectures?\b/gi, 'المحاضرة')
    .replace(/\bUnits?\b/gi, 'الوحدة')
    .replace(/\bModules?\b/gi, 'الوحدة')
    .replace(/\bSections?\b/gi, 'القسم')
    .replace(/\bWeeks?\b/gi, 'الأسبوع')
    .replace(/\band\b/gi, 'و')
    .replace(/\bto\b/gi, 'إلى');
}

export function translateRulesToArabic(rules?: string): string | undefined {
  const raw = (rules || '').trim();
  if (!raw || isPredominantlyArabic(raw)) return raw || undefined;
  let out = raw;
  for (const [re, ar] of FORMAT_RULE_MAP) {
    out = out.replace(re, ar);
  }
  return out;
}

export function translateHiddenReasonToArabic(hiddenReason?: string, hiddenReasonLabel?: string): string | undefined {
  const raw = (hiddenReasonLabel || '').trim();
  if (!raw && !hiddenReason) return undefined;
  if (raw && isPredominantlyArabic(raw)) return raw;
  if (hiddenReason === 'manual_hide' || /^hidden\s+by\s+you$/i.test(raw)) return 'تم الإخفاء يدوياً';
  if (hiddenReason === 'review_session' || /review|viewing/i.test(raw)) return 'جلسة مراجعة بعد الامتحان';
  if (hiddenReason === 'quota_exhausted') {
    const m = raw.match(/All\s+(.+?)\s+already\s+completed/i);
    return m ? `جميع ${translateTopicsToArabic(m[1]) || m[1]} مكتملة بالفعل` : 'تم استيفاء نصاب هذا التقييم بالفعل';
  }
  if (hiddenReason === 'extension_completed') {
    const m = raw.match(/Items?\s+(.+?)\s+already\s+completed/i);
    return m ? `المهام (${m[1]}) مكتملة بالفعل` : 'جميع المهام المشمولة بالتمديد مكتملة';
  }
  if (/Original\s+Midterm\s+already\s+completed/i.test(raw)) return 'امتحان منتصف الفصل الأصلي مكتمل بالفعل';
  if (/Original\s+Final(?:\s+Exam)?\s+already\s+completed/i.test(raw)) return 'الامتحان النهائي الأصلي مكتمل بالفعل';
  const numM = raw.match(/Original\s+(Quiz|Lab|Assignment)\s*(\d+)?\s*already\s+completed/i);
  if (numM) {
    const kindAr = numM[1].toLowerCase() === 'quiz' ? 'الكويز الأصلي' : (numM[1].toLowerCase() === 'lab' ? 'المختبر الأصلي' : 'الواجب الأصلي');
    return `${kindAr}${numM[2] ? ` ${numM[2]}` : ''} مكتمل بالفعل`;
  }
  return 'غير مطلوب منك';
}

export function translateDescriptionToArabic(task: Partial<DeadlineTask>): string | undefined {
  const raw = (task.description || task.sourceSnippet || '').trim();
  if (!raw || /^gradebook$/i.test(raw)) return undefined;
  const segments = splitAnnouncementNotes(raw);
  if (segments.length === 0) return undefined;

  const translated = segments.map((seg, i) => {
    const prefix = i > 0 ? '[تحديث الأستاذ]:\n' : '';
    const cleanedSeg = seg.replace(/^\[(?:Professor|Doctor)\s+Update\]:\s*/i, '').trim();
    if (isPredominantlyArabic(cleanedSeg)) {
      return `${prefix}${cleanedSeg}`;
    }
    let body = cleanedSeg
      .replace(/\bScheduled\s+hall:/gi, 'القاعة المجدولة:')
      .replace(/\bRoom:/gi, 'القاعة:')
      .replace(/\bDate:/gi, 'التاريخ:')
      .replace(/\bMethod:/gi, 'الطريقة:')
      .replace(/\bComment:/gi, 'ملاحظة:')
      .replace(/\bPaper-based\b/gi, 'ورقي')
      .replace(/\bThis is your chance to do a missed assignment\.?/gi, 'فرصة لتسليم واجب فائت.')
      .replace(/\bThe makeup (?:quiz|exam) for those who missed/gi, 'امتحان/كويز تعويضي لمن فاته')
      .replace(/\bDeadlines? for\b/gi, 'تم تحديد/تمديد موعد')
      .replace(/\bwill be held on\b/gi, 'سيُعقد في')
      .replace(/\bhas been (?:extended|postponed|rescheduled|moved) to\b/gi, 'تم تأجيله/تمديده إلى')
      .trim();
    return `${prefix}${body}`;
  });
  return translated.join('\n\n');
}

function translateBriefToArabic(task: Partial<DeadlineTask>, titleAr: string): string | undefined {
  const brief = (task.summary?.brief || '').trim();
  if (!brief) return undefined;
  if (isPredominantlyArabic(brief)) return brief;
  return `${titleAr}: ${brief
    .replace(/\bhave been extended to\b/gi, 'تم تمديدها إلى')
    .replace(/\bhas been extended to\b/gi, 'تم تمديده إلى')
    .replace(/\brescheduled to\b|\bmoved to\b/gi, 'تم نقله إلى')
    .replace(/\bDeadlines for\b/gi, 'مواعيد تسليم')}`;
}

/**
 * Builds or refreshes a task's mirrored Arabic representation cleanly.
 * If the English source fields haven't changed since an AI translation (`translatedBy === 'ai'`),
 * the AI Arabic fields are preserved while structured metadata (weight/room/hidden reason) stays fresh.
 */
export function buildTaskArabicMirror(
  task: Partial<DeadlineTask>,
  aiPatch?: Partial<TaskArabicMirror>
): TaskArabicMirror {
  const sig = computeTaskTranslationSig(task);
  const prev = task.ar;
  const keepAi = Boolean(prev && prev.translatedBy === 'ai' && prev.sourceSig === sig && !aiPatch);

  const titleAr = aiPatch?.title?.trim()
    || (keepAi && prev?.title)
    || translateTaskTitleToArabic(task.title, task.type);

  const courseAr = aiPatch?.courseName?.trim()
    || (keepAi && prev?.courseName)
    || translateCourseNameToArabic(task.courseName);

  const briefAr = aiPatch?.brief?.trim()
    || (keepAi && prev?.brief)
    || translateBriefToArabic(task, titleAr);

  const topicsAr = aiPatch?.topics?.trim()
    || (keepAi && prev?.topics)
    || translateTopicsToArabic(task.summary?.topics);

  const rulesAr = aiPatch?.formatRules?.trim()
    || (keepAi && prev?.formatRules)
    || translateRulesToArabic(task.summary?.formatRules);

  const descAr = aiPatch?.description?.trim()
    || (keepAi && prev?.description)
    || translateDescriptionToArabic(task);

  const originalIsArabic = isPredominantlyArabic(task.description || task.sourceSnippet || task.title);

  return {
    title: titleAr,
    ...(courseAr ? { courseName: courseAr } : {}),
    ...(descAr ? { description: descAr, sourceSnippet: descAr } : {}),
    ...(briefAr ? { brief: briefAr } : {}),
    ...(topicsAr ? { topics: topicsAr } : {}),
    ...(rulesAr ? { formatRules: rulesAr } : {}),
    ...(translateWeightDisplayToArabic(task.weightDisplay, task) ? { weightDisplay: translateWeightDisplayToArabic(task.weightDisplay, task) } : {}),
    ...(translateRoomToArabic(task.room) ? { room: translateRoomToArabic(task.room) } : {}),
    ...(translateHiddenReasonToArabic(task.hiddenReason, task.hiddenReasonLabel)
      ? { hiddenReasonLabel: translateHiddenReasonToArabic(task.hiddenReason, task.hiddenReasonLabel) }
      : {}),
    translatedBy: aiPatch ? 'ai' : (keepAi ? prev!.translatedBy : (originalIsArabic ? 'source' : 'local')),
    sourceSig: sig,
    updatedAt: new Date().toISOString()
  };
}

/** Mutates/returns task with an up-to-date `.ar` mirror if missing or stale after an English update. */
export function syncArabicMirrorOnTask<T extends Partial<DeadlineTask>>(
  task: T,
  aiPatch?: Partial<TaskArabicMirror>
): T {
  if (!task || typeof task !== 'object') return task;
  const sig = computeTaskTranslationSig(task);
  if (!aiPatch && task.ar && task.ar.sourceSig === sig) {
    return task;
  }
  task.ar = buildTaskArabicMirror(task, aiPatch);
  return task;
}

export function ensureArabicMirrorsOnTasks<T extends Partial<DeadlineTask>>(tasks: T[]): T[] {
  if (!Array.isArray(tasks)) return tasks;
  return tasks.map(t => syncArabicMirrorOnTask(t));
}

/** Resolves localized fields for UI rendering ('en' or 'ar') with automatic fallback. */
export function localizedTaskView(task: Partial<DeadlineTask>, lang: UiLanguage = 'en') {
  if (lang !== 'ar') {
    return {
      title: task.title || '',
      courseName: task.courseName || '',
      description: task.description || '',
      sourceSnippet: task.sourceSnippet || '',
      room: task.room || '',
      weightDisplay: task.weightDisplay || '',
      hiddenReasonLabel: task.hiddenReasonLabel || '',
      brief: task.summary?.brief || '',
      topics: task.summary?.topics || '',
      formatRules: task.summary?.formatRules || ''
    };
  }
  const ar = task.ar || buildTaskArabicMirror(task);
  return {
    title: ar.title || translateTaskTitleToArabic(task.title, task.type),
    courseName: ar.courseName || translateCourseNameToArabic(task.courseName) || task.courseName || '',
    description: ar.description || task.description || '',
    sourceSnippet: ar.sourceSnippet || ar.description || task.sourceSnippet || '',
    room: ar.room || translateRoomToArabic(task.room) || '',
    weightDisplay: ar.weightDisplay || translateWeightDisplayToArabic(task.weightDisplay, task) || task.weightDisplay || '',
    hiddenReasonLabel: ar.hiddenReasonLabel || translateHiddenReasonToArabic(task.hiddenReason, task.hiddenReasonLabel) || '',
    brief: ar.brief || translateBriefToArabic(task, ar.title) || '',
    topics: ar.topics || translateTopicsToArabic(task.summary?.topics) || '',
    formatRules: ar.formatRules || translateRulesToArabic(task.summary?.formatRules) || ''
  };
}
