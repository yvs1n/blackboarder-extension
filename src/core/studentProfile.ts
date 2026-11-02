import type { StudentProfile } from '../types';
import { DEFAULT_UNIVERSITY_ID, getUniversity, normalizeGradeScale, GradeRow, UniversityPreset, UNIVERSITY_PRESETS } from './universities';
import { isGenericPlaceholderName } from '../scan/blackboardApi';

/** A profile read from storage or the cloud, cleaned; null when it is not usable. */
export function sanitizeProfile(raw: unknown): StudentProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.universityId === 'string' ? r.universityId : '';
  if (!UNIVERSITY_PRESETS.some(u => u.id === id)) return null;
  const updatedAt = typeof r.updatedAt === 'string' && !isNaN(Date.parse(r.updatedAt)) ? r.updatedAt : new Date(0).toISOString();
  const profile: StudentProfile = { universityId: id, updatedAt };
  if (typeof r.studentName === 'string' && r.studentName.trim() && !isGenericPlaceholderName(r.studentName.trim())) {
    profile.studentName = r.studentName.trim();
  }
  if (typeof r.studentId === 'string' && r.studentId.trim()) profile.studentId = r.studentId.trim();
  if (typeof r.studentEmail === 'string' && r.studentEmail.trim()) profile.studentEmail = r.studentEmail.trim();
  if (typeof r.major === 'string' && r.major.trim()) profile.major = r.major.trim();
  if (typeof r.college === 'string' && r.college.trim()) profile.college = r.college.trim();
  const scale = normalizeGradeScale(r.gradeScale);
  if (scale) profile.gradeScale = scale;
  if (r.source === 'picked' || r.source === 'detected') profile.source = r.source;
  if (typeof r.priorCredits === 'number' && !isNaN(r.priorCredits) && r.priorCredits >= 0 && r.priorCredits <= 300) {
    profile.priorCredits = Math.round(r.priorCredits * 10) / 10;
  }
  if (typeof r.priorGpa === 'number' && !isNaN(r.priorGpa) && r.priorGpa >= 0 && r.priorGpa <= 5.0) {
    profile.priorGpa = Math.round(r.priorGpa * 100) / 100;
  }
  if (typeof r.targetCredits === 'number' && !isNaN(r.targetCredits) && r.targetCredits > 0 && r.targetCredits <= 300) {
    profile.targetCredits = Math.round(r.targetCredits);
  }
  if (typeof r.targetTermGpa === 'number' && !isNaN(r.targetTermGpa) && r.targetTermGpa >= 0 && r.targetTermGpa <= 5.0) {
    profile.targetTermGpa = Math.round(r.targetTermGpa * 100) / 100;
  }
  if (typeof r.targetCgpa === 'number' && !isNaN(r.targetCgpa) && r.targetCgpa >= 0 && r.targetCgpa <= 5.0) {
    profile.targetCgpa = Math.round(r.targetCgpa * 100) / 100;
  }
  if (r.targetGpaMode === 'cgpa' || r.targetGpaMode === 'term') {
    profile.targetGpaMode = r.targetGpaMode;
  }
  if (typeof r.currentSemesterName === 'string' && r.currentSemesterName.trim()) {
    profile.currentSemesterName = r.currentSemesterName.trim().slice(0, 50);
  }
  return profile;
}

/** The newer of two profiles (by updatedAt); merges student identity fields so they are never lost. */
export function newerProfile(a: StudentProfile | null | undefined, b: StudentProfile | null | undefined): StudentProfile | null {
  if (!a) return b || null;
  if (!b) return a;
  const newer = Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
  const older = newer === b ? a : b;
  const chooseName = (n?: string, o?: string) => {
    if (n && !isGenericPlaceholderName(n)) return n;
    if (o && !isGenericPlaceholderName(o)) return o;
    return n || o;
  };
  return {
    ...newer,
    studentName: chooseName(newer.studentName, older.studentName),
    studentId: newer.studentId || older.studentId,
    studentEmail: newer.studentEmail || older.studentEmail,
    major: newer.major || older.major,
    college: newer.college || older.college,
    priorCredits: newer.priorCredits !== undefined ? newer.priorCredits : older.priorCredits,
    priorGpa: newer.priorGpa !== undefined ? newer.priorGpa : older.priorGpa,
    targetCredits: newer.targetCredits !== undefined ? newer.targetCredits : older.targetCredits,
    targetTermGpa: newer.targetTermGpa !== undefined ? newer.targetTermGpa : older.targetTermGpa,
    targetCgpa: newer.targetCgpa !== undefined ? newer.targetCgpa : older.targetCgpa,
    targetGpaMode: newer.targetGpaMode || older.targetGpaMode,
    currentSemesterName: newer.currentSemesterName || older.currentSemesterName
  };
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
