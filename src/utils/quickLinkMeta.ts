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

export interface QuickLinkIconDef {
  id: string;
  label: string;
  path: string;
}

/**
 * Curated catalog of 20 clean, academic-focused SVG line icons for quick links.
 * All icons use 24x24 viewBox, stroke-width 2, stroke-linecap round, stroke-linejoin round, and 0px radius.
 */
export const QUICK_LINK_ICONS: Record<string, QuickLinkIconDef> = {
  'globe': {
    id: 'globe',
    label: 'Portal / Web',
    path: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>'
  },
  'book': {
    id: 'book',
    label: 'Study Plan',
    path: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path><path d="M6 6h10M6 10h10"></path>'
  },
  'scale': {
    id: 'scale',
    label: 'Marks / GPA',
    path: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="M7 21h10"></path><path d="M12 3v18"></path><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path>'
  },
  'list-check': {
    id: 'list-check',
    label: 'Attendance',
    path: '<path d="M3.5 5.5L5 7l2.5-2.5m-4 7L5 13l2.5-2.5m-4 7L5 19l2.5-2.5M11 6h9m-9 6h9m-9 6h9"></path>'
  },
  'link': {
    id: 'link',
    label: 'Link / URL',
    path: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>'
  },
  'graduation-cap': {
    id: 'graduation-cap',
    label: 'Graduation / Degree',
    path: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"></path><path d="M22 10v6"></path><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"></path>'
  },
  'laptop': {
    id: 'laptop',
    label: 'Lab / Computing',
    path: '<path d="M20 16V7H4v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>'
  },
  'calendar': {
    id: 'calendar',
    label: 'Calendar / Schedule',
    path: '<path d="M8 2v4m8-4v4M3 10h18"></path><rect width="18" height="18" x="3" y="4"></rect>'
  },
  'clock': {
    id: 'clock',
    label: 'Hours / Timetable',
    path: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
  },
  'timer': {
    id: 'timer',
    label: 'Countdown / Exams',
    path: '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>'
  },
  'message': {
    id: 'message',
    label: 'Discussion / Forum',
    path: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'
  },
  'mail': {
    id: 'mail',
    label: 'Student Email',
    path: '<rect width="20" height="16" x="2" y="4"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>'
  },
  'flask-conical': {
    id: 'flask-conical',
    label: 'Lab / Sciences',
    path: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"></path><path d="M8.5 2h7"></path><path d="M7 16h10"></path>'
  },
  'presentation': {
    id: 'presentation',
    label: 'Lectures / Slides',
    path: '<path d="M2 3h20"></path><path d="M21 3v11H3V3"></path><path d="m7 21 5-5 5 5"></path>'
  },
  'notebook-pen': {
    id: 'notebook-pen',
    label: 'Notes / Homework',
    path: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"></path><path d="M2 6h4m-4 4h4m-4 4h4m-4 4h4"></path><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"></path>'
  },
  'users': {
    id: 'users',
    label: 'Groups / Clubs',
    path: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
  },
  'star': {
    id: 'star',
    label: 'Favorite / Important',
    path: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'
  },
  'award': {
    id: 'award',
    label: 'Honors / Dean\'s List',
    path: '<circle cx="12" cy="8" r="6"></circle><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"></path>'
  },
  'pin': {
    id: 'pin',
    label: 'Campus / Location',
    path: '<path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>'
  },
  'coffee': {
    id: 'coffee',
    label: 'Lounge / Break',
    path: '<path d="M10 2v2m4-2v2"></path><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" x2="14" y1="1" y2="1"></line>'
  }
};

const CATEGORY_PATHS: Record<QuickLinkCategory, string> = {
  attendance: QUICK_LINK_ICONS['list-check'].path,
  study_plan: QUICK_LINK_ICONS['book'].path,
  marks: QUICK_LINK_ICONS['scale'].path,
  portal: QUICK_LINK_ICONS['globe'].path,
  other: QUICK_LINK_ICONS['link'].path
};

export function quickLinkMeta(category: string | undefined, customIcon?: string): { label: string; icon: string; badgeClass: string } {
  const key = (category && category in CATEGORIES ? category : 'other') as QuickLinkCategory;
  const iconName = customIcon && customIcon in QUICK_LINK_ICONS ? `icon-${customIcon}` : CATEGORIES[key].icon;
  return { ...CATEGORIES[key], icon: iconName, badgeClass: `ql-cat-${key}` };
}

/** The quick link icon as inline SVG markup. */
export function quickLinkIconHtml(category: string | undefined, className = 'ql-icon', customIcon?: string): string {
  if (customIcon && customIcon in QUICK_LINK_ICONS) {
    const path = QUICK_LINK_ICONS[customIcon].path;
    return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }
  const key = (category && category in CATEGORY_PATHS ? category : 'other') as QuickLinkCategory;
  const path = CATEGORY_PATHS[key];
  return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function getQuickLinkIconList(): QuickLinkIconDef[] {
  return Object.values(QUICK_LINK_ICONS);
}

/** Pure helper to reorder items in an array without mutating the original. */
export function reorderQuickLinksList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length || fromIndex === toIndex) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
