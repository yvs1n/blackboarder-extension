import { applyCourseImport, type CourseDraft } from '../../core/courseDocument';
import { courseImportReviewHtml, readCourseImportReview } from '../../core/courseImportView';
import { mergeImportedCourses, parseCoursesFromJson } from '../../core/courseImporter';
import { fileToText, type PdfJsLike } from '../../core/documentText';
import { findCoursesInDocument } from '../../engine/aiCourseImport';
import { resolveAiEndpoint } from '../../engine/aiProviders';
import { getSettings, saveUserCourses } from '../../utils/storage';
import { popupActions, popupState } from './state';

let detectedImportCourses: CourseDraft[] = [];

/** pdf.js ships inside the extension and is loaded only when a PDF is imported. */
async function loadPdfJs(): Promise<PdfJsLike> {
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
  detectedImportCourses = [];
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
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

export function closeCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
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
  const label = document.getElementById('import-file-label');
  if (label) label.textContent = file.name;
  setImportStatus(`Reading ${file.name}...`);
  try {
    const text = await fileToText(file, loadPdfJs);
    const area = document.getElementById('import-banner-text') as HTMLTextAreaElement | null;
    if (area) area.value = text;
    await handlePreviewBanner();
  } catch (e: any) {
    setImportStatus(String(e?.message || 'That file could not be read.'));
  }
}

export async function handlePreviewBanner() {
  const text = (document.getElementById('import-banner-text') as HTMLTextAreaElement)?.value || '';
  const container = document.getElementById('import-banner-preview-container');
  const list = document.getElementById('import-banner-preview-list');
  if (!text.trim()) {
    setImportStatus('Choose a file or paste the text first.');
    return;
  }
  const useAi = !document.getElementById('import-ai-row')?.hidden && (document.getElementById('import-use-ai') as HTMLInputElement | null)?.checked;
  const ai = useAi ? resolveAiEndpoint(await getSettings()) : null;
  setImportStatus(ai ? 'Reading it with your AI model...' : 'Looking for courses...');
  const result = await findCoursesInDocument(text, ai);
  detectedImportCourses = result.courses;
  if (!container || !list) return;
  if (!detectedImportCourses.length) {
    container.style.display = 'none';
    setImportStatus(`No courses found${result.aiProblem ? ` (AI: ${result.aiProblem})` : ''}. Check the text above, or add the course yourself with Add Course.`);
    return;
  }
  const n = detectedImportCourses.length;
  setImportStatus(`Found ${n} course${n === 1 ? '' : 's'}${result.source === 'ai' ? ' with your AI model' : ''}.${result.aiProblem ? ` The AI could not help (${result.aiProblem}), so the built-in reader was used.` : ''}`);
  list.innerHTML = courseImportReviewHtml(detectedImportCourses, popupState.currentUserCourses);
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
  await popupActions.handleCoursesUpdated(applyCourseImport(popupState.currentUserCourses, picks));
  closeCourseImporter();
  popupActions.showToast(`Saved ${picks.length} course${picks.length === 1 ? '' : 's'}. They sync to your phone.`);
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
