import type { UiLanguage } from '../types';
import { UI_LABELS_AR, UI_LABELS_EN, UI_PHRASES_MAIN_AR } from './i18nDictionaries';
import { UI_PHRASES_SETTINGS_AR } from './i18nSettingsPhrases';

export { UI_LABELS_AR, UI_LABELS_EN };

export const LANG_STORAGE_KEY = 'bbs_lang';

export const UI_PHRASES_AR: Record<string, string> = {
  ...UI_PHRASES_MAIN_AR,
  ...UI_PHRASES_SETTINGS_AR,
};

const TASK_TYPE_AR: Record<string, string> = {
  quiz: 'كويز',
  exam: 'امتحان',
  assignment: 'واجب',
  lab: 'مختبر',
  project: 'مشروع',
  meeting: 'جلسة',
  other: 'مهمة',
  payment: 'دفعة مالية'
};

export function normalizeUiLanguage(val?: unknown): UiLanguage {
  return val === 'ar' ? 'ar' : 'en';
}

export function isArabicUi(lang?: UiLanguage): boolean {
  return lang === 'ar';
}

export function uiText(lang: UiLanguage | undefined, en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
}

export function getSavedUiLanguage(): UiLanguage {
  try {
    if (typeof localStorage !== 'undefined') {
      return normalizeUiLanguage(localStorage.getItem(LANG_STORAGE_KEY));
    }
  } catch {}
  return 'en';
}

export function localizeTaskTypeLabel(type: string | undefined, lang: UiLanguage, upper = true): string {
  const key = (type || 'assignment').toLowerCase();
  if (lang === 'ar') return TASK_TYPE_AR[key] || TASK_TYPE_AR.other;
  return upper ? key.toUpperCase() : key;
}

export function localizeSummaryStrings(lang: UiLanguage) {
  if (lang === 'ar') {
    return {
      summaryHeader: 'الملخص',
      whenKey: 'الموعد',
      roomKey: 'القاعة',
      weightKey: 'الوزن',
      topicsKey: 'المواضيع',
      rulesKey: 'القواعد',
      scoreKey: 'الدرجة',
      briefKey: 'الملخص',
      profNotes: 'ملاحظات الأستاذ',
      noNotes: 'لا يوجد نص إعلان مسجل لهذا الموعد.',
      initialPost: 'الإعلان الأول',
      profUpdate: (n: number) => `تحديث الأستاذ #${n}`,
      updateCount: (n: number) => (n === 1 ? 'تحديث واحد' : `${n} تحديثات`),
      singlePost: 'منشور واحد',
      fullView: 'عرض كامل',
      copy: 'نسخ',
      notSpecified: 'غير محدد',
      standardRules: 'قواعد المساق القياسية',
      portalRules: 'بوابة الدفع / تحويل بنكي',
      dateNotSet: 'التاريخ غير محدد',
      classTime: 'وقت المحاضرة',
      onlineSubmission: 'تسليم إلكتروني',
      tba: 'لم يُحدد بعد',
      notSet: 'غير محدد',
      submittedAwaiting: 'تم التسليم (بانتظار الدرجة)',
      graded: 'تم الرصد'
    };
  }
  return {
    summaryHeader: 'Summary',
    whenKey: 'When',
    roomKey: 'Room',
    weightKey: 'Weight',
    topicsKey: 'Topics',
    rulesKey: 'Rules',
    scoreKey: 'Score',
    briefKey: 'Summary',
    profNotes: 'Professor Notes',
    noNotes: 'No announcement text recorded for this item.',
    initialPost: 'Initial Announcement',
    profUpdate: (n: number) => `Professor Update #${n}`,
    updateCount: (n: number) => `${n} ${n === 1 ? 'update' : 'updates'}`,
    singlePost: '1 post',
    fullView: 'Full View',
    copy: 'Copy',
    notSpecified: 'Not specified',
    standardRules: 'Standard course rules',
    portalRules: 'Portal / Bank Transfer',
    dateNotSet: 'Date not set',
    classTime: 'Class Time',
    onlineSubmission: 'Online Submission',
    tba: 'TBA',
    notSet: 'Not set',
    submittedAwaiting: 'Submitted (awaiting grade)',
    graded: 'Graded'
  };
}

export function localizeActionLabels(lang: UiLanguage) {
  if (lang === 'ar') {
    return {
      restore: 'استعادة',
      restoreTitle: 'استعادة إلى مواعيدي',
      pending: 'قيد الانتظار',
      pendingTitle: 'إرجاع إلى قيد الانتظار',
      markPaid: 'تم الدفع',
      markPaidTitle: 'تحديد كمدفوعة',
      markDone: 'تمت',
      markDoneTitle: 'تحديد كمكتمل',
      edit: 'تعديل',
      editDeadlineTitle: 'تعديل الموعد',
      editPaymentTitle: 'تعديل الدفعة',
      share: 'مشاركة',
      shareTitle: 'مشاركة التفاصيل',
      portal: 'البوابة',
      portalTitle: 'فتح بوابة الدفع',
      calendar: 'التقويم',
      calendarTitle: 'إضافة إلى تقويم Google',
      hideTitle: 'نقل إلى المخفي',
      deleteDeadlineTitle: 'حذف الموعد',
      deletePaymentTitle: 'حذف الدفعة'
    };
  }
  return {
    restore: 'Restore',
    restoreTitle: 'Restore to My Deadlines',
    pending: 'Pending',
    pendingTitle: 'Mark as Pending',
    markPaid: 'Mark Paid',
    markPaidTitle: 'Mark as Paid',
    markDone: 'Mark Done',
    markDoneTitle: 'Mark as Done',
    edit: 'Edit',
    editDeadlineTitle: 'Edit deadline',
    editPaymentTitle: 'Edit payment',
    share: 'Share',
    shareTitle: 'Share details',
    portal: 'Portal',
    portalTitle: 'Open payment portal',
    calendar: 'Calendar',
    calendarTitle: 'Add to Google Calendar',
    hideTitle: 'Move to Hidden',
    deleteDeadlineTitle: 'Delete deadline',
    deletePaymentTitle: 'Delete payment'
  };
}

export function applyDocumentLanguage(doc: Document | null | undefined, lang: UiLanguage): void {
  if (!doc?.documentElement) return;
  doc.documentElement.lang = lang === 'ar' ? 'ar' : 'en';
  doc.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

const originalTextNodeMap = new WeakMap<Node, string>();
const originalElementAttrMap = new WeakMap<Element, Record<string, string>>();
const translatedDocs = new WeakSet<Document>();

const ICON_OR_BADGE_CLASSES = [
  'nav-tab-icon', 'nav-icon', 'card-icon', 'ui-icon',
  'search-icon', 'hsb-icon', 'fb-status-icon', 'nav-badge',
  'badge-count', 'payments-header-badge', 'settings-pill', 'info-badge'
];

const HARD_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'svg']);
const SUBTREE_SKIP_TAGS = new Set(['CODE', 'KBD', 'TEXTAREA', 'INPUT']);
const SUBTREE_SKIP_CLASSES = [
  'nav-tab-icon', 'nav-icon', 'card-icon', 'ui-icon',
  'search-icon', 'hsb-icon', 'fb-status-icon', 'ql-icon-tile-label'
];
const SUBTREE_SKIP_IDS = new Set([
  'cal-month-title', 'task-list', 'selected-day-list', 'day-drawer-body',
  'grades-tracker-breakdown', 'syllabus-tracker-breakdown',
  'mobile-grades-tracker-breakdown', 'mobile-syllabus-tracker-breakdown',
  'user-courses-list', 'payments-list', 'payments-guide-body',
  'calendar-grid', 'calendar-quick-links-chips', 'legend-chips-container',
  'schedule-quick-links-container', 'wt-key-display', 'setting-sync-key',
  'web-sync-key-input', 'feed-url-text', 'course-editor-slots',
  'course-editor-syllabus', 'extract-preview-list', 'import-banner-preview-list',
  'calibration-courses-list', 'calibration-ai-panel', 'archived-semesters-list',
  'grade-scale-editor', 'ql-list-container', 'ql-icon-picker-grid',
  'up-next-list', 'up-next-classes', 'selected-day-classes',
  'day-expanded-classes', 'student-profile-card', 'mobile-student-profile-card',
  'admin-banners-container', 'mobile-admin-banners', 'toast-container',
  'setting-university', 'wt-university'
]);

const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label'] as const;

function isIconOrBadgeEl(el: Element): boolean {
  if (el.tagName === 'svg' || el.tagName === 'SVG') return true;
  const cl = el.classList;
  if (!cl) return false;
  for (let i = 0; i < ICON_OR_BADGE_CLASSES.length; i++) {
    if (cl.contains(ICON_OR_BADGE_CLASSES[i])) return true;
  }
  return false;
}

function shouldSkipSubtree(el: Element): boolean {
  if (SUBTREE_SKIP_TAGS.has(el.tagName)) return true;
  if (el.id && SUBTREE_SKIP_IDS.has(el.id)) return true;
  if (el.hasAttribute('data-i18n-skip')) return true;
  const cl = el.classList;
  if (cl) {
    for (let i = 0; i < SUBTREE_SKIP_CLASSES.length; i++) {
      if (cl.contains(SUBTREE_SKIP_CLASSES[i])) return true;
    }
  }
  return false;
}

/**
 * Updates text inside an element WITHOUT ever clobbering child <svg>, icon wrappers, or badges.
 */
function setElementTextPreservingIcons(el: Element, text: string, lang: UiLanguage): void {
  if (el.children.length === 0) {
    if (!originalTextNodeMap.has(el)) {
      originalTextNodeMap.set(el, el.textContent || '');
    }
    el.textContent = lang === 'en' ? (originalTextNodeMap.get(el) ?? text) : text;
    return;
  }

  // Prefer a direct non-icon, non-badge child span without SVGs
  let labelChild: Element | undefined;
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (
      child.tagName === 'SPAN' &&
      !isIconOrBadgeEl(child) &&
      child.children.length === 0
    ) {
      labelChild = child;
      break;
    }
  }
  if (labelChild) {
    if (!originalTextNodeMap.has(labelChild)) {
      originalTextNodeMap.set(labelChild, labelChild.textContent || '');
    }
    labelChild.textContent = lang === 'en' ? (originalTextNodeMap.get(labelChild) ?? text) : text;
    return;
  }

  // Otherwise update only an existing non-empty direct text node so <svg> children stay intact
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 3 && (n.nodeValue || '').trim().length > 0) {
      const raw = originalTextNodeMap.get(n) ?? (n.nodeValue || '');
      if (!originalTextNodeMap.has(n)) originalTextNodeMap.set(n, raw);
      const lead = raw.match(/^\s*/)?.[0] || '';
      const trail = raw.match(/\s*$/)?.[0] || '';
      n.nodeValue = lang === 'en' ? raw : `${lead}${text}${trail}`;
      break;
    }
  }
}

function translateStaticTextNode(node: Node, lang: UiLanguage): void {
  const current = node.nodeValue || '';
  if (!current.trim()) return;
  if (!originalTextNodeMap.has(node)) {
    originalTextNodeMap.set(node, current);
  }
  const orig = originalTextNodeMap.get(node)!;
  if (lang === 'en') {
    if (current !== orig) node.nodeValue = orig;
    return;
  }
  const core = orig.replace(/\s+/g, ' ').trim();
  const translated = UI_PHRASES_AR[core];
  if (!translated) return;
  const lead = orig.match(/^\s*/)?.[0] || '';
  const trail = orig.match(/\s*$/)?.[0] || '';
  node.nodeValue = `${lead}${translated}${trail}`;
}

function translateElementAttributes(el: Element, lang: UiLanguage): void {
  let saved = originalElementAttrMap.get(el);
  for (let i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
    const attr = TRANSLATABLE_ATTRS[i];
    const cur = el.getAttribute(attr);
    if (cur === null) continue;
    if (!saved) {
      saved = {};
      originalElementAttrMap.set(el, saved);
    }
    if (saved[attr] === undefined) {
      saved[attr] = cur;
    }
    const origVal = saved[attr];
    if (lang === 'en') {
      if (cur !== origVal) el.setAttribute(attr, origVal);
    } else {
      const translated = UI_PHRASES_AR[origVal.replace(/\s+/g, ' ').trim()];
      if (translated) el.setAttribute(attr, translated);
    }
  }
}

export function translatePhrase(text: string, lang: UiLanguage): string {
  if (lang !== 'ar') return text;
  const core = String(text || '').replace(/\s+/g, ' ').trim();
  return UI_PHRASES_AR[core] || text;
}

export function translateStaticUiElements(doc: Document | null | undefined, lang: UiLanguage): void {
  if (!doc) return;
  applyDocumentLanguage(doc, lang);

  // Fast-path: initial English boot needs no DOM rewrite when already in canonical EN
  if (lang === 'en' && !translatedDocs.has(doc)) return;
  if (lang === 'ar') translatedDocs.add(doc);

  // 1. Selector overrides (never overwrite elements containing <svg> icons)
  const map = lang === 'ar' ? UI_LABELS_AR : UI_LABELS_EN;
  for (const [selector, text] of Object.entries(map)) {
    const matches = doc.querySelectorAll(selector);
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]) setElementTextPreservingIcons(matches[i], text, lang);
    }
  }

  // 2. Document title
  if (doc.title) {
    if (!originalTextNodeMap.has(doc)) originalTextNodeMap.set(doc, doc.title);
    const origTitle = originalTextNodeMap.get(doc)!;
    doc.title = lang === 'ar' ? (UI_PHRASES_AR[origTitle] || origTitle) : origTitle;
  }

  const root = doc.body || doc.documentElement;
  if (!root) return;

  // 3. Single-pass iterative DFS with O(1) subtree pruning (text nodes + attributes)
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (HARD_SKIP_TAGS.has(el.tagName)) continue;

    translateElementAttributes(el, lang);
    if (shouldSkipSubtree(el)) continue;

    const children = el.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.nodeType === 3) {
        translateStaticTextNode(child, lang);
      } else if (child.nodeType === 1) {
        stack.push(child as Element);
      }
    }
  }
}
