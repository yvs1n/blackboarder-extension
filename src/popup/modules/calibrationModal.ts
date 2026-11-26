import type { AiProvider, UserCourseConfig, UserSettings } from '../../types';
import {
  AI_SETUP_GUIDES,
  FIRST_CALIBRATION_DONE_KEY,
  buildCalibrationCourseDrafts,
  calculateCalibrationCourseTotal,
  readCalibrationCourses,
  renderCalibrationAiSetupHtml,
  renderCalibrationCourseCardHtml,
  renderScheduleRowHtml,
  renderSyllabusRowHtml,
} from '../../core/calibrationWizard';
import { normalizeAiBaseUrl, resolveAiEndpoint, testAiEndpoint } from '../../engine/aiProviders';
import { discoverAndExtractBlackboardSyllabi, markFirstSyllabusScanDone } from '../../scan/syllabusScanner';
import { getSettings, getUserCourses, saveSettings } from '../../utils/storage';
import { loadPdfJs, resolveActiveBlackboardScanOrigin } from './courseImporter';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { refreshAiKeyLock } from './settingsView';
import { popupActions, popupState } from './state';

let calibrationDirtyByUser = false;
let calibrationScanInFlight = false;
let currentCalibrationCourses: UserCourseConfig[] = [];

export async function isFirstCalibrationDone(): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(FIRST_CALIBRATION_DONE_KEY);
      if (typeof res?.[FIRST_CALIBRATION_DONE_KEY] === 'boolean') return res[FIRST_CALIBRATION_DONE_KEY];
    }
  } catch {}
  try {
    return localStorage.getItem(FIRST_CALIBRATION_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function markFirstCalibrationDone(done = true): Promise<void> {
  try {
    localStorage.setItem(FIRST_CALIBRATION_DONE_KEY, done ? 'true' : 'false');
  } catch {}
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [FIRST_CALIBRATION_DONE_KEY]: done });
    }
  } catch {}
}

function setCalibrationBanner(text: string, stateClass: '' | 'is-scanning' | 'is-ready' = ''): void {
  const banner = document.getElementById('calibration-scan-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.className = `calibration-scan-banner${stateClass ? ` ${stateClass}` : ''}`;
}

function updateCardTotalBadge(cardEl: HTMLElement): void {
  const pill = cardEl.querySelector<HTMLElement>('.cal-weight-total-pill');
  if (!pill) return;
  const total = calculateCalibrationCourseTotal(cardEl);
  pill.textContent = `${total}% / 100%`;
  pill.classList.toggle('is-ok', Math.abs(total - 100) <= 0.5);
  pill.classList.toggle('is-warn', Math.abs(total - 100) > 0.5);
}

function wireAiPanelHandlers(aiContainer: HTMLElement, initialSettings: UserSettings): void {
  const lang = popupState.currentLanguage;
  let workingSettings: UserSettings = { ...initialSettings };

  const getKeyField = (p: AiProvider): 'openRouterApiKey' | 'ifmApiKey' | 'customAiApiKey' =>
    p === 'ifm' ? 'ifmApiKey' : p === 'custom' ? 'customAiApiKey' : 'openRouterApiKey';

  const rerenderAi = () => {
    aiContainer.innerHTML = renderCalibrationAiSetupHtml(workingSettings, lang);
    bindAiEvents();
  };

  const readEndpointFromInputs = () => {
    const providerSel = document.getElementById('cal-ai-provider') as HTMLSelectElement | null;
    const provider: AiProvider = providerSel?.value === 'ifm' || providerSel?.value === 'custom' ? providerSel.value : 'openrouter';
    const keyVal = (document.getElementById('cal-ai-key-input') as HTMLInputElement | null)?.value.trim() || '';
    const baseUrlVal = normalizeAiBaseUrl((document.getElementById('cal-ai-base-url') as HTMLInputElement | null)?.value);
    const customModelVal = (document.getElementById('cal-ai-custom-model') as HTMLInputElement | null)?.value.trim() || '';
    return {
      provider,
      keyVal,
      baseUrlVal,
      customModelVal,
      endpoint: resolveAiEndpoint({
        ...workingSettings,
        aiProvider: provider,
        [getKeyField(provider)]: keyVal,
        customAiBaseUrl: baseUrlVal,
        customAiModel: customModelVal,
      }),
    };
  };

  const bindAiEvents = () => {
    const modeRadios = aiContainer.querySelectorAll<HTMLInputElement>('input[name="cal-ai-mode"]');
    const configFields = document.getElementById('cal-ai-config-fields');
    modeRadios.forEach(r => {
      r.addEventListener('change', async () => {
        const useAi = r.value === 'ai';
        workingSettings = { ...workingSettings, useAiExtraction: useAi };
        aiContainer.querySelectorAll('.cal-ai-mode-pill').forEach(p => {
          const inp = p.querySelector('input');
          p.classList.toggle('is-selected', Boolean(inp?.checked));
        });
        if (configFields) configFields.hidden = !useAi;
        await saveSettings({ useAiExtraction: useAi });
      });
    });

    const providerSel = document.getElementById('cal-ai-provider') as HTMLSelectElement | null;
    providerSel?.addEventListener('change', async () => {
      const p: AiProvider = providerSel.value === 'ifm' || providerSel.value === 'custom' ? providerSel.value : 'openrouter';
      workingSettings = { ...workingSettings, aiProvider: p, useAiExtraction: true };
      await saveSettings({ aiProvider: p, useAiExtraction: true });
      rerenderAi();
      const guide = AI_SETUP_GUIDES[p];
      const inp = document.getElementById('cal-ai-key-input') as HTMLInputElement | null;
      if (inp) inp.placeholder = guide.placeholder;
    });

    document.getElementById('btn-cal-test-save-ai')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('cal-ai-test-status');
      const show = (msg: string, ok = false) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('is-ok', ok);
      };
      const { provider, keyVal, baseUrlVal, customModelVal, endpoint } = readEndpointFromInputs();
      if (!endpoint) {
        show(lang === 'ar' ? 'أدخل المفتاح وإعدادات المزود أولاً.' : 'Enter your API key first.');
        return;
      }
      if (provider === 'custom' && typeof chrome !== 'undefined' && chrome.permissions?.request && baseUrlVal) {
        try {
          const granted = await chrome.permissions.request({ origins: [`${new URL(baseUrlVal).origin}/*`] });
          if (!granted) {
            show(lang === 'ar' ? 'لم يُمنح إذن الوصول للموقع.' : 'Site access permission was declined.');
            return;
          }
        } catch {}
      }
      show(lang === 'ar' ? 'جارٍ اختبار الاتصال...' : 'Testing API key...');
      const res = await testAiEndpoint(endpoint);
      if (res.ok) {
        const patch: Partial<UserSettings> = {
          aiProvider: provider,
          useAiExtraction: true,
          [getKeyField(provider)]: keyVal,
          ...(provider === 'custom' ? { customAiBaseUrl: baseUrlVal, customAiModel: customModelVal } : {}),
        };
        workingSettings = await saveSettings(patch);
        void refreshAiKeyLock(true);
        await popupActions.loadSettingsForm();
      }
      show(res.message, res.ok);
    });

    document.getElementById('btn-cal-rescan-syllabi')?.addEventListener('click', async () => {
      const { provider, keyVal, baseUrlVal, customModelVal, endpoint } = readEndpointFromInputs();
      if (endpoint) {
        workingSettings = await saveSettings({
          aiProvider: provider,
          useAiExtraction: true,
          [getKeyField(provider)]: keyVal,
          ...(provider === 'custom' ? { customAiBaseUrl: baseUrlVal, customAiModel: customModelVal } : {}),
        });
      }
      calibrationDirtyByUser = false;
      await runCalibrationSyllabusExtraction(true);
    });
  };

  rerenderAi();
}

function renderCalibrationCourseCards(courses: UserCourseConfig[]): void {
  const listEl = document.getElementById('calibration-courses-list');
  if (!listEl) return;
  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  currentCalibrationCourses = courses;

  if (!courses.length) {
    listEl.innerHTML = `<div class="calibration-empty">${isAr ? 'لم يتم العثور على مواد بعد. أضف مادة يدوياً أو أعد المسح.' : 'No courses found yet. Click + Add Course below to add one.'}</div>`;
    return;
  }

  listEl.innerHTML = courses.map((c, idx) => renderCalibrationCourseCardHtml(c, idx, lang)).join('');
}

function bindCalibrationListDelegation(listEl: HTMLElement): void {
  if (listEl.dataset.calDelegated === '1') return;
  listEl.dataset.calDelegated = '1';

  listEl.addEventListener('input', (e) => {
    calibrationDirtyByUser = true;
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.cal-course-card');
    if (!card) return;
    if (target.classList.contains('cal-syl-weight')) {
      updateCardTotalBadge(card);
    } else if (target.classList.contains('cal-course-name')) {
      const titleSpan = card.querySelector('.cal-course-head-title');
      if (titleSpan) titleSpan.textContent = (target as HTMLInputElement).value.trim() || 'Course';
    }
  });

  listEl.addEventListener('change', (e) => {
    calibrationDirtyByUser = true;
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('cal-slot-day')) {
      target.closest('.cal-day-pill')?.classList.toggle('is-on', target.checked);
    }
  });

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    calibrationDirtyByUser = true;
    const action = btn.dataset.action;
    const card = btn.closest<HTMLElement>('.cal-course-card');
    if (!card) return;
    const lang = popupState.currentLanguage;

    if (action === 'add-slot') {
      const slotsList = card.querySelector('.cal-slots-list');
      slotsList?.insertAdjacentHTML('beforeend', renderScheduleRowHtml({ days: ['sun', 'tue'], startTime: '11:00', endTime: '12:15', room: '' }, lang));
    } else if (action === 'remove-slot') {
      btn.closest('.cal-slot-row')?.remove();
    } else if (action === 'add-syl') {
      const sylList = card.querySelector('.cal-syl-list');
      const cid = card.dataset.courseId || 'course';
      const count = (sylList?.querySelectorAll('.cal-syl-row').length || 0) + 1;
      sylList?.insertAdjacentHTML('beforeend', renderSyllabusRowHtml({ id: `${cid}_comp_${count}`, name: '', type: 'assignment', totalWeight: 10 }, lang));
      updateCardTotalBadge(card);
    } else if (action === 'remove-syl') {
      btn.closest('.cal-syl-row')?.remove();
      updateCardTotalBadge(card);
    }
  });
}

async function runCalibrationSyllabusExtraction(forceOverwriteUntouched = false): Promise<void> {
  if (calibrationScanInFlight) return;
  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const origin = await resolveActiveBlackboardScanOrigin(true).catch(() => '');
  if (!origin) {
    setCalibrationBanner(
      isAr
        ? 'تأكد من بيانات موادك وأوقات المحاضرات وتوزيع الدرجات أدناه قبل البدء.'
        : 'Confirm your course names, class times, and assessment breakdown below before saving.',
      'is-ready'
    );
    return;
  }

  calibrationScanInFlight = true;
  setCalibrationBanner(
    isAr
      ? 'جارٍ فحص مقررات بلاك بورد لاستخراج الخطط الدراسية وتوزيع الدرجات تلقائياً...'
      : 'Checking Blackboard course folders for syllabi, schedules & grade breakdowns...',
    'is-scanning'
  );

  try {
    const settings = await getSettings();
    const ai = resolveAiEndpoint(settings);
    const fetchFn = (path: string, init?: RequestInit) =>
      fetch(new URL(path, origin).href, { ...init, credentials: 'include' });

    const baseCourses = popupState.currentUserCourses.length
      ? popupState.currentUserCourses
      : await getUserCourses();

    const result = await discoverAndExtractBlackboardSyllabi({
      origin,
      fetchFn,
      ai,
      allowLocalFallback: true,
      existingCourses: baseCourses,
      loadPdfJs,
      onProgress: p => setCalibrationBanner(p.message, 'is-scanning'),
    });

    if (result.courses.length > 0 && (!calibrationDirtyByUser || forceOverwriteUntouched)) {
      const merged = buildCalibrationCourseDrafts(baseCourses, result.courses);
      renderCalibrationCourseCards(merged);
      const n = result.courses.length;
      setCalibrationBanner(
        isAr
          ? `تم استخراج ${n} خطة مادة تلقائياً من بلاك بورد. راجعها وعدّلها ثم اضغط تأكيد.`
          : `Auto-extracted ${n} course syllabus${n === 1 ? '' : 'es'} from Blackboard. Confirm names, class times, counts & best-of rules below.`,
        'is-ready'
      );
      if (ai) await markFirstSyllabusScanDone(true);
    } else if (result.matchedFiles > 0) {
      setCalibrationBanner(
        isAr
          ? 'تم العثور على ملفات لكن يلزم التحقق اليدوي أو إضافة مفتاح AI لقراءتها بدقة أكبر.'
          : 'Found syllabus files on Blackboard — fill in any missing weights or add a free AI key above and click Re-Scan.',
        'is-ready'
      );
    } else {
      setCalibrationBanner(
        isAr
          ? 'راجع أسماء المواد وأوقات المحاضرات وتوزيع الاختبارات والواجبات أدناه ثم اضغط تأكيد.'
          : 'Review your courses, class schedules, quizzes/assignments counts and weights below, then confirm.',
        'is-ready'
      );
    }
  } catch {
    setCalibrationBanner(
      isAr ? 'راجع تفاصيل المواد أدناه ثم اضغط تأكيد للحفظ.' : 'Review your course details below and click Confirm to save.',
      'is-ready'
    );
  } finally {
    calibrationScanInFlight = false;
  }
}

export function closeCalibrationModal(markDone = true): void {
  closeModalEl('modal-calibration', document.getElementById('modal-calibration'));
  if (markDone) {
    void markFirstCalibrationDone(true);
  }
}

export async function openCalibrationWizard(options: { autoScanSyllabi?: boolean } = {}): Promise<void> {
  const modal = document.getElementById('modal-calibration');
  const aiContainer = document.getElementById('calibration-ai-container');
  const listEl = document.getElementById('calibration-courses-list');
  if (!modal || !aiContainer || !listEl) return;

  calibrationDirtyByUser = false;
  const settings = await getSettings();
  const storedCourses = popupState.currentUserCourses.length
    ? popupState.currentUserCourses
    : await getUserCourses();
  const initialCourses = buildCalibrationCourseDrafts(storedCourses, []);

  wireAiPanelHandlers(aiContainer, settings);
  bindCalibrationListDelegation(listEl);
  renderCalibrationCourseCards(initialCourses);

  const lang = popupState.currentLanguage;
  setCalibrationBanner(
    lang === 'ar'
      ? 'راجع موادك وأوقاتك وتوزيع الدرجات قبل الاستخدام الأول.'
      : 'Confirm your course setup, class schedule, and assessment counts before continuing.',
    'is-ready'
  );

  registerOverlayCloseHandler('modal-calibration', () => closeCalibrationModal(true));
  openModalEl('modal-calibration', modal);

  if (options.autoScanSyllabi !== false) {
    void runCalibrationSyllabusExtraction(false);
  }
}

/**
 * Automatically triggers the first-scan calibration wizard on a new student's first scan once
 * enrolled courses are discovered.
 */
export async function maybeRunFirstScanCalibration(scanSucceeded: boolean): Promise<void> {
  if (!scanSucceeded) return;
  const done = await isFirstCalibrationDone();
  if (done) return;
  const courses = popupState.currentUserCourses.length
    ? popupState.currentUserCourses
    : await getUserCourses();
  if (!courses.length) return;
  const existingModalOpen = document.getElementById('modal-calibration') && !document.getElementById('modal-calibration')?.classList.contains('hidden');
  if (existingModalOpen) return;
  await openCalibrationWizard({ autoScanSyllabi: true });
}

export function initCalibrationModal(): void {
  const modal = document.getElementById('modal-calibration');
  if (!modal) return;

  document.getElementById('btn-close-calibration')?.addEventListener('click', () => closeCalibrationModal(true));
  document.getElementById('btn-calibration-skip')?.addEventListener('click', () => closeCalibrationModal(true));
  modal.addEventListener('click', e => {
    if (e.target === modal) closeCalibrationModal(true);
  });

  document.getElementById('btn-calibration-add-course')?.addEventListener('click', () => {
    const listEl = document.getElementById('calibration-courses-list');
    if (!listEl) return;
    const current = readCalibrationCourses(listEl, currentCalibrationCourses);
    const nextCourse: UserCourseConfig = {
      id: `course_manual_${Date.now()}`,
      courseCode: '',
      courseName: '',
      creditHours: 3,
      colorHex: '#2563eb',
      aliases: [],
      scheduleSlots: [],
      syllabus: [],
    };
    renderCalibrationCourseCards([...current, nextCourse]);
    const lastCard = listEl.querySelector('.cal-course-card:last-child');
    lastCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btn-calibration-confirm')?.addEventListener('click', async () => {
    const confirmBtn = document.getElementById('btn-calibration-confirm') as HTMLButtonElement | null;
    const listEl = document.getElementById('calibration-courses-list');
    if (!listEl) return;

    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const calibrated = readCalibrationCourses(listEl, currentCalibrationCourses);
      if (calibrated.length > 0) {
        await popupActions.handleCoursesUpdated(calibrated);
      }
      await markFirstCalibrationDone(true);
      await markFirstSyllabusScanDone(true);
      closeCalibrationModal(true);
      const isAr = popupState.currentLanguage === 'ar';
      popupActions.showToast(
        isAr
          ? `تم حفظ معايرة ${calibrated.length} مادة بنجاح!`
          : `Calibrated ${calibrated.length} course${calibrated.length === 1 ? '' : 's'} — you're all set!`
      );
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });
}
