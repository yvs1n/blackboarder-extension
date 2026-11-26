import { BUILD_INFO } from '../../buildInfo';
import { resolveCourseInfo } from '../../core/courseHelper';
import {
  countCompletedInSyllabusComponent,
  extractReferencedAssessmentNumbers,
  isBonusTaskText,
  isCompletedExtensionOrRangeTask,
  isExtensionOrMissedWorkTask,
  isMakeupSupersededByCompletedOriginal,
  isMakeupTask,
  isUneditedExtraPastSyllabusQuota,
  resolveMakeupTarget,
  resolveMatchedSyllabusComponent,
  sameCourseNormalized
} from '../../core/makeupFilter';
import { resolveSingletonSyllabusKey } from '../../core/syllabusWeights';
import { explainTaskDecision } from '../../rulebook';
import type { DeadlineTask, PaymentItem, UserCourseConfig } from '../../types';
import { IS_DEV_BUILD, IS_STORE_BUILD } from '../../utils/extension/storeBuild';
import { getLocalTombstones, getStorageTombstones } from '../../utils/storage/tombstones';
import { escapeHtml } from '../../utils/ui/uiCommon';
import { popupActions, popupState } from './state';

export const DEV_DEBUG_STORAGE_KEY = 'bbs_dev_debug_enabled';

export interface DebugReportContext {
  tasks: DeadlineTask[];
  courses: UserCourseConfig[];
  payments: PaymentItem[];
  tombstones: Record<string, string>;
  activeView: string;
  selectedDateStr: string;
  editingTaskId?: string | null;
}

function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-or-v1-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]+/g, '$1...[REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1...[REDACTED]')
    .replace(/("syncKey"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/("apiKey"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2');
}

function describeElementSelector(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = Array.from(el.classList)
    .filter(c => !c.startsWith('bbs-debug-'))
    .slice(0, 4)
    .map(c => `.${c}`)
    .join('');
  return `${tag}${id}${cls}`;
}

function resolveTargetTaskId(target: HTMLElement, editingTaskId?: string | null): string | null {
  const withData = target.closest<HTMLElement>('[data-task-id], [data-id]');
  if (withData) {
    const tid = withData.dataset.taskId || withData.dataset.id;
    if (tid && !withData.hasAttribute('data-payment-id') && !withData.classList.contains('payment-card')) {
      return tid;
    }
  }
  const readingSheet = target.closest<HTMLElement>('#modal-reading-sheet');
  if (readingSheet) {
    const nested = readingSheet.querySelector<HTMLElement>('[data-task-id], [data-id]');
    const nestedId = nested?.dataset.taskId || nested?.dataset.id;
    if (nestedId) return nestedId;
  }
  if (target.closest('#modal-edit-task')) {
    const editInput = document.getElementById('edit-task-id') as HTMLInputElement | null;
    if (editInput?.value) return editInput.value;
    if (editingTaskId) return editingTaskId;
  }
  return null;
}

export function buildElementDebugReport(target: HTMLElement, ctx: DebugReportContext): string {
  const channel = IS_DEV_BUILD ? 'DEV (dist-dev)' : IS_STORE_BUILD ? 'STORE (dist-store)' : 'UNPACKED (dist)';
  const chain: string[] = [];
  let cur: HTMLElement | null = target;
  for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
    chain.push(describeElementSelector(cur));
    cur = cur.parentElement;
  }

  const dataAttrs: Record<string, string> = {};
  const attrSource = target.closest<HTMLElement>('[data-id], [data-task-id], [data-course-id], [data-date]') || target;
  for (const [k, v] of Object.entries(attrSource.dataset || {})) {
    if (v !== undefined) dataAttrs[k] = v;
  }

  const rect = target.getBoundingClientRect();
  const textSample = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);

  const payload: Record<string, unknown> = {
    meta: {
      version: BUILD_INFO.version,
      build: BUILD_INFO.build,
      shortCommit: BUILD_INFO.shortCommit,
      channel,
      activeView: ctx.activeView,
      selectedDate: ctx.selectedDateStr,
      theme: document.documentElement.getAttribute('data-theme') || 'light',
      capturedAt: new Date().toISOString()
    },
    element: {
      clicked: describeElementSelector(target),
      ancestors: chain,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      dataset: dataAttrs,
      textPreview: textSample
    }
  };

  const taskId = resolveTargetTaskId(target, ctx.editingTaskId);
  const task = taskId ? ctx.tasks.find(t => t.id === taskId) : undefined;
  if (task) {
    const matchedComp = resolveMatchedSyllabusComponent(task);
    const completedInComp = matchedComp
      ? countCompletedInSyllabusComponent(matchedComp, task, ctx.tasks, task.id)
      : null;
    const resolvedCourse = resolveCourseInfo(task);
    const courseConfig = ctx.courses.find(
      c =>
        c.courseName.toLowerCase() === resolvedCourse.courseName.toLowerCase() ||
        (c.courseCode && resolvedCourse.courseCode && c.courseCode.toLowerCase() === resolvedCourse.courseCode.toLowerCase())
    );
    const siblingTasks = ctx.tasks
      .filter(t => t.id !== task.id && sameCourseNormalized(task, t))
      .map(t => ({
        id: t.id,
        title: t.title,
        type: t.type,
        dueDate: t.dueDate,
        status: t.status,
        submissionStatus: t.submissionStatus,
        score: t.score,
        maxScore: t.maxScore,
        weight: t.weight,
        weightDisplay: t.weightDisplay,
        isBonus: Boolean(t.isBonus),
        userEdited: Boolean(t.userEdited),
        extractedBy: t.extractedBy
      }));

    payload.taskDiagnostics = {
      task,
      tombstone: ctx.tombstones[task.id] || null,
      rulebookTrace: explainTaskDecision(task, ctx.tasks),
      engineFlags: {
        resolvedCourse,
        singletonSyllabusKey: resolveSingletonSyllabusKey(task),
        matchedSyllabusComponent: matchedComp
          ? {
              courseId: matchedComp.courseId,
              id: matchedComp.comp.id,
              name: matchedComp.comp.name,
              totalWeight: matchedComp.comp.totalWeight,
              count: matchedComp.comp.count,
              outOf: matchedComp.comp.outOf,
              maxItems: matchedComp.maxItems,
              completedInComponent: completedInComp
            }
          : null,
        isMakeupTask: isMakeupTask(task),
        makeupTarget: isMakeupTask(task) ? resolveMakeupTarget(task) : null,
        isMakeupSupersededByCompletedOriginal: isMakeupSupersededByCompletedOriginal(task, ctx.tasks),
        isExtensionOrMissedWorkTask: isExtensionOrMissedWorkTask(task),
        referencedAssessmentNumbers: extractReferencedAssessmentNumbers(task.title || ''),
        isCompletedExtensionOrRangeTask: isCompletedExtensionOrRangeTask(task, ctx.tasks),
        isBonusDetected: isBonusTaskText(task),
        isUneditedExtraPastSyllabusQuota: isUneditedExtraPastSyllabusQuota(task, ctx.tasks)
      },
      courseConfig: courseConfig || null,
      siblingCourseTasks: siblingTasks
    };
  } else {
    const courseCard = target.closest<HTMLElement>('[data-course-id]');
    const dayCell = target.closest<HTMLElement>('[data-date]');
    const paymentEl = target.closest<HTMLElement>('[data-payment-id]');
    if (courseCard?.dataset.courseId) {
      const cid = courseCard.dataset.courseId;
      const course = ctx.courses.find(c => c.id === cid) || null;
      payload.courseDiagnostics = {
        courseId: cid,
        course,
        courseTasksCount: course
          ? ctx.tasks.filter(t => resolveCourseInfo(t).courseName.toLowerCase() === course.courseName.toLowerCase()).length
          : 0
      };
    } else if (paymentEl?.dataset.paymentId) {
      const pid = paymentEl.dataset.paymentId;
      payload.paymentDiagnostics = ctx.payments.find(p => p.id === pid) || { paymentId: pid };
    } else if (dayCell?.dataset.date) {
      const dateStr = dayCell.dataset.date;
      payload.dayDiagnostics = {
        date: dateStr,
        tasksOnDay: ctx.tasks
          .filter(t => (t.dueDate || '').slice(0, 10) === dateStr)
          .map(t => ({ id: t.id, courseName: t.courseName, title: t.title, type: t.type, status: t.status }))
      };
    } else {
      payload.totals = {
        tasksCount: ctx.tasks.length,
        coursesCount: ctx.courses.length,
        paymentsCount: ctx.payments.length,
        tombstonesCount: Object.keys(ctx.tombstones).length
      };
    }
  }

  return redactSecrets(
    `### Blackboarder Debug Stick Report (v${BUILD_INFO.version} · ${channel})\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
  );
}

export function isDebugModeEnabled(): boolean {
  try {
    const saved = localStorage.getItem(DEV_DEBUG_STORAGE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {}
  return IS_DEV_BUILD;
}

let inspecting = false;
let hoverBox: HTMLElement | null = null;
let hoverLabel: HTMLElement | null = null;
let stickBar: HTMLElement | null = null;
let xrayModal: HTMLElement | null = null;
let latestReportText = '';

function setInspecting(next: boolean): void {
  inspecting = next;
  document.body.classList.toggle('bbs-debug-inspecting', inspecting);
  const btn = document.getElementById('btn-debug-stick');
  if (btn) {
    btn.classList.toggle('is-active', inspecting);
    btn.textContent = inspecting ? 'Inspecting (Esc)' : (IS_DEV_BUILD ? 'DEV · Debug Stick' : 'Debug Stick');
  }
  if (!inspecting && hoverBox) {
    hoverBox.style.display = 'none';
  }
}

function ensureXrayModal(): HTMLElement {
  if (xrayModal) return xrayModal;
  const el = document.createElement('div');
  el.id = 'modal-debug-xray';
  el.className = 'bbs-debug-modal hidden';
  el.innerHTML = `
    <div class="bbs-debug-sheet">
      <div class="bbs-debug-header">
        <span class="bbs-debug-title">DEBUG STICK X-RAY</span>
        <button type="button" id="btn-debug-xray-close" class="bbs-debug-btn" aria-label="Close Debug X-Ray">Close</button>
      </div>
      <pre id="bbs-debug-report-pre" class="bbs-debug-pre"></pre>
      <div class="bbs-debug-actions">
        <button type="button" id="btn-debug-copy" class="bbs-debug-btn bbs-debug-btn-primary">Copy Full Debug Report</button>
        <button type="button" id="btn-debug-repick" class="bbs-debug-btn">Pick Another Element</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    if (e.target === el) el.classList.add('hidden');
  });
  el.querySelector('#btn-debug-xray-close')?.addEventListener('click', () => el.classList.add('hidden'));
  el.querySelector('#btn-debug-repick')?.addEventListener('click', () => {
    el.classList.add('hidden');
    setInspecting(true);
  });
  el.querySelector('#btn-debug-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(latestReportText).then(
      () => popupActions.showToast('Copied debug report: paste it into chat!'),
      () => popupActions.showToast('Could not copy automatically; select text above.')
    );
  });
  xrayModal = el;
  return el;
}

async function openXrayForElement(target: HTMLElement): Promise<void> {
  const tombs = await getStorageTombstones().catch(() => getLocalTombstones());
  latestReportText = buildElementDebugReport(target, {
    tasks: popupState.currentTasks || [],
    courses: popupState.currentUserCourses || [],
    payments: popupState.currentPayments || [],
    tombstones: tombs,
    activeView: popupState.currentActiveView,
    selectedDateStr: popupState.selectedDateStr,
    editingTaskId: popupState.editingTaskId
  });
  const modal = ensureXrayModal();
  const pre = modal.querySelector('#bbs-debug-report-pre');
  if (pre) pre.innerHTML = escapeHtml(latestReportText);
  modal.classList.remove('hidden');
}

function renderStickVisibility(): void {
  const enabled = isDebugModeEnabled();
  if (!enabled) {
    setInspecting(false);
    if (stickBar) stickBar.style.display = 'none';
    return;
  }
  if (!stickBar) {
    stickBar = document.createElement('div');
    stickBar.id = 'bbs-debug-stick-bar';
    stickBar.className = 'bbs-debug-stick-bar';
    stickBar.innerHTML = `<button type="button" id="btn-debug-stick" class="bbs-debug-pill" title="Toggle Debug Stick (Alt+Shift+D)">${
      IS_DEV_BUILD ? 'DEV · Debug Stick' : 'Debug Stick'
    }</button>`;
    document.body.appendChild(stickBar);
    stickBar.querySelector('#btn-debug-stick')?.addEventListener('click', e => {
      e.stopPropagation();
      setInspecting(!inspecting);
    });
  }
  stickBar.style.display = 'flex';

  if (!hoverBox) {
    hoverBox = document.createElement('div');
    hoverBox.id = 'bbs-debug-hover-box';
    hoverBox.className = 'bbs-debug-hover-box';
    hoverLabel = document.createElement('span');
    hoverLabel.className = 'bbs-debug-hover-label';
    hoverBox.appendChild(hoverLabel);
    document.body.appendChild(hoverBox);
  }
}

export function initDebugStick(): void {
  renderStickVisibility();

  document.addEventListener(
    'mousemove',
    e => {
      if (!inspecting || !hoverBox || !hoverLabel) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest('#bbs-debug-stick-bar') || target.closest('#modal-debug-xray')) {
        hoverBox.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      hoverBox.style.display = 'block';
      hoverBox.style.left = `${Math.max(0, rect.left)}px`;
      hoverBox.style.top = `${Math.max(0, rect.top)}px`;
      hoverBox.style.width = `${Math.max(4, rect.width)}px`;
      hoverBox.style.height = `${Math.max(4, rect.height)}px`;
      const tid = resolveTargetTaskId(target, popupState.editingTaskId);
      hoverLabel.textContent = tid ? `${describeElementSelector(target)} · [${tid}]` : describeElementSelector(target);
    },
    true
  );

  document.addEventListener(
    'click',
    e => {
      if (!inspecting) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest('#bbs-debug-stick-bar') || target.closest('#modal-debug-xray')) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setInspecting(false);
      void openXrayForElement(target);
    },
    true
  );

  window.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      if (!isDebugModeEnabled()) {
        try { localStorage.setItem(DEV_DEBUG_STORAGE_KEY, '1'); } catch {}
        renderStickVisibility();
        setInspecting(true);
        popupActions.showToast('Debug Stick unlocked: click any element to inspect.');
      } else {
        setInspecting(!inspecting);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (inspecting) {
        e.stopPropagation();
        setInspecting(false);
      } else if (xrayModal && !xrayModal.classList.contains('hidden')) {
        xrayModal.classList.add('hidden');
      }
    }
  });

  // 5 clicks on #ext-version-badge in Settings > Updates toggles Developer Debug Mode on/off in any build
  let versionClicks = 0;
  let versionTimer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById('ext-version-badge')?.addEventListener('click', () => {
    versionClicks++;
    if (versionTimer) clearTimeout(versionTimer);
    versionTimer = setTimeout(() => {
      versionClicks = 0;
    }, 1500);
    if (versionClicks >= 5) {
      versionClicks = 0;
      const next = !isDebugModeEnabled();
      try { localStorage.setItem(DEV_DEBUG_STORAGE_KEY, next ? '1' : '0'); } catch {}
      renderStickVisibility();
      popupActions.showToast(next ? 'Developer Debug Stick enabled' : 'Developer Debug Stick hidden');
    }
  });
}
