import type { DeadlineTask } from '../../types';
import { activeCourseHintOptions } from '../../core/userCourses';
import { extractDeadlinesLocally } from '../../engine/localExtractor';
import { compareTasksByTime } from '../../utils/calendar';
import { addTask, saveTasksMergingLatest } from '../../utils/storage';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import { applyRoomChange, closeReadingSheet, closeRoomPicker } from './readingModal';
import { popupActions, popupState } from './state';

export function initAiExtractModal() {
  const extractModal = document.getElementById('modal-ai-extract');
  const btnOpen = document.getElementById('btn-ai-extract-modal');
  const btnClose = document.getElementById('btn-close-extract-modal');
  const btnCancel = document.getElementById('btn-cancel-extract');
  const btnRun = document.getElementById('btn-run-extract');
  const btnAddCustom = document.getElementById('btn-add-deadline-header');

  btnAddCustom?.addEventListener('click', () => {
    popupActions.switchView('add');
  });

  function closeExtractModal() {
    if (extractModal) {
      extractModal.style.display = 'none';
      extractModal.classList.add('hidden');
    }
  }

  btnOpen?.addEventListener('click', () => {
    if (extractModal) {
      const hint = document.getElementById('extract-course-hint') as HTMLSelectElement | null;
      if (hint) {
        const chosen = hint.value;
        hint.innerHTML = '<option value="">Auto-detect from text</option>' + activeCourseHintOptions()
          .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
        hint.value = chosen;
      }
      extractModal.style.display = 'flex';
      extractModal.classList.remove('hidden');
      const input = document.getElementById('input-extract-text') as HTMLTextAreaElement;
      if (input) input.focus();
    }
  });

  btnClose?.addEventListener('click', closeExtractModal);
  btnCancel?.addEventListener('click', closeExtractModal);
  extractModal?.addEventListener('click', (e) => {
    if (e.target === extractModal) closeExtractModal();
  });

  document.getElementById('btn-close-room-picker')?.addEventListener('click', closeRoomPicker);
  document.getElementById('modal-room-picker')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-room-picker')) closeRoomPicker();
  });

  document.getElementById('btn-apply-custom-room')?.addEventListener('click', async () => {
    if (!popupState.activeRoomPickerTaskId) return;
    const customVal = (document.getElementById('input-custom-room') as HTMLInputElement)?.value.trim() || '';
    await applyRoomChange(popupState.activeRoomPickerTaskId, customVal);
    closeRoomPicker();
  });

  document.getElementById('btn-close-reading-sheet')?.addEventListener('click', closeReadingSheet);
  document.getElementById('modal-reading-sheet')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-reading-sheet')) closeReadingSheet();
  });

  btnRun?.addEventListener('click', async () => {
    const textArea = document.getElementById('input-extract-text') as HTMLTextAreaElement;
    const courseSelect = document.getElementById('extract-course-hint') as HTMLSelectElement;
    const statusBox = document.getElementById('extract-status-box') as HTMLElement;
    const previewList = document.getElementById('extract-preview-list') as HTMLElement;
    const btnIcon = document.getElementById('extract-btn-icon') as HTMLElement;
    const btnText = document.getElementById('extract-btn-text') as HTMLElement;

    const text = (textArea?.value || '').trim();
    const courseHint = courseSelect?.value || '';

    if (!text) {
      popupActions.showToast('Please paste an announcement text first.');
      return;
    }

    if (btnRun) (btnRun as HTMLButtonElement).disabled = true;
    if (btnIcon) btnIcon.innerHTML = getSvgIcon('refresh');
    if (btnText) btnText.textContent = 'Extracting...';
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="extract-status-pill loading">
          <span>${getSvgIcon('bolt', 'mr-1')} Analyzing announcement...</span>
        </div>
      `;
    }
    if (previewList) previewList.innerHTML = '';

    try {
      const extractAnnouncement = {
        id: 'manual-extract',
        courseCode: courseHint || '',
        courseName: courseHint || '',
        title: 'Manual Extract',
        contentText: text,
        sourceUrl: '',
        scannedAt: new Date().toISOString(),
      };
      const extracted = extractDeadlinesLocally(extractAnnouncement);
      if (!extracted || extracted.length === 0) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill error">
              <span>No deadline dates detected in this announcement text.</span>
            </div>
          `;
        }
        popupActions.showToast('No deadlines detected in announcement.');
        return;
      }

      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill success">
            <span>${getSvgIcon('check', 'mr-1')} Found ${extracted.length} deadline(s)!</span>
          </div>
        `;
      }

      previewList.innerHTML = extracted.map((task, idx) => {
        const d = new Date(task.dueDate);
        const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending';
        const timeStr = task.hasSpecificTime && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Class time';
        return `
          <div class="extract-result-item" id="extract-item-${idx}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <h4 style="font-size: 12.5px; font-weight: 700; color: var(--text-main);">${escapeHtml(task.title)}</h4>
                <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                  <span>${getSvgIcon('book', 'mr-1')} ${escapeHtml(task.courseName || '')}</span>
                  <span>${getSvgIcon('calendar', 'mr-1')} ${dateStr} at ${timeStr}</span>
                  ${task.room ? `<span style="color:#4338ca; font-weight:600;">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
                </div>
              </div>
              <button type="button" class="btn-primary btn-add-extracted-item" data-idx="${idx}" style="font-size: 11px; padding: 4px 10px; white-space: nowrap;">
                <span>${getSvgIcon('plus', 'mr-1')} Add</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      previewList.querySelectorAll('.btn-add-extracted-item').forEach(addBtn => {
        addBtn.addEventListener('click', async () => {
          const idx = parseInt(addBtn.getAttribute('data-idx') || '0', 10);
          const t = extracted[idx];
          if (!t) return;
          const newTask: DeadlineTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: t.title,
            courseName: t.courseName,
            courseCode: t.courseCode,
            dueDate: t.dueDate,
            hasSpecificTime: t.hasSpecificTime,
            type: t.type || 'assignment',
            priority: t.priority || 'medium',
            status: 'pending',
            description: text.trim() || t.description || '',
            sourceSnippet: text.trim() || t.sourceSnippet || '',
            room: t.room,
            weight: t.weight,
            weightDisplay: t.weightDisplay,
            syllabusNote: t.syllabusNote,
            confidence: t.confidence ?? 1.0,
            extractedBy: 'ai',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          popupState.currentTasks = await addTask(newTask);
          popupState.currentTasks.sort(compareTasksByTime);
          popupState.currentTasks = await saveTasksMergingLatest(popupState.currentTasks);
          popupActions.refreshAllViews();
          popupActions.syncTasksToCloud(popupState.currentTasks, 'Extracted Announcement Added');
          (addBtn as HTMLButtonElement).disabled = true;
          addBtn.textContent = '✓ Added';
          popupActions.showToast(`Added "${t.title}" to deadlines!`);
        });
      });
    } catch (err: any) {
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill error">
            <span>Extraction error: ${escapeHtml(err.message || 'Unknown error')}</span>
          </div>
        `;
      }
    } finally {
      if (btnRun) (btnRun as HTMLButtonElement).disabled = false;
      if (btnIcon) btnIcon.innerHTML = `<svg class="ui-icon mr-1"><use href="#icon-bolt"></use></svg>`;
      if (btnText) btnText.textContent = 'Extract Deadlines';
    }
  });
}
