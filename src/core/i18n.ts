import type { UiLanguage } from '../types';

export const LANG_STORAGE_KEY = 'bbs_lang';

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

export const UI_LABELS_AR: Record<string, string> = {
  // Nav tabs
  '#tab-nav-calendar > span:first-of-type, #tab-calendar .nav-label': 'التقويم',
  '#tab-nav-details > span:first-of-type, #tab-details .nav-label, #tab-deadlines .nav-label': 'المواعيد',
  '#tab-nav-marks > span:first-of-type, #tab-marks .nav-label': 'الدرجات',
  '#tab-nav-courses > span:first-of-type, #tab-courses .nav-label, #tab-schedule .nav-label': 'المساقات',
  '#tab-settings .nav-label': 'الإعدادات',
  '#btn-scan-tab span': 'فحص',
  // Settings nav tabs
  '#settings-tab-general span, #settings-group-tab-general': 'عام',
  '#settings-tab-sync span, #settings-group-tab-sync': 'المزامنة',
  '#settings-tab-calendar span, #settings-group-tab-calendar': 'التقويم',
  '#settings-tab-alerts span, #settings-group-tab-alerts': 'التنبيهات',
  '#settings-tab-data span, #settings-group-tab-data': 'البيانات',
  '#settings-tab-updates span, #settings-group-tab-updates': 'التحديثات',
  '#settings-tab-scanning span': 'الفحص',
  // Stats & Headers
  '#btn-jump-today': 'اليوم',
  '#btn-save-settings, #settings-form button[type="submit"]': 'حفظ الإعدادات',
  '#btn-cancel-settings': 'رجوع',
  '#btn-add-course span': 'إضافة مساق',
  '#btn-import-courses': 'استيراد ملف',
  '#btn-scan-syllabi span': 'مسح خطط المساقات',
  '#btn-calibrate-courses span': 'معايرة المساقات',
  '#calibration-modal-title': 'معايرة المساقات وإعداد الذكاء الاصطناعي',
  '#btn-calibration-add-course': '+ إضافة مساق',
  '#btn-calibration-skip': 'تخطي الآن',
  '#btn-calibration-confirm': 'تأكيد والبدء في الاستخدام',
  '#language-label': 'لغة التطبيق / App Language'
};

export const UI_LABELS_EN: Record<string, string> = {
  '#tab-nav-calendar > span:first-of-type, #tab-calendar .nav-label': 'Calendar',
  '#tab-nav-details > span:first-of-type, #tab-details .nav-label, #tab-deadlines .nav-label': 'Deadlines',
  '#tab-nav-marks > span:first-of-type, #tab-marks .nav-label': 'Marks',
  '#tab-nav-courses > span:first-of-type, #tab-courses .nav-label, #tab-schedule .nav-label': 'Courses',
  '#tab-settings .nav-label': 'Settings',
  '#btn-scan-tab span': 'Scan',
  '#settings-tab-general span, #settings-group-tab-general': 'General',
  '#settings-tab-sync span, #settings-group-tab-sync': 'Sync',
  '#settings-tab-calendar span, #settings-group-tab-calendar': 'Calendar',
  '#settings-tab-alerts span, #settings-group-tab-alerts': 'Alerts',
  '#settings-tab-data span, #settings-group-tab-data': 'Data',
  '#settings-tab-updates span, #settings-group-tab-updates': 'Updates',
  '#settings-tab-scanning span': 'Scanning',
  '#btn-jump-today': 'Today',
  '#btn-save-settings, #settings-form button[type="submit"]': 'Save Settings',
  '#btn-cancel-settings': 'Back',
  '#btn-add-course span': 'Add Course',
  '#btn-import-courses': 'Import File',
  '#btn-scan-syllabi span': 'Scan Syllabi',
  '#btn-calibrate-courses span': 'Calibrate',
  '#calibration-modal-title': 'Calibrate Courses & AI Setup',
  '#btn-calibration-add-course': '+ Add Course',
  '#btn-calibration-skip': 'Skip for Now',
  '#btn-calibration-confirm': 'Confirm & Start Using Blackboarder',
  '#language-label': 'App Language'
};

export function translateStaticUiElements(doc: Document | null | undefined, lang: UiLanguage): void {
  if (!doc) return;
  applyDocumentLanguage(doc, lang);
  const map = lang === 'ar' ? UI_LABELS_AR : UI_LABELS_EN;
  for (const [selector, text] of Object.entries(map)) {
    doc.querySelectorAll(selector).forEach(el => {
      if (el) el.textContent = text;
    });
  }
}
