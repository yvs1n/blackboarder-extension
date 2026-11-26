import type { UiLanguage, UserSettings } from '../types';

export type ThemePreference = 'light' | 'dark' | 'system';
export type CalendarFeedShowPreference = 'deadlines' | 'classes' | 'both';

/**
 * Settings shared across the Browser Extension and Mobile Companion through
 * the encrypted Firebase cloud vault. Device-specific keys/toggles (API keys,
 * AI pass, auto-scan, Blackboard dark mode, browser icon badge, web push)
 * remain strictly local to each device.
 */
export interface SharedPreferences {
  language?: UiLanguage;
  theme?: ThemePreference;
  showClassesInCalendar?: boolean;
  showPaymentsInCalendar?: boolean;
  calendarFeedShow?: CalendarFeedShowPreference;
  reminderHoursBefore?: number;
  classReminderMinutes?: number;
  updatedAt?: string;
}

const VALID_LANGS: UiLanguage[] = ['en', 'ar'];
const VALID_THEMES: ThemePreference[] = ['light', 'dark', 'system'];
const VALID_CAL_SHOW: CalendarFeedShowPreference[] = ['deadlines', 'classes', 'both'];

export const SHARED_SETTING_KEYS: readonly (keyof UserSettings)[] = [
  'language',
  'theme',
  'showClassesInCalendar',
  'showPaymentsInCalendar',
  'reminderHoursBefore',
  'classReminderMinutes',
];

export function sanitizeSharedPreferences(raw: unknown): SharedPreferences | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: SharedPreferences = {};
  let hasField = false;

  if (typeof r.language === 'string' && VALID_LANGS.includes(r.language as UiLanguage)) {
    out.language = r.language as UiLanguage;
    hasField = true;
  }
  if (typeof r.theme === 'string' && VALID_THEMES.includes(r.theme as ThemePreference)) {
    out.theme = r.theme as ThemePreference;
    hasField = true;
  }
  if (typeof r.showClassesInCalendar === 'boolean') {
    out.showClassesInCalendar = r.showClassesInCalendar;
    hasField = true;
  }
  if (typeof r.showPaymentsInCalendar === 'boolean') {
    out.showPaymentsInCalendar = r.showPaymentsInCalendar;
    hasField = true;
  }
  if (typeof r.calendarFeedShow === 'string' && VALID_CAL_SHOW.includes(r.calendarFeedShow as CalendarFeedShowPreference)) {
    out.calendarFeedShow = r.calendarFeedShow as CalendarFeedShowPreference;
    hasField = true;
  }
  if (typeof r.reminderHoursBefore === 'number' && Number.isFinite(r.reminderHoursBefore) && r.reminderHoursBefore >= 0 && r.reminderHoursBefore <= 168) {
    out.reminderHoursBefore = r.reminderHoursBefore;
    hasField = true;
  }
  if (typeof r.classReminderMinutes === 'number' && Number.isFinite(r.classReminderMinutes) && r.classReminderMinutes >= 0 && r.classReminderMinutes <= 180) {
    out.classReminderMinutes = r.classReminderMinutes;
    hasField = true;
  }

  if (!hasField) return undefined;
  if (typeof r.updatedAt === 'string' && !isNaN(Date.parse(r.updatedAt))) {
    out.updatedAt = r.updatedAt;
  }
  return out;
}

const prefTime = (p?: SharedPreferences | null): number => {
  if (!p?.updatedAt) return 0;
  const t = Date.parse(p.updatedAt);
  return isNaN(t) ? 0 : t;
};

/**
 * Picks the newer SharedPreferences object by `updatedAt`, preserving any fields
 * missing on the winning side when the older side defined them.
 */
export function pickNewerSharedPreferences(
  localRaw: unknown,
  cloudRaw: unknown,
  preferLocalOnTie = false
): { preferences?: SharedPreferences; fromCloud: boolean } {
  const local = sanitizeSharedPreferences(localRaw);
  const cloud = sanitizeSharedPreferences(cloudRaw);
  if (!cloud && !local) return { preferences: undefined, fromCloud: false };
  if (!cloud) return { preferences: local, fromCloud: false };
  if (!local) return { preferences: cloud, fromCloud: true };

  const lt = prefTime(local);
  const ct = prefTime(cloud);
  if (ct > lt) {
    return { preferences: { ...local, ...cloud }, fromCloud: true };
  }
  if (lt > ct) {
    return { preferences: { ...cloud, ...local }, fromCloud: false };
  }
  const merged = preferLocalOnTie ? { ...cloud, ...local } : { ...local, ...cloud };
  return { preferences: merged, fromCloud: !preferLocalOnTie };
}

export function extractSharedPreferencesFromSettings(
  settings: Partial<UserSettings> | undefined,
  calendarFeedShow?: string | null,
  updatedAt?: string | null
): SharedPreferences {
  const s = settings || {};
  const feedShow = VALID_CAL_SHOW.includes(calendarFeedShow as CalendarFeedShowPreference)
    ? (calendarFeedShow as CalendarFeedShowPreference)
    : undefined;
  return {
    language: s.language === 'ar' ? 'ar' : 'en',
    theme: VALID_THEMES.includes(s.theme as ThemePreference) ? (s.theme as ThemePreference) : 'system',
    showClassesInCalendar: s.showClassesInCalendar !== false,
    showPaymentsInCalendar: s.showPaymentsInCalendar !== false,
    ...(feedShow ? { calendarFeedShow: feedShow } : {}),
    reminderHoursBefore: typeof s.reminderHoursBefore === 'number' && Number.isFinite(s.reminderHoursBefore) ? s.reminderHoursBefore : 24,
    classReminderMinutes: typeof s.classReminderMinutes === 'number' && Number.isFinite(s.classReminderMinutes) ? s.classReminderMinutes : 15,
    ...(updatedAt ? { updatedAt } : {})
  };
}

export function sharedPreferencesToSettingsPatch(prefs: SharedPreferences): Partial<UserSettings> {
  const patch: Partial<UserSettings> = {};
  if (prefs.language) patch.language = prefs.language;
  if (prefs.theme) patch.theme = prefs.theme;
  if (typeof prefs.showClassesInCalendar === 'boolean') patch.showClassesInCalendar = prefs.showClassesInCalendar;
  if (typeof prefs.showPaymentsInCalendar === 'boolean') patch.showPaymentsInCalendar = prefs.showPaymentsInCalendar;
  if (typeof prefs.reminderHoursBefore === 'number') patch.reminderHoursBefore = prefs.reminderHoursBefore;
  if (typeof prefs.classReminderMinutes === 'number') patch.classReminderMinutes = prefs.classReminderMinutes;
  return patch;
}
