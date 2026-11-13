import type {
  CustomScheduleSlot,
  CustomSyllabusComponent,
  TaskType,
  UserCourseConfig,
  Weekday,
} from '../../types';
import { pushTasksToFirebase } from '../../utils/firebaseSync';
import { compareTasksByTime } from '../../utils/calendar';
import {
  getCoursesUpdatedAt,
  getQuickLinksUpdatedAt,
  getSettings,
  recalculateTasksWithActiveCourses,
  saveUserCourses,
} from '../../utils/storage';
import { isBlackboardSystemNoise } from '../../core/courseHelper';
import { getLocalTombstones } from '../../utils/tombstones';
import { parseSyllabusWeightsText } from '../../core/courseImporter';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import {
  exportCoursesJson,
  handleConfirmBannerImport,
  handleConfirmJsonImport,
  handleImportDocumentFile,
  handlePreviewBanner,
  handleResetCourses,
  openCourseImporter,
  closeCourseImporter,
  switchImporterTab,
} from './courseImporter';
import { popupActions, popupState } from './state';

const ALL_WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function renderUserCoursesManager() {
  const container = document.getElementById('user-courses-list');
  const countPill = document.getElementById('pill-course-count');
  if (!container) return;

  popupState.currentUserCourses = popupState.currentUserCourses.filter(c => {
    const name = (c.courseName || '').trim();
    const code = (c.courseCode || '').trim();
    if (isBlackboardSystemNoise(name) && (!code || isBlackboardSystemNoise(code) || code.toLowerCase() === name.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (countPill) {
    countPill.textContent = `${popupState.currentUserCourses.length} Active`;
  }

  container.innerHTML = '';

  if (popupState.currentUserCourses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); background: var(--surface-hover); border-radius: var(--radius-sm); border: 1px dashed var(--surface-border);">
        <p style="font-size: 12px; margin-bottom: 8px;">No courses configured yet. Click <b>+ Add Course</b> or scan Blackboard to detect your courses automatically.</p>
        <button type="button" class="btn-primary" id="btn-empty-add-course" style="font-size: 11px; padding: 4px 10px;">
          + Add Your First Course
        </button>
      </div>
    `;
    container.querySelector('#btn-empty-add-course')?.addEventListener('click', () => openCourseEditor());
    return;
  }

  popupState.currentUserCourses.forEach(course => {
    const card = document.createElement('div');
    card.className = 'user-course-card';
    card.style.borderLeft = `3px solid ${course.colorHex}`;

    const totalWeight = (course.syllabus || []).reduce((acc, c) => acc + (Number(c.totalWeight) || 0), 0);

    let scheduleHtml = '';
    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      scheduleHtml = course.scheduleSlots.map(slot => {
        const daysDisplay = escapeHtml(slot.days.map(d => String(d).slice(0, 3).toUpperCase()).join('/'));
        const roomDisplay = slot.room ? `Room ${escapeHtml(slot.room)}` : 'Room TBD';
        return `
          <span class="ucc-schedule-badge">
            ${getSvgIcon('calendar', 'mr-1')} <b>${daysDisplay}</b> • ${escapeHtml(slot.startTime)}–${escapeHtml(slot.endTime)} • ${roomDisplay}
          </span>
        `;
      }).join('');
    } else {
      scheduleHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No meeting times scheduled</span>`;
    }

    let syllabusHtml = '';
    if (course.syllabus && course.syllabus.length > 0) {
      syllabusHtml = course.syllabus.map(comp => {
        const unitText = comp.count && comp.count > 1 && comp.unitWeight !== undefined
          ? ` (${comp.count}x ${comp.unitWeight}%)`
          : '';
        return `
          <span class="ucc-syllabus-pill" title="${escapeHtml(comp.note || comp.name)}">
            ${escapeHtml(comp.name)}: <span class="weight-bold">${comp.totalWeight}%</span>${unitText}
          </span>
        `;
      }).join('');
    } else {
      syllabusHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No syllabus breakdown defined</span>`;
    }

    let weightStatusBadge = '';
    if (totalWeight === 100) {
      weightStatusBadge = `<span class="settings-pill pill-green" style="font-size: 10px;">Total Weight: 100%</span>`;
    } else if (totalWeight < 100) {
      weightStatusBadge = `<span class="settings-pill pill-orange" style="font-size: 10px;">Total Weight: ${totalWeight}% (Incomplete)</span>`;
    } else {
      weightStatusBadge = `<span class="settings-pill pill-red" style="font-size: 10px; color: var(--danger);">Total Weight: ${totalWeight}% (Exceeds 100%)</span>`;
    }

    const credits = Number(course.creditHours) > 0 ? Number(course.creditHours) : null;
    const metaParts = [
      course.courseCode ? `<span class="ucc-code">${escapeHtml(course.courseCode)}</span>` : '',
      course.crn ? `<span title="CRN">CRN ${escapeHtml(course.crn)}</span>` : '',
      credits !== null ? `<span>${credits} credit hour${credits === 1 ? '' : 's'}</span>` : '',
    ].filter(Boolean).join('<span aria-hidden="true">·</span>');

    card.innerHTML = `
      <div class="ucc-header">
        <div class="ucc-title-group">
          <span class="ucc-color-dot" style="background-color: ${course.colorHex};"></span>
          <div class="ucc-title-text">
            <span class="ucc-name">${escapeHtml(course.courseName)}</span>
            ${metaParts ? `<span class="ucc-meta">${metaParts}</span>` : ''}
          </div>
        </div>
        <div class="ucc-actions">
          <button type="button" class="ucc-action-btn edit" title="Edit course" aria-label="Edit course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="ucc-action-btn delete" title="Delete course" aria-label="Delete course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
      <div class="ucc-schedule-list">
        ${scheduleHtml}
      </div>
      <div class="ucc-syllabus-section">
        <div class="ucc-syllabus-pills">
          ${syllabusHtml}
        </div>
        <div class="ucc-weight-status">
          <span>Mark breakdown</span>
          ${weightStatusBadge}
        </div>
      </div>
    `;

    card.querySelector('.ucc-action-btn.edit')?.addEventListener('click', () => openCourseEditor(course.id));
    card.querySelector('.ucc-action-btn.delete')?.addEventListener('click', () => handleDeleteCourse(course.id, course.courseName));

    container.appendChild(card);
  });
}

export function openCourseEditor(courseId?: string) {
  const modal = document.getElementById('modal-course-editor');
  if (!modal) return;

  popupState.editingCourseId = courseId || null;
  const titleEl = document.getElementById('course-editor-title');
  const dotEl = document.getElementById('editor-header-dot');
  const codeInput = document.getElementById('editor-course-code') as HTMLInputElement;
  const nameInput = document.getElementById('editor-course-name') as HTMLInputElement;
  const crnInput = document.getElementById('editor-course-crn') as HTMLInputElement;
  const creditsInput = document.getElementById('editor-course-credits') as HTMLInputElement | null;
  const colorPicker = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInput = document.getElementById('editor-color-hex') as HTMLInputElement;
  const aliasesInput = document.getElementById('editor-course-aliases') as HTMLInputElement;
  const slotsContainer = document.getElementById('course-editor-slots');
  const syllabusContainer = document.getElementById('course-editor-syllabus');

  if (slotsContainer) slotsContainer.innerHTML = '';
  if (syllabusContainer) syllabusContainer.innerHTML = '';

  const course = courseId ? popupState.currentUserCourses.find(c => c.id === courseId) : null;

  if (course) {
    if (titleEl) titleEl.textContent = 'Edit Course';
    if (codeInput) codeInput.value = course.courseCode || '';
    if (nameInput) nameInput.value = course.courseName || '';
    if (crnInput) crnInput.value = course.crn || '';
    if (creditsInput) creditsInput.value = course.creditHours ? String(course.creditHours) : '';
    const color = course.colorHex || '#2563eb';
    if (colorPicker) colorPicker.value = color;
    if (colorHexInput) colorHexInput.value = color;
    if (dotEl) dotEl.style.backgroundColor = color;
    if (aliasesInput) aliasesInput.value = (course.aliases || []).join(', ');

    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      course.scheduleSlots.forEach(slot => addScheduleSlotRow(slot));
    } else {
      addScheduleSlotRow();
    }

    if (course.syllabus && course.syllabus.length > 0) {
      course.syllabus.forEach(comp => addSyllabusRow(comp));
    } else {
      addSyllabusRow();
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add Course';
    if (codeInput) codeInput.value = '';
    if (nameInput) nameInput.value = '';
    if (crnInput) crnInput.value = '';
    if (creditsInput) creditsInput.value = '';
    const defaultColor = '#2563eb';
    if (colorPicker) colorPicker.value = defaultColor;
    if (colorHexInput) colorHexInput.value = defaultColor;
    if (dotEl) dotEl.style.backgroundColor = defaultColor;
    if (aliasesInput) aliasesInput.value = '';

    addScheduleSlotRow();
    addSyllabusRow();
  }

  updateEditorTotalWeight();
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

export function closeCourseEditor() {
  const modal = document.getElementById('modal-course-editor');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  popupState.editingCourseId = null;
}

export function addScheduleSlotRow(slot?: Partial<CustomScheduleSlot>) {
  const container = document.getElementById('course-editor-slots');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'slot-editor-row';

  const selectedDays = new Set<string>(
    (slot?.days || ['mon', 'wed']).map(d => String(d).toLowerCase().slice(0, 3))
  );
  const dayPillsHtml = ALL_WEEKDAYS.map(day => {
    const isSelected = selectedDays.has(day);
    const label = day.charAt(0).toUpperCase() + day.slice(1, 3);
    return `<button type="button" class="day-pill-btn ${isSelected ? 'selected' : ''}" data-day="${day}">${label}</button>`;
  }).join('');

  if (slot) {
    row.dataset.extra = JSON.stringify({ location: slot.location, instructor: slot.instructor });
  }

  row.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Meeting Days</span>
      <button type="button" class="ucc-action-btn delete btn-remove-slot" title="Remove slot" style="width: 20px; height: 20px;">✕</button>
    </div>
    <div class="day-pills-row" style="display: flex; gap: 4px; flex-wrap: wrap;">
      ${dayPillsHtml}
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 4px;">
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Start</label>
        <input type="time" class="form-input slot-start-time" value="${escapeHtml(slot?.startTime || '11:00')}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">End</label>
        <input type="time" class="form-input slot-end-time" value="${escapeHtml(slot?.endTime || '12:15')}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Room</label>
        <input type="text" class="form-input slot-room" placeholder="e.g. A8-103" value="${escapeHtml(slot?.room || '')}" style="font-size: 11px; padding: 4px 6px;">
      </div>
    </div>
  `;

  row.querySelectorAll('.day-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
    });
  });

  row.querySelector('.btn-remove-slot')?.addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

export function addSyllabusRow(comp?: Partial<CustomSyllabusComponent>) {
  const container = document.getElementById('course-editor-syllabus');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'syllabus-editor-row';
  if (comp) {
    row.dataset.extra = JSON.stringify({ id: comp.id, note: comp.note, keywords: comp.keywords });
  }

  const compType = comp?.type || 'quiz';
  const totalWeight = comp?.totalWeight !== undefined ? comp.totalWeight : 20;
  const count = comp?.count || '';
  const outOf = comp?.outOf || '';
  const unitWeight = comp?.unitWeight !== undefined ? `${comp.unitWeight}% each` : '';

  row.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center;">
      <input type="text" class="form-input comp-name" placeholder="Component Name (e.g. Quizzes, Midterm)" value="${escapeHtml(comp?.name || '')}" required style="flex: 2; font-size: 11.5px; padding: 4px 6px;">
      <select class="form-select comp-type" style="flex: 1.2; font-size: 11px; padding: 4px 6px;">
        <option value="quiz" ${compType === 'quiz' ? 'selected' : ''}>Quiz</option>
        <option value="exam" ${compType === 'exam' ? 'selected' : ''}>Exam</option>
        <option value="assignment" ${compType === 'assignment' ? 'selected' : ''}>Assignment</option>
        <option value="project" ${compType === 'project' ? 'selected' : ''}>Project</option>
        <option value="lab" ${compType === 'lab' ? 'selected' : ''}>Lab</option>
        <option value="other" ${compType === 'other' ? 'selected' : ''}>Other</option>
      </select>
      <input type="number" min="0" max="100" class="form-input comp-weight" placeholder="Weight %" value="${totalWeight}" required style="width: 60px; font-size: 11.5px; padding: 4px 6px;">
      <input type="number" min="1" max="50" class="form-input comp-count" placeholder="Count" value="${count}" title="Optional number of items that count (e.g. 2 for best 2 of 3)" style="width: 52px; font-size: 11.5px; padding: 4px 6px;">
      <input type="number" min="1" max="50" class="form-input comp-outof" placeholder="Of" value="${outOf}" title="Optional: how many are held when only the best count (e.g. 3 for best 2 of 3)" style="width: 44px; font-size: 11.5px; padding: 4px 6px;">
      <button type="button" class="ucc-action-btn delete btn-remove-syllabus" title="Remove component" style="width: 22px; height: 22px; flex-shrink: 0;">✕</button>
    </div>
    <div class="comp-unit-calc" style="font-size: 10px; color: var(--text-muted); text-align: right; padding-right: 28px;">
      ${unitWeight}
    </div>
  `;

  const weightInput = row.querySelector('.comp-weight') as HTMLInputElement;
  const countInput = row.querySelector('.comp-count') as HTMLInputElement;
  const unitCalcEl = row.querySelector('.comp-unit-calc') as HTMLElement;

  function recalculateUnit() {
    const w = parseFloat(weightInput.value) || 0;
    const c = parseInt(countInput.value, 10) || 0;
    if (c > 1 && w > 0) {
      const u = Math.round((w / c) * 10) / 10;
      const o = parseInt((row.querySelector('.comp-outof') as HTMLInputElement)?.value, 10) || 0;
      unitCalcEl.textContent = o > c ? `best ${c} of ${o}, ${u}% each` : `${c} items x ${u}% each`;
    } else {
      unitCalcEl.textContent = '';
    }
    updateEditorTotalWeight();
  }

  weightInput.addEventListener('input', recalculateUnit);
  countInput.addEventListener('input', recalculateUnit);
  row.querySelector('.comp-outof')?.addEventListener('input', recalculateUnit);

  row.querySelector('.btn-remove-syllabus')?.addEventListener('click', () => {
    row.remove();
    updateEditorTotalWeight();
  });

  container.appendChild(row);
}

export function updateEditorTotalWeight() {
  const badge = document.getElementById('editor-syllabus-total-badge');
  if (!badge) return;

  const container = document.getElementById('course-editor-syllabus');
  let total = 0;
  if (container) {
    const weightInputs = container.querySelectorAll('.comp-weight') as NodeListOf<HTMLInputElement>;
    weightInputs.forEach(inp => {
      total += parseFloat(inp.value) || 0;
    });
  }

  badge.textContent = `Total: ${total}% / 100%`;
  badge.classList.remove('pill-green', 'pill-blue', 'pill-orange', 'pill-red');
  if (total === 100) {
    badge.classList.add('pill-green');
  } else if (total < 100) {
    badge.classList.add('pill-orange');
  } else {
    badge.classList.add('pill-red');
  }
}

export async function handleSaveCourse(e: Event) {
  e.preventDefault();
  const code = (document.getElementById('editor-course-code') as HTMLInputElement).value.trim();
  const name = (document.getElementById('editor-course-name') as HTMLInputElement).value.trim();
  const crn = (document.getElementById('editor-course-crn') as HTMLInputElement).value.trim();
  const credits = parseFloat((document.getElementById('editor-course-credits') as HTMLInputElement | null)?.value || '');
  const rawHex = (document.getElementById('editor-color-hex') as HTMLInputElement).value.trim();
  const hex = /^#[0-9a-f]{3,8}$/i.test(rawHex) ? rawHex : '#2563eb';
  const aliasesRaw = (document.getElementById('editor-course-aliases') as HTMLInputElement).value;
  const aliases = aliasesRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (!code || !name) {
    alert('Please enter both course code and course name.');
    return;
  }

  const slots: CustomScheduleSlot[] = [];
  const slotRows = document.querySelectorAll('#course-editor-slots .slot-editor-row');
  slotRows.forEach(row => {
    const days: Weekday[] = [];
    row.querySelectorAll('.day-pill-btn.selected').forEach(btn => {
      const d = btn.getAttribute('data-day') as Weekday;
      if (d) days.push(d);
    });
    const startTime = (row.querySelector('.slot-start-time') as HTMLInputElement)?.value || '11:00';
    const endTime = (row.querySelector('.slot-end-time') as HTMLInputElement)?.value || '12:15';
    const room = (row.querySelector('.slot-room') as HTMLInputElement)?.value.trim() || '';

    let extra: { location?: string; instructor?: string } = {};
    try {
      extra = JSON.parse((row as HTMLElement).dataset.extra || '{}') || {};
    } catch {}

    if (days.length > 0) {
      slots.push({
        days,
        startTime,
        endTime,
        room,
        ...(extra.location ? { location: extra.location } : {}),
        ...(extra.instructor ? { instructor: extra.instructor } : {}),
      });
    }
  });

  const syllabus: CustomSyllabusComponent[] = [];
  const syllabusRows = document.querySelectorAll('#course-editor-syllabus .syllabus-editor-row');
  syllabusRows.forEach((row, idx) => {
    const cName = (row.querySelector('.comp-name') as HTMLInputElement)?.value.trim();
    const cType = ((row.querySelector('.comp-type') as HTMLSelectElement)?.value || 'quiz') as TaskType;
    const cWeight = parseFloat((row.querySelector('.comp-weight') as HTMLInputElement)?.value) || 0;
    const cCount = parseInt((row.querySelector('.comp-count') as HTMLInputElement)?.value, 10) || undefined;
    const cOutOf = parseInt((row.querySelector('.comp-outof') as HTMLInputElement)?.value, 10) || undefined;
    const uWeight = (cCount && cCount > 1 && cWeight > 0) ? Math.round((cWeight / cCount) * 10) / 10 : undefined;

    let extra: { id?: string; note?: string; keywords?: string[] } = {};
    try {
      extra = JSON.parse((row as HTMLElement).dataset.extra || '{}') || {};
    } catch {}

    if (cName && cWeight > 0) {
      syllabus.push({
        id: extra.id || `comp_${idx + 1}`,
        name: cName,
        type: cType,
        totalWeight: cWeight,
        count: cCount,
        ...(cCount && cOutOf && cOutOf > cCount ? { outOf: cOutOf } : {}),
        unitWeight: uWeight,
        ...(extra.note ? { note: extra.note } : {}),
        ...(Array.isArray(extra.keywords) && extra.keywords.length > 0 ? { keywords: extra.keywords } : {}),
      });
    }
  });

  const courseId = popupState.editingCourseId || `course_${Date.now()}`;
  const courseConfig: UserCourseConfig = {
    id: courseId,
    courseCode: code,
    courseName: name,
    crn: crn || undefined,
    ...(credits > 0 ? { creditHours: credits } : {}),
    colorHex: hex,
    aliases,
    scheduleSlots: slots,
    syllabus,
  };

  const nextCourses = popupState.editingCourseId
    ? popupState.currentUserCourses.map(c => c.id === popupState.editingCourseId ? courseConfig : c)
    : [...popupState.currentUserCourses, courseConfig];

  await handleCoursesUpdated(nextCourses);
  closeCourseEditor();
  popupActions.showToast(`Saved course "${name}"`);
}

export async function handleDeleteCourse(courseId: string, courseName: string) {
  if (!confirm(`Are you sure you want to delete "${courseName}"? Existing deadlines will remain but will no longer match this course schedule.`)) {
    return;
  }
  const nextCourses = popupState.currentUserCourses.filter(c => c.id !== courseId);
  await handleCoursesUpdated(nextCourses);
  popupActions.showToast(`Deleted "${courseName}"`);
}

export async function handleCoursesUpdated(courses: UserCourseConfig[]) {
  popupState.currentUserCourses = courses;
  await saveUserCourses(courses);
  popupState.currentTasks = await recalculateTasksWithActiveCourses();
  popupState.currentTasks.sort(compareTasksByTime);

  renderUserCoursesManager();
  popupActions.renderLegend();
  popupActions.updateCourseFilterOptions(popupState.currentTasks);
  popupActions.refreshAllViews();

  const settings = await getSettings();
  const tombstones = await getLocalTombstones();
  const coursesUpdatedAt = await getCoursesUpdatedAt();
  pushTasksToFirebase(
    popupState.currentTasks,
    'Course Configuration Update',
    settings.syncKey,
    popupState.currentQuickLinks,
    tombstones,
    courses,
    coursesUpdatedAt || undefined,
    (await getQuickLinksUpdatedAt()) || undefined
  ).catch(() => {});
}

export function setupCourseEvents() {
  document.getElementById('btn-add-course')?.addEventListener('click', () => openCourseEditor());
  document.getElementById('btn-import-courses')?.addEventListener('click', () => void openCourseImporter());
  document.getElementById('btn-export-courses')?.addEventListener('click', exportCoursesJson);
  document.getElementById('btn-reset-courses')?.addEventListener('click', () => void handleResetCourses());

  document.getElementById('btn-close-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('btn-cancel-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('modal-course-editor')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-editor')) closeCourseEditor();
  });
  document.getElementById('form-course-editor')?.addEventListener('submit', e => void handleSaveCourse(e));
  document.getElementById('btn-add-schedule-slot')?.addEventListener('click', () => addScheduleSlotRow());
  document.getElementById('btn-add-syllabus-row')?.addEventListener('click', () => addSyllabusRow());

  document.getElementById('btn-parse-syllabus-paste')?.addEventListener('click', () => {
    const textarea = document.getElementById('editor-syllabus-paste-text') as HTMLTextAreaElement;
    if (!textarea || !textarea.value.trim()) return;
    const comps = parseSyllabusWeightsText(textarea.value);
    if (comps.length > 0) {
      const container = document.getElementById('course-editor-syllabus');
      if (container) container.innerHTML = '';
      comps.forEach(c => addSyllabusRow(c));
      updateEditorTotalWeight();
      popupActions.showToast(`Parsed ${comps.length} grading components!`);
    } else {
      popupActions.showToast('Could not detect syllabus weights from text.');
    }
  });

  const colorPickerEl = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInputEl = document.getElementById('editor-color-hex') as HTMLInputElement;
  colorPickerEl?.addEventListener('input', () => {
    if (colorHexInputEl) colorHexInputEl.value = colorPickerEl.value;
    const dotEl = document.getElementById('editor-header-dot');
    if (dotEl) dotEl.style.backgroundColor = colorPickerEl.value;
  });
  colorHexInputEl?.addEventListener('input', () => {
    if (/^#([A-Fa-f0-9]{6})$/.test(colorHexInputEl.value)) {
      if (colorPickerEl) colorPickerEl.value = colorHexInputEl.value;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = colorHexInputEl.value;
    }
  });
  document.querySelectorAll('#editor-color-swatches .swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color') || '#2563eb';
      if (colorPickerEl) colorPickerEl.value = color;
      if (colorHexInputEl) colorHexInputEl.value = color;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = color;
    });
  });

  document.getElementById('btn-close-course-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('btn-cancel-banner-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('modal-course-import')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-import')) closeCourseImporter();
  });
  document.getElementById('tab-import-banner')?.addEventListener('click', () => switchImporterTab('banner'));
  document.getElementById('tab-import-json')?.addEventListener('click', () => switchImporterTab('json'));
  document.getElementById('btn-preview-banner')?.addEventListener('click', () => void handlePreviewBanner());
  document.getElementById('input-import-document')?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void handleImportDocumentFile(file);
  });
  document.getElementById('btn-confirm-banner-import')?.addEventListener('click', () => void handleConfirmBannerImport());
  document.getElementById('btn-confirm-json-import')?.addEventListener('click', () => void handleConfirmJsonImport());
  document.getElementById('input-import-json-file')?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = evt => {
        const content = evt.target?.result as string;
        const textarea = document.getElementById('import-json-text') as HTMLTextAreaElement;
        if (textarea && content) textarea.value = content;
      };
      reader.readAsText(file);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const editorModal = document.getElementById('modal-course-editor');
      if (editorModal && editorModal.style.display !== 'none' && !editorModal.classList.contains('hidden')) {
        closeCourseEditor();
      }
      const importModal = document.getElementById('modal-course-import');
      if (importModal && importModal.style.display !== 'none' && !importModal.classList.contains('hidden')) {
        closeCourseImporter();
      }
    }
  });
}
