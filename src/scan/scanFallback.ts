import type { ScanSourceOutcomes } from './blackboardApi';

/**
 * When the HTTP scan is not enough and the Blackboard tab scanner should run instead.
 *
 * - Signed out: no fallback, a tab would show the sign-in page too. The student is asked to sign in.
 * - Blackboard unreachable (users/me failed without saying "signed out"), or both the course list
 *   and the stream failed: the tab scanner runs, since a page can still work when the API does not.
 * - Some courses failed: no fallback; the scan message says how many could not be read.
 */
export type FallbackReason = 'expired' | 'unreachable' | 'no-data';

export interface FallbackDecision {
  fallback: boolean;
  reason: FallbackReason | null;
}

export const SIGN_IN_MESSAGE = 'Sign in to Blackboard first, then click Scan.';
export const UNREACHABLE_MESSAGE = 'Could not reach Blackboard. Check your connection or sign in to Blackboard.';

export function decideFallback(sources: ScanSourceOutcomes): FallbackDecision {
  if (sources.session === 'expired') return { fallback: false, reason: 'expired' };
  if (sources.session === 'unreachable') return { fallback: true, reason: 'unreachable' };
  if (!sources.courses.ok && !sources.stream.ok) return { fallback: true, reason: 'no-data' };
  return { fallback: false, reason: null };
}

/** What could not be read in a scan that otherwise worked, for the end of the scan message ('' when all of it was read). */
export function describePartialFailures(sources: ScanSourceOutcomes | undefined): string {
  if (!sources || sources.session !== 'ok') return '';
  const parts: string[] = [];
  if (!sources.courses.ok) parts.push('Your course list could not be read.');
  if (!sources.stream.ok) parts.push('The activity stream could not be read.');
  const failed = sources.announcements.failed;
  if (failed > 0) parts.push(`${failed} course${failed > 1 ? 's' : ''} could not be read.`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}
