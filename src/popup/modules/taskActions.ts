import type { DeadlineTask } from '../../types';
import { createGoogleCalendarUrl } from '../../utils/calendar';
import { getSvgIcon } from '../../utils/uiCommon';
import { recordLocalTombstone, removeLocalTombstone } from '../../utils/tombstones';
import { buildStructuredDeadlineSummary, renderDeadlineSummaryBlockHtml } from '../../core/deadlineSummary';
import { renderUnifiedTaskActionsHtml, renderSelectedDayActionsHtml } from '../../core/taskActionsHtml';
import { resolveTaskWeight } from '../../core/syllabusWeights';
import { promptCompletionScoreIfNeeded } from './marksView';
import { popupActions, popupState } from './state';

export function renderSummaryAndNotesForExt(
  task: DeadlineTask,
  options: {
    variant?: 'card' | 'reading';
    countdownLabel?: string;
    includeFullViewBtn?: boolean;
    includeCopyBtn?: boolean;
    copyBtnId?: string;
  } = {}
): string {
  return renderDeadlineSummaryBlockHtml(task, {
    ...options,
    isPayment: Boolean(task.isPayment),
    lang: popupState.currentLanguage,
    svgIconFn: getSvgIcon
  });
}

export function renderUnifiedActionsForExt(
  task: DeadlineTask,
  options: { variant?: 'card' | 'reading'; portalUrl?: string } = {}
): string {
  const gcalUrl = createGoogleCalendarUrl(task);
  return renderUnifiedTaskActionsHtml(task, {
    gcalUrl,
    isPayment: Boolean(task.isPayment),
    portalUrl: options.portalUrl,
    variant: options.variant,
    lang: popupState.currentLanguage,
    svgIconFn: getSvgIcon
  });
}

export function renderSelectedDayActionsForExt(task: DeadlineTask): string {
  return renderSelectedDayActionsHtml(task, {
    isPayment: Boolean(task.isPayment),
    lang: popupState.currentLanguage,
    svgIconFn: getSvgIcon
  });
}

export function toggleExtensionTaskStatus(taskId: string, onAfter?: () => void): void {
  const current = popupState.currentTasks.find(t => t.id === taskId);
  if (!current) {
    if (taskId.startsWith('pay_') && typeof popupActions.togglePaymentPaid === 'function') {
      void popupActions.togglePaymentPaid(taskId.slice(4));
      if (onAfter) onAfter();
    }
    return;
  }
  if (current.isPayment && current.paymentId) {
    void popupActions.togglePaymentPaid(current.paymentId);
    if (onAfter) onAfter();
    return;
  }

  const prevStatus = current.status;
  const prevCompletedAt = current.completedAt;
  const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
  const newCompletedAt = newStatus === 'completed' ? new Date().toISOString() : undefined;

  const extraUpdates: Partial<DeadlineTask> = {};
  if (current.weight === undefined && !current.userEdited && current.extractedBy !== 'manual') {
    const wInfo = resolveTaskWeight(
      current.courseName || current.courseCode,
      current.title,
      current.type,
      current.sourceSnippet || current.description || current.notes || ''
    );
    if (wInfo.weight !== undefined) {
      extraUpdates.weight = wInfo.weight;
      extraUpdates.weightDisplay = wInfo.weightDisplay;
      extraUpdates.syllabusNote = wInfo.syllabusNote;
    }
  }

  let latest = popupActions.applyTaskUpdateLocal(taskId, {
    status: newStatus,
    completedAt: newCompletedAt,
    ...extraUpdates
  });
  popupActions.refreshAllViews();
  popupActions.syncTasksToCloud(latest, `Toggle status ${taskId}`);
  if (onAfter) onAfter();

  if (newStatus === 'completed') {
    const refreshed = latest.find(t => t.id === taskId);
    if (refreshed) promptCompletionScoreIfNeeded(refreshed);
  }

  popupActions.showToast(
    newStatus === 'completed' ? 'Marked as completed!' : 'Reverted to pending',
    'Undo',
    () => {
      latest = popupActions.applyTaskUpdateLocal(taskId, {
        status: prevStatus,
        completedAt: prevCompletedAt
      });
      popupActions.refreshAllViews();
      popupActions.syncTasksToCloud(latest, `Undo status ${taskId}`);
      popupActions.showToast('Status restored');
    }
  );
}

export function deleteExtensionTaskWithUndo(taskId: string, onAfter?: () => void): void {
  const existing = popupState.currentTasks.find(t => t.id === taskId);
  if (!existing) {
    const payId = taskId.startsWith('pay_') ? taskId.slice(4) : '';
    if (payId && typeof popupActions.deletePaymentItem === 'function') {
      void popupActions.deletePaymentItem(payId);
      if (onAfter) onAfter();
    }
    return;
  }
  if (existing.isPayment && existing.paymentId && typeof popupActions.deletePaymentItem === 'function') {
    void popupActions.deletePaymentItem(existing.paymentId);
    if (onAfter) onAfter();
    return;
  }

  const taskBackup = { ...existing };
  recordLocalTombstone(taskId);
  const afterDelete = popupActions.removeTaskLocal(taskId);
  popupActions.refreshAllViews();
  popupActions.syncTasksToCloud(afterDelete, `Delete task ${taskId}`);
  if (onAfter) onAfter();

  popupActions.showToast(
    `Deleted "${taskBackup.title}"`,
    'Undo',
    () => {
      removeLocalTombstone(taskId);
      popupState.currentTasks = [...popupState.currentTasks.filter(t => t.id !== taskId), taskBackup];
      popupActions.persistTasksInBackground(popupState.currentTasks);
      popupActions.refreshAllViews();
      popupActions.syncTasksToCloud(popupState.currentTasks, `Restore task ${taskId}`);
      popupActions.showToast('Deadline restored');
    }
  );
}

export function hideExtensionTaskWithUndo(taskId: string, onAfter?: () => void): void {
  const existing = popupState.currentTasks.find(t => t.id === taskId);
  if (!existing || existing.isPayment) return;

  const prevSnapshot = {
    visibility: existing.visibility,
    hiddenReason: existing.hiddenReason,
    hiddenReasonLabel: existing.hiddenReasonLabel,
    visibilityLocked: existing.visibilityLocked,
    ignoreMark: existing.ignoreMark
  };

  let latest = popupActions.applyTaskUpdateLocal(taskId, {
    visibility: 'hidden',
    visibilityLocked: 'hidden',
    hiddenReason: 'manual_hide',
    hiddenReasonLabel: 'Hidden by you',
    ignoreMark: true
  });
  popupActions.refreshAllViews();
  popupActions.syncTasksToCloud(latest, `Hide task ${taskId}`);
  if (onAfter) onAfter();

  popupActions.showToast(
    `Moved "${existing.title}" to Hidden`,
    'Undo',
    () => {
      latest = popupActions.applyTaskUpdateLocal(taskId, {
        visibility: prevSnapshot.visibility,
        hiddenReason: prevSnapshot.hiddenReason,
        hiddenReasonLabel: prevSnapshot.hiddenReasonLabel,
        visibilityLocked: prevSnapshot.visibilityLocked,
        ignoreMark: prevSnapshot.ignoreMark
      });
      popupActions.refreshAllViews();
      popupActions.syncTasksToCloud(latest, `Undo hide ${taskId}`);
      popupActions.showToast('Deadline restored');
    }
  );
}

export function wireUnifiedTaskActions(
  rootEl: HTMLElement,
  task: DeadlineTask,
  callbacks: {
    onAfterToggle?: () => void;
    onAfterDelete?: () => void;
    onBeforeEdit?: () => void;
    onInspect?: () => void;
  } = {}
): void {
  // Prevent <details> clicks inside cards from triggering parent card clicks
  rootEl.querySelectorAll('.prof-notes-dropdown, .prof-notes-summary').forEach(el => {
    el.addEventListener('click', e => e.stopPropagation());
  });

  rootEl.querySelector('.btn-inspect-quote, .prof-notes-inspect-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (callbacks.onInspect) callbacks.onInspect();
    else popupActions.openReadingSheet(task);
  });

  rootEl.querySelector('.prof-notes-copy-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    const sum = buildStructuredDeadlineSummary(task, { isPayment: Boolean(task.isPayment), lang: popupState.currentLanguage });
    if (!sum.rawNotes) return;
    try {
      await navigator.clipboard.writeText(sum.rawNotes);
      popupActions.showToast('Professor notes copied to clipboard!');
    } catch {
      popupActions.showToast('Could not copy notes.');
    }
  });

  rootEl.querySelector('.btn-card-toggle')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleExtensionTaskStatus(task.id, callbacks.onAfterToggle);
  });

  rootEl.querySelector('.btn-card-restore')?.addEventListener('click', e => {
    e.stopPropagation();
    const latest = popupActions.applyTaskUpdateLocal(task.id, {
      visibility: undefined,
      hiddenReason: undefined,
      hiddenReasonLabel: undefined,
      visibilityLocked: 'active',
      ignoreMark: false
    });
    popupActions.refreshAllViews();
    popupActions.syncTasksToCloud(latest, `Restore hidden deadline ${task.id}`);
    popupActions.showToast(`Restored "${task.title}" to your deadlines`);
    if (callbacks.onAfterToggle) callbacks.onAfterToggle();
  });

  rootEl.querySelector('.btn-edit-card')?.addEventListener('click', e => {
    e.stopPropagation();
    if (callbacks.onBeforeEdit) callbacks.onBeforeEdit();
    if (task.isPayment && task.paymentId) {
      const existingPay = popupState.currentPayments.find(p => p.id === task.paymentId);
      if (existingPay) popupActions.openPaymentModal(existingPay);
      return;
    }
    popupActions.openEditModal(task);
  });

  rootEl.querySelector('.btn-share-card')?.addEventListener('click', e => {
    e.stopPropagation();
    void popupActions.shareTask(task);
  });

  rootEl.querySelector('.btn-card-gcal')?.addEventListener('click', e => {
    e.stopPropagation();
  });

  rootEl.querySelector('.btn-card-hide')?.addEventListener('click', e => {
    e.stopPropagation();
    hideExtensionTaskWithUndo(task.id, callbacks.onAfterToggle);
  });

  rootEl.querySelector('.btn-card-delete')?.addEventListener('click', e => {
    e.stopPropagation();
    deleteExtensionTaskWithUndo(task.id, callbacks.onAfterDelete);
  });
}
