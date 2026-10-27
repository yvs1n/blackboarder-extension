/**
 * The calendar subscription link, the same in the extension and the phone app. The server reads
 * `show` (deadlines, classes or both) and `tz` (the student's time zone, for class times);
 * a link without `show` shows deadlines, as every link made before 1.3.0 did.
 */
export type CalendarFeedShow = 'deadlines' | 'classes' | 'both';

export const CALENDAR_FEED_CHOICES: { value: CalendarFeedShow; label: string }[] = [
  { value: 'both', label: 'Deadlines and classes' },
  { value: 'deadlines', label: 'Deadlines only' },
  { value: 'classes', label: 'Class schedule only' }
];

export function cleanCalendarFeedShow(value: unknown): CalendarFeedShow {
  return value === 'deadlines' || value === 'classes' || value === 'both' ? value : 'both';
}

/** The device's IANA time zone, or '' when the browser does not say. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/** https or webcal link to the feed at `origin` (for example https://blackboarder.pages.dev). */
export function calendarFeedUrl(
  origin: string,
  syncKey: string,
  show: CalendarFeedShow,
  options: { webcal?: boolean; timeZone?: string } = {}
): string {
  const params = new URLSearchParams();
  if (syncKey) params.set('key', syncKey);
  if (show !== 'deadlines') params.set('show', show);
  const tz = options.timeZone ?? deviceTimeZone();
  if (show !== 'deadlines' && tz) params.set('tz', tz);
  const base = String(origin || '').replace(/\/+$/, '');
  const url = `${base}/feed.ics${params.toString() ? `?${params}` : ''}`;
  return options.webcal ? url.replace(/^https?:/, 'webcal:') : url;
}
