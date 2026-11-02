import type { TaskType } from '../types';

/**
 * Escapes HTML characters to prevent XSS vulnerabilities in dynamically injected markup.
 */
export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates an SVG icon markup referencing the global symbol sprite sheet.
 */
export function getSvgIcon(name: string, extraClass: string = ''): string {
  const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
  return `<svg class="${cls}"><use href="#icon-${name}"></use></svg>`;
}

/**
 * Returns the corresponding SVG icon for a task type.
 */
export function getTaskTypeIcon(type: TaskType | string = '', extraClass: string = ''): string {
  switch ((type || '').toLowerCase()) {
    case 'quiz': return getSvgIcon('timer', extraClass);
    case 'assignment': return getSvgIcon('notebook-pen', extraClass);
    case 'exam': return getSvgIcon('list-check', extraClass);
    case 'project': return getSvgIcon('presentation', extraClass);
    case 'lab': return getSvgIcon('flask-conical', extraClass);
    case 'meeting': return getSvgIcon('users', extraClass);
    default: return getSvgIcon('pin', extraClass);
  }
}

/**
 * Formats a 24-hour time (hour, minute) into standard 12-hour AM/PM format (e.g. "08:30 AM", "01:15 PM").
 */
export function format12Hour(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const padH = String(h12).padStart(2, '0');
  const padM = String(minute).padStart(2, '0');
  return `${padH}:${padM} ${period}`;
}
