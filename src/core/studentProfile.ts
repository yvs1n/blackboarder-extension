import type { StudentProfile } from '../types';
import { DEFAULT_UNIVERSITY_ID, getUniversity, normalizeGradeScale, GradeRow, UniversityPreset, UNIVERSITY_PRESETS } from './universities';

/** A profile read from storage or the cloud, cleaned; null when it is not usable. */
export function sanitizeProfile(raw: unknown): StudentProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.universityId === 'string' ? r.universityId : '';
  if (!UNIVERSITY_PRESETS.some(u => u.id === id)) return null;
  const updatedAt = typeof r.updatedAt === 'string' && !isNaN(Date.parse(r.updatedAt)) ? r.updatedAt : new Date(0).toISOString();
  const profile: StudentProfile = { universityId: id, updatedAt };
  const scale = normalizeGradeScale(r.gradeScale);
  if (scale) profile.gradeScale = scale;
  if (r.source === 'picked' || r.source === 'detected') profile.source = r.source;
  return profile;
}

/** The newer of two profiles (by updatedAt); either may be missing. */
export function newerProfile(a: StudentProfile | null | undefined, b: StudentProfile | null | undefined): StudentProfile | null {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}

/**
 * The university in use. Students who set nothing are treated as UOS students, because every
 * install before university presets existed was at UOS.
 */
export function profileUniversity(profile: StudentProfile | null | undefined): UniversityPreset {
  return getUniversity(profile?.universityId || DEFAULT_UNIVERSITY_ID);
}

/** The grading scale in use: the student's own, else their university's. */
export function profileGradeScale(profile: StudentProfile | null | undefined): GradeRow[] {
  return (profile?.gradeScale && normalizeGradeScale(profile.gradeScale)) || profileUniversity(profile).gradeScale;
}
