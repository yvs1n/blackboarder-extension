import { resolveBlackboardOrigin } from '../../background/httpScanner';
import { applyCourseImport, type CourseDraft } from '../../core/courseDocument';
import { courseImportReviewHtml, readCourseImportReview } from '../../core/courseImportView';
import { mergeImportedCourses, parseCoursesFromJson } from '../../core/courseImporter';
import { fileToText, type PdfJsLike } from '../../core/documentText';
import { createStateMachine } from '../../core/stateMachine';
import { findCoursesInDocument } from '../../engine/aiCourseImport';
import { resolveAiEndpoint } from '../../engine/aiProviders';
import {
  discoverAndExtractBlackboardSyllabi,
  isFirstSyllabusScanDone,
  markFirstSyllabusScanDone,
  shouldAutoScanSyllabiOnFirstScan
} from '../../scan/syllabusScanner';
import { isLikelyBlackboardUrl, isBuiltInBlackboardHost, originPattern } from '../../utils/extension/blackboardSites';
import { getSettings, getUserCourses, saveUserCourses } from '../../utils/storage/index';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { popupActions, popupState } from './state';

export type CourseImportState = 'idle' | 'reading' | 'reviewing' | 'saving' | 'error';
export type CourseImportEvent = 'READ' | 'REVIEW' | 'EMPTY' | 'SAVE' | 'FAIL' | 'RESET';

export const courseImportMachine = createStateMachine<CourseImportState, CourseImportEvent>({
  initial: 'idle',
  transitions: {
    idle: { READ: 'reading', RESET: 'idle' },
    reading: { READ: 'reading', REVIEW: 'reviewing', EMPTY: 'idle', FAIL: 'error', RESET: 'idle' },
    reviewing: { READ: 'reading', SAVE: 'saving', RESET: 'idle' },
    saving: { RESET: 'idle', FAIL: 'reviewing' },
    error: { READ: 'reading', RESET: 'idle' }
  },
  onTransition(next) {
    const busy = next === 'reading' || next === 'saving';
    const previewBtn = document.getElementById('btn-preview-banner') as HTMLButtonElement | null;
    const confirmBtn = document.getElementById('btn-confirm-banner-import') as HTMLButtonElement | null;
    if (previewBtn) previewBtn.disabled = busy;
    if (confirmBtn) confirmBtn.disabled = busy;
  }
});

let detectedImportCourses: CourseDraft[] = [];
let importRunId = 0;

export function resetCourseImporterState(): void {
  importRunId++;
  detectedImportCourses = [];
  courseImportMachine.send('RESET');
}

/** pdf.js ships inside the extension and is loaded only when a PDF is imported. */
export async function loadPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import(/* @vite-ignore */ chrome.runtime.getURL('vendor/pdfjs/pdf.min.js'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
  return pdfjs;
}

function setImportStatus(text: string) {
  const el = document.getElementById('import-status');
  if (el) el.textContent = text;
}

export async function openCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (!modal) return;
  resetCourseImporterState();
  const previewContainer = document.getElementById('import-banner-preview-container');
  if (previewContainer) previewContainer.style.display = 'none';
  const bannerText = document.getElementById('import-banner-text') as HTMLTextAreaElement;
  if (bannerText) bannerText.value = '';
  const jsonText = document.getElementById('import-json-text') as HTMLTextAreaElement;
  if (jsonText) jsonText.value = '';
  const fileInput = document.getElementById('input-import-document') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
  const fileLabel = document.getElementById('import-file-label');
  if (fileLabel) fileLabel.textContent = 'Choose a PDF, Word or text file';
  setImportStatus('');

  const aiRow = document.getElementById('import-ai-row');
  if (aiRow) aiRow.hidden = !resolveAiEndpoint(await getSettings());

  switchImporterTab('banner');
  registerOverlayCloseHandler('modal-course-import', closeCourseImporter);
  openModalEl('modal-course-import', modal);
}

export function closeCourseImporter() {
  resetCourseImporterState();
  closeModalEl('modal-course-import', document.getElementById('modal-course-import'));
}

export function switchImporterTab(tab: 'banner' | 'json') {
  const tabBanner = document.getElementById('tab-import-banner');
  const tabJson = document.getElementById('tab-import-json');
  const contentBanner = document.getElementById('tab-content-banner');
  const contentJson = document.getElementById('tab-content-json');

  if (tab === 'banner') {
    tabBanner?.classList.add('active');
    tabJson?.classList.remove('active');
    if (contentBanner) contentBanner.style.display = 'block';
    if (contentJson) contentJson.style.display = 'none';
  } else {
    tabBanner?.classList.remove('active');
    tabJson?.classList.add('active');
    if (contentBanner) contentBanner.style.display = 'none';
    if (contentJson) contentJson.style.display = 'block';
  }
}

export async function handleImportDocumentFile(file: File) {
  const runId = ++importRunId;
  courseImportMachine.send('READ');
  const label = document.getElementById('import-file-label');
  if (label) label.textContent = file.name;
  setImportStatus(`Reading ${file.name}...`);
  try {
    const text = await fileToText(file, loadPdfJs);
    if (runId !== importRunId) return;
    const area = document.getElementById('import-banner-text') as HTMLTextAreaElement | null;
    if (area) area.value = text;
    await handlePreviewBanner();
  } catch (e: any) {
    if (runId !== importRunId) return;
    courseImportMachine.send('FAIL');
    setImportStatus(String(e?.message || 'That file could not be read.'));
  }
}

export async function handlePreviewBanner() {
  const text = (document.getElementById('import-banner-text') as HTMLTextAreaElement)?.value || '';
  const container = document.getElementById('import-banner-preview-container');
  const list = document.getElementById('import-banner-preview-list');
  if (!text.trim()) {
    courseImportMachine.send('EMPTY');
    setImportStatus('Choose a file or paste the text first.');
    return;
  }
  const runId = ++importRunId;
  courseImportMachine.send('READ');
  const useAi = !document.getElementById('import-ai-row')?.hidden && (document.getElementById('import-use-ai') as HTMLInputElement | null)?.checked;
  const ai = useAi ? resolveAiEndpoint(await getSettings()) : null;
  if (runId !== importRunId) return;
  setImportStatus(ai ? 'Reading it with your AI model...' : 'Looking for courses...');
  const result = await findCoursesInDocument(text, ai);
  if (runId !== importRunId) return;
  detectedImportCourses = result.courses;
  if (!container || !list) {
    courseImportMachine.send('EMPTY');
    return;
  }
  if (!detectedImportCourses.length) {
    courseImportMachine.send('EMPTY');
    container.style.display = 'none';
    setImportStatus(`No courses found${result.aiProblem ? ` (AI: ${result.aiProblem})` : ''}. Check the text above, or add the course yourself with Add Course.`);
    return;
  }
  courseImportMachine.send('REVIEW');
  const n = detectedImportCourses.length;
  setImportStatus(`Found ${n} course${n === 1 ? '' : 's'}${result.source === 'ai' ? ' with your AI model' : ''}.${result.aiProblem ? ` The AI could not help (${result.aiProblem}), so the built-in reader was used.` : ''}`);
  list.innerHTML = courseImportReviewHtml(detectedImportCourses, popupState.currentUserCourses, undefined, popupState.currentLanguage);
  container.style.display = 'block';
}

export async function handleConfirmBannerImport() {
  const list = document.getElementById('import-banner-preview-list');
  if (!list || !detectedImportCourses.length) return;
  const picks = readCourseImportReview(list, detectedImportCourses);
  if (!picks.length) {
    popupActions.showToast('Nothing ticked to save.');
    return;
  }
  if (!courseImportMachine.send('SAVE')) return;
  try {
    await popupActions.handleCoursesUpdated(applyCourseImport(popupState.currentUserCourses, picks));
    closeCourseImporter();
    popupActions.showToast(`Saved ${picks.length} course${picks.length === 1 ? '' : 's'}. They sync to your phone.`);
  } catch {
    courseImportMachine.send('FAIL');
  }
}

export async function handleConfirmJsonImport() {
  const jsonText = (document.getElementById('import-json-text') as HTMLTextAreaElement)?.value || '';
  if (!jsonText.trim()) {
    popupActions.showToast('Please paste JSON course data or select a file.');
    return;
  }
  try {
    const parsed = parseCoursesFromJson(jsonText);
    if (parsed.length === 0) {
      popupActions.showToast('No valid courses found in JSON.');
      return;
    }
    const merged = mergeImportedCourses(popupState.currentUserCourses, parsed);
    await popupActions.handleCoursesUpdated(merged);
    closeCourseImporter();
    popupActions.showToast(`Imported ${parsed.length} courses from JSON!`);
  } catch (err: any) {
    alert(`Invalid JSON format: ${err.message || err}`);
  }
}

export function exportCoursesJson() {
  const jsonStr = JSON.stringify(popupState.currentUserCourses, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blackboarder-courses.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  popupActions.showToast('Exported blackboarder-courses.json');
}

export async function handleResetCourses() {
  if (!confirm('Remove all courses? Your next Blackboard scan adds the courses you are enrolled in.')) {
    return;
  }
  await saveUserCourses([]);
  await popupActions.handleCoursesUpdated([]);
  popupActions.showToast('Courses cleared. Scan Blackboard to add yours.');
}

let syllabusScanInFlight = false;

/** Opens the shared course import confirmation modal pre-filled with Blackboard-discovered syllabi. */
export async function openSyllabusReviewFromScan(drafts: CourseDraft[], summaryText: string): Promise<void> {
  const modal = document.getElementById('modal-course-import');
  if (!modal || !drafts.length) return;

  await openCourseImporter();
  const importRun = ++importRunId;
  detectedImportCourses = drafts;
  courseImportMachine.send('READ');
  courseImportMachine.send('REVIEW');
  if (importRun !== importRunId) return;

  const container = document.getElementById('import-banner-preview-container');
  const list = document.getElementById('import-banner-preview-list');
  const fileLabel = document.getElementById('import-file-label');
  if (fileLabel) fileLabel.textContent = 'Found automatically in your Blackboard courses';
  setImportStatus(summaryText);
  if (list) list.innerHTML = courseImportReviewHtml(drafts, popupState.currentUserCourses);
  if (container) container.style.display = 'block';
}

export async function resolveActiveBlackboardScanOrigin(requestPermissionIfNeeded: boolean): Promise<string> {
  let preferredOrigin = '';
  try {
    const tabs = await chrome.tabs?.query?.({ active: true, currentWindow: true }).catch(() => []) || [];
    const url = tabs[0]?.url;
    if (url && isLikelyBlackboardUrl(url)) {
      preferredOrigin = new URL(url).origin;
    }
  } catch {}
  const origin = await resolveBlackboardOrigin(preferredOrigin).catch(() => '');
  if (!origin) return '';
  try {
    const host = new URL(origin).hostname;
    if (!isBuiltInBlackboardHost(host) && chrome.permissions?.contains) {
      const hasPerm = await chrome.permissions.contains({ origins: [originPattern(origin)] }).catch(() => false);
      if (!hasPerm && requestPermissionIfNeeded && chrome.permissions.request) {
        const granted = await chrome.permissions.request({ origins: [originPattern(origin)] }).catch(() => false);
        if (!granted) return '';
      } else if (!hasPerm && !requestPermissionIfNeeded) {
        return '';
      }
    }
  } catch {}
  return origin;
}

/**
 * Scans Blackboard courses for syllabus files and asks the student to confirm before saving.
 * Strictly requires an AI API key (`resolveAiEndpoint`).
 */
export async function runBlackboardSyllabusScan(options: {
  autoFirstTime?: boolean;
  onStatus?: (message: string) => void;
} = {}): Promise<void> {
  if (syllabusScanInFlight) return;
  const auto = Boolean(options.autoFirstTime);
  const scanBtn = document.getElementById('btn-scan-syllabi') as HTMLButtonElement | null;
  const settings = await getSettings();
  const ai = resolveAiEndpoint(settings);

  if (!ai) {
    if (!auto) {
      popupActions.switchView('settings');
      popupActions.showSettingsPage('scanning');
      popupActions.showToast('Add an AI API key in Settings > Scanning to scan Blackboard syllabi.');
    }
    return;
  }

  syllabusScanInFlight = true;
  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.dataset.origLabel = scanBtn.textContent || 'Scan Syllabi';
    const labelSpan = scanBtn.querySelector('span');
    if (labelSpan) labelSpan.textContent = 'Scanning...';
  }

  try {
    const origin = await resolveActiveBlackboardScanOrigin(!auto);
    if (!origin) {
      if (!auto) popupActions.showToast('Connect or open your Blackboard site first.');
      return;
    }

    const fetchFn = (path: string, init?: RequestInit) =>
      fetch(new URL(path, origin).href, { ...init, credentials: 'include' });

    const existing = popupState.currentUserCourses.length
      ? popupState.currentUserCourses
      : await getUserCourses();

    const result = await discoverAndExtractBlackboardSyllabi({
      origin,
      fetchFn,
      ai,
      existingCourses: existing,
      loadPdfJs,
      onProgress: p => {
        options.onStatus?.(p.message);
        if (scanBtn) {
          const labelSpan = scanBtn.querySelector('span');
          if (labelSpan) labelSpan.textContent = p.current && p.total ? `${p.current}/${p.total}...` : 'Scanning...';
        }
      }
    });

    if (auto && result.ok) {
      await markFirstSyllabusScanDone(true);
    }

    if (!result.ok) {
      if (!auto && result.errors.length) {
        popupActions.showToast(result.errors[0]);
      }
      return;
    }

    if (result.courses.length > 0) {
      const n = result.courses.length;
      await openSyllabusReviewFromScan(
        result.courses,
        `Found ${n} course syllabus${n === 1 ? '' : 'es'} in Blackboard. Check before saving.`
      );
    } else if (!auto) {
      popupActions.showToast(
        result.matchedFiles > 0
          ? 'Syllabus files were found, but no breakdown could be read. Try Import File.'
          : 'No syllabus files found in Blackboard courses. Upload a syllabus with Import File.'
      );
    }
  } finally {
    syllabusScanInFlight = false;
    if (scanBtn) {
      scanBtn.disabled = false;
      const labelSpan = scanBtn.querySelector('span');
      if (labelSpan) labelSpan.textContent = scanBtn.dataset.origLabel || 'Scan Syllabi';
    }
  }
}

/** Runs first-scan-only Blackboard syllabus extraction after a successful initial scan if an AI key is configured. */
export async function maybeAutoScanBlackboardSyllabi(scanSucceeded: boolean): Promise<void> {
  if (!scanSucceeded) return;
  const firstDone = await isFirstSyllabusScanDone();
  const settings = await getSettings();
  const ai = resolveAiEndpoint(settings);
  const courses = popupState.currentUserCourses.length ? popupState.currentUserCourses : await getUserCourses();
  if (!shouldAutoScanSyllabiOnFirstScan({ firstScanDone: firstDone, aiEndpoint: ai, courses, scanSucceeded })) {
    return;
  }
  await runBlackboardSyllabusScan({ autoFirstTime: true });
}
