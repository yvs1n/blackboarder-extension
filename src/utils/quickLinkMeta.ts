import type { QuickLinkCategory } from '../types';

/**
 * How each Quick Link category looks in the extension and the phone app: a label and a line icon
 * (an SVG symbol both pages define). No emojis and no category colours, per the design system.
 */
const CATEGORIES: Record<QuickLinkCategory, { label: string; icon: string }> = {
  attendance: { label: 'Attendance', icon: 'icon-list-check' },
  study_plan: { label: 'Study Plan', icon: 'icon-book' },
  marks: { label: 'Marks', icon: 'icon-scale' },
  portal: { label: 'Portal', icon: 'icon-globe' },
  other: { label: 'Link', icon: 'icon-link' }
};

export function quickLinkMeta(category: string | undefined): { label: string; icon: string; badgeClass: string } {
  const key = (category && category in CATEGORIES ? category : 'other') as QuickLinkCategory;
  return { ...CATEGORIES[key], badgeClass: `ql-cat-${key}` };
}

/** The category icon as inline SVG markup. */
export function quickLinkIconHtml(category: string | undefined, className = 'ql-icon'): string {
  return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="#${quickLinkMeta(category).icon}"></use></svg>`;
}
