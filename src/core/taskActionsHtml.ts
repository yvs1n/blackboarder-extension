import type { DeadlineTask, UiLanguage } from '../types';
import { localizeActionLabels } from './i18n';

function escapeAttr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface UnifiedActionBarOptions {
  gcalUrl: string;
  isPayment?: boolean;
  portalUrl?: string;
  variant?: 'card' | 'reading';
  svgIconFn?: (name: string, extraClass?: string) => string;
  lang?: UiLanguage;
}

/**
 * Renders one identical horizontal deadline action bar across every view in the extension and
 * the phone companion (Deadlines cards, Day Drawer cards, Reading Sheet, Reading Pane):
 * `[Mark Done / Pending]` | `[Edit]` | `[Share]` | `[Calendar / Portal]` | `[Hide]` | `[Delete]`
 */
export function renderUnifiedTaskActionsHtml(
  task: Partial<DeadlineTask>,
  options: UnifiedActionBarOptions
): string {
  const icon = options.svgIconFn || (() => '');
  const lang: UiLanguage = options.lang === 'ar' ? 'ar' : 'en';
  const lbl = localizeActionLabels(lang);
  const taskId = escapeAttr(task.id || '');
  const isCompleted = task.status === 'completed';
  const isHidden = task.visibility === 'hidden';
  const isPayment = Boolean(options.isPayment || task.isPayment);
  const isReading = options.variant === 'reading';
  const toggleLabel = isHidden ? lbl.restore : (isCompleted ? lbl.pending : (isPayment ? lbl.markPaid : lbl.markDone));
  const toggleTitle = isHidden ? lbl.restoreTitle : (isCompleted ? lbl.pendingTitle : (isPayment ? lbl.markPaidTitle : lbl.markDoneTitle));
  const toggleIcon = icon(isHidden ? 'refresh' : (isCompleted ? 'refresh' : 'check'));
  const toggleClass = isHidden ? 'btn-card-restore' : 'btn-card-toggle';
  const calHref = escapeAttr(isPayment && options.portalUrl ? options.portalUrl : (options.gcalUrl || '#'));
  const calLabel = isPayment && options.portalUrl ? lbl.portal : lbl.calendar;
  const calIcon = icon(isPayment && options.portalUrl ? 'external-link' : 'calendar');
  const calTitle = isPayment && options.portalUrl ? lbl.portalTitle : lbl.calendarTitle;

  return `
    <div class="unified-task-actions${isReading ? ' is-reading' : ''}" data-task-id="${taskId}">
      <button type="button" class="btn-task-act btn-task-act-primary btn-card-action ${toggleClass}${isReading ? ' modal-reading-toggle-btn' : ''}${isCompleted && !isHidden ? ' btn-is-completed' : ''}" data-id="${taskId}" data-task-id="${taskId}" title="${toggleTitle}">
        ${toggleIcon}<span>${toggleLabel}</span>
      </button>
      <button type="button" class="btn-task-act btn-card-action btn-edit-card${isReading ? ' modal-reading-edit-btn' : ''}" data-id="${taskId}" data-task-id="${taskId}" title="${isPayment ? lbl.editPaymentTitle : lbl.editDeadlineTitle}">
        ${icon('pencil')}<span>${lbl.edit}</span>
      </button>
      <button type="button" class="btn-task-act btn-card-action btn-share-card${isReading ? ' modal-reading-share-btn' : ''}" data-id="${taskId}" data-task-id="${taskId}" title="${lbl.shareTitle}">
        ${icon('share')}<span>${lbl.share}</span>
      </button>
      <a href="${calHref}" target="_blank" rel="noopener noreferrer" class="btn-task-act btn-card-action btn-gcal btn-card-gcal${isReading ? ' modal-reading-gcal-btn' : ''}" title="${calTitle}">
        ${calIcon}<span>${calLabel}</span>
      </a>
      ${(!isHidden && !isPayment) ? `
      <button type="button" class="btn-task-act btn-task-act-subtle btn-card-action btn-card-hide${isReading ? ' modal-reading-hide-btn' : ''}" data-id="${taskId}" data-task-id="${taskId}" aria-label="${lbl.hideTitle}" title="${lbl.hideTitle}">
        ${icon('eye-off')}
      </button>
      ` : ''}
      <button type="button" class="btn-task-act btn-task-act-danger btn-card-action btn-card-delete${isReading ? ' modal-reading-delete-btn' : ''}" data-id="${taskId}" data-task-id="${taskId}" aria-label="${isPayment ? lbl.deletePaymentTitle : lbl.deleteDeadlineTitle}" title="${isPayment ? lbl.deletePaymentTitle : lbl.deleteDeadlineTitle}">
        ${icon('trash')}
      </button>
    </div>
  `;
}

export interface SelectedDayActionsOptions {
  isPayment?: boolean;
  svgIconFn?: (name: string, extraClass?: string) => string;
  lang?: UiLanguage;
}

/**
 * Unified compact action buttons for Selected Day calendar rows across Extension and Companion.
 */
export function renderSelectedDayActionsHtml(
  task: Partial<DeadlineTask>,
  options: SelectedDayActionsOptions = {}
): string {
  const icon = options.svgIconFn || (() => '');
  const lbl = localizeActionLabels(options.lang === 'ar' ? 'ar' : 'en');
  const taskId = escapeAttr(task.id || '');
  const isCompleted = task.status === 'completed';
  const isPayment = Boolean(options.isPayment || task.isPayment);

  return `
    <div class="selected-day-actions unified-selected-actions" data-task-id="${taskId}">
      <button type="button" class="btn-sel-action btn-sel-toggle${isCompleted ? ' is-completed' : ''}" title="${isCompleted ? lbl.pendingTitle : (isPayment ? lbl.markPaidTitle : lbl.markDoneTitle)}" data-id="${taskId}" data-task-id="${taskId}">
        ${isCompleted ? icon('check') : icon('circle')}
      </button>
      <button type="button" class="btn-sel-action btn-sel-edit" title="${isPayment ? lbl.editPaymentTitle : lbl.editDeadlineTitle}" data-id="${taskId}" data-task-id="${taskId}">
        ${icon('pencil')}
      </button>
      <button type="button" class="btn-sel-action btn-sel-delete" aria-label="${isPayment ? lbl.deletePaymentTitle : lbl.deleteDeadlineTitle}" title="${isPayment ? lbl.deletePaymentTitle : lbl.deleteDeadlineTitle}" data-id="${taskId}" data-task-id="${taskId}">
        ${icon('trash')}
      </button>
    </div>
  `;
}
