import { describe, it, expect } from 'vitest';
import {
  UNIVERSITY_PRESETS, getUniversity, findUniversityByHost, normalizeGradeScale, describeGradeScale, swapUniversityQuickLinks
} from '../src/core/universities';
import { sanitizeProfile, newerProfile, profileUniversity, profileGradeScale } from '../src/core/studentProfile';
import { normalizeBlackboardOrigin, isBuiltInBlackboardHost } from '../src/utils/blackboardSites';
import { buildGpaSummary, gradeForPercent, UOS_GRADE_SCALE } from '../src/utils/gpa';
import { buildMarksSummary } from '../src/utils/marks';
import { gradesHtml } from '../src/utils/grades';

describe('university presets', () => {
  it('every scale runs from the top letter down to a 0% row, highest first', () => {
    for (const u of UNIVERSITY_PRESETS) {
      const mins = u.gradeScale.map(g => g.min);
      expect([...mins].sort((a, b) => b - a)).toEqual(mins);
      expect(mins[mins.length - 1]).toBe(0);
      expect(u.gradeScale[0].points).toBe(4);
    }
  });

  it('keeps the UOS scale identical to the one the GPA used before presets', () => {
    expect(getUniversity('uos').gradeScale).toEqual(UOS_GRADE_SCALE);
  });

  it('matches the published tables', () => {
    const zu = getUniversity('zu').gradeScale;
    expect(zu.find(g => g.letter === 'A-')).toEqual({ letter: 'A-', min: 87, points: 3.7 });
    expect(zu.find(g => g.letter === 'D+')).toEqual({ letter: 'D+', min: 64, points: 1.3 });
    expect(getUniversity('uaeu').gradeScale.find(g => g.letter === 'B+')).toEqual({ letter: 'B+', min: 85, points: 3.5 });
    expect(getUniversity('aus').gradeScale.some(g => g.letter === 'D+')).toBe(false);
    expect(getUniversity('aus').lowestPass).toBe('C-');
  });

  it('finds the university from its Blackboard address', () => {
    expect(findUniversityByHost('elearning.sharjah.ac.ae')?.id).toBe('uos');
    expect(findUniversityByHost('lms.uaeu.ac.ae')?.id).toBe('uaeu');
    expect(findUniversityByHost('ilearn.aus.edu')?.id).toBe('aus');
    // aus.edu must not match aud.edu, and a lookalike domain must not match
    expect(findUniversityByHost('blackboard.aud.edu')?.id).toBe('aud');
    expect(findUniversityByHost('notsharjah.ac.ae')).toBeNull();
    expect(findUniversityByHost('example.blackboard.com')).toBeNull();
  });

  it('falls back to the generic preset for an unknown id', () => {
    expect(getUniversity('nope').id).toBe('other');
  });
});

describe('grading scale editing', () => {
  it('cleans and sorts a scale and always ends at 0', () => {
    const s = normalizeGradeScale([
      { letter: 'B', min: 80, points: 3 },
      { letter: 'A', min: 90, points: 4 },
      { letter: '', min: 50, points: 1 },
      { letter: 'Z', min: 150, points: 9 }
    ]);
    expect(s).toEqual([
      { letter: 'A', min: 90, points: 4 },
      { letter: 'B', min: 80, points: 3 },
      { letter: 'F', min: 0, points: 0 }
    ]);
    expect(normalizeGradeScale('nope')).toBeNull();
    expect(normalizeGradeScale([])).toBeNull();
  });

  it('describes a scale for the GPA card', () => {
    expect(describeGradeScale(getUniversity('uos').gradeScale)).toBe('A 90+ · B+ 85+ · B 80+ · C+ 75+ · C 70+ · D+ 65+ · D 60+ · F below 60');
  });

  it('grades with the chosen scale', () => {
    const zu = getUniversity('zu').gradeScale;
    expect(gradeForPercent(88, zu)).toEqual({ letter: 'A-', points: 3.7 });
    expect(gradeForPercent(88)).toEqual({ letter: 'B+', points: 3.5 });
  });

  it('builds the GPA with the chosen scale and names it on the card', () => {
    const syllabi = [{ courseName: 'Physics', courseCodePattern: /physics/i, creditHours: 3, components: [] }];
    const task: any = { id: 't', title: 'Quiz 1', type: 'quiz', courseName: 'Physics', weight: 10, submissionStatus: 'graded', score: 88, maxScore: 100 };
    const zu = getUniversity('zu').gradeScale;
    const s = buildGpaSummary([task], syllabi, zu);
    expect(s.courses[0].letter).toBe('A-');
    expect(s.gpa).toBe(3.7);
    const marks = buildMarksSummary([task], syllabi);
    const html = gradesHtml(s, marks, () => '#000', { name: 'ZU', scale: zu, fromSyllabus: false });
    expect(html).toContain('ZU scale: A 90+ · A- 87+');
    expect(html).toContain('A- = 3.7 of 4.0 GPA points');
    expect(gradesHtml(s, marks, () => '#000', { name: 'AUD', scale: zu, fromSyllabus: true })).toContain('Instructors set the percentages');
  });
});

describe('student profile', () => {
  it('treats a student with no profile as UOS', () => {
    expect(profileUniversity(null).id).toBe('uos');
    expect(profileGradeScale(null)).toEqual(UOS_GRADE_SCALE);
  });

  it('uses the student own scale over the university one', () => {
    const p = sanitizeProfile({ universityId: 'zu', gradeScale: [{ letter: 'A', min: 95, points: 4 }], updatedAt: '2026-10-01T00:00:00Z' })!;
    expect(profileGradeScale(p)).toEqual([{ letter: 'A', min: 95, points: 4 }, { letter: 'F', min: 0, points: 0 }]);
  });

  it('drops unknown universities and bad data', () => {
    expect(sanitizeProfile({ universityId: 'hackers', updatedAt: '2026-10-01T00:00:00Z' })).toBeNull();
    expect(sanitizeProfile('x')).toBeNull();
    expect(sanitizeProfile({ universityId: 'aus', updatedAt: 'garbage' })?.updatedAt).toBe(new Date(0).toISOString());
  });

  it('keeps the newer of two copies', () => {
    const a = sanitizeProfile({ universityId: 'uos', updatedAt: '2026-10-01T00:00:00Z' });
    const b = sanitizeProfile({ universityId: 'zu', updatedAt: '2026-10-02T00:00:00Z' });
    expect(newerProfile(a, b)?.universityId).toBe('zu');
    expect(newerProfile(b, a)?.universityId).toBe('zu');
    expect(newerProfile(null, a)?.universityId).toBe('uos');
  });
});

describe('quick links when switching university', () => {
  const make = (p: any) => ({ ...p, createdAt: 'now' });
  it('removes untouched UOS links and keeps the student ones', () => {
    const links = [
      ...getUniversity('uos').quickLinks!.map(make),
      { id: 'mine', title: 'My link', url: 'https://example.com', category: 'other', createdAt: 'x' }
    ];
    links[0] = { ...links[0], title: 'Edited attendance' };
    const out = swapUniversityQuickLinks(links, 'uos', 'zu', make);
    expect(out.map(l => l.id)).toEqual(['ql-attendance', 'mine']);
  });

  it('adds the UOS links back when switching to UOS', () => {
    const out = swapUniversityQuickLinks([], 'zu', 'uos', make);
    expect(out).toHaveLength(4);
  });
});

describe('Blackboard addresses', () => {
  it('turns what a student types into an origin', () => {
    expect(normalizeBlackboardOrigin('lms.example.edu/ultra/course')).toBe('https://lms.example.edu');
    expect(normalizeBlackboardOrigin('https://LMS.Example.edu/')).toBe('https://lms.example.edu');
    expect(normalizeBlackboardOrigin('http://lms.example.edu')).toBeNull();
    expect(normalizeBlackboardOrigin('localhost')).toBeNull();
    expect(normalizeBlackboardOrigin('10.0.0.1')).toBeNull();
    expect(normalizeBlackboardOrigin('')).toBeNull();
  });

  it('knows which addresses already work', () => {
    expect(isBuiltInBlackboardHost('elearning.sharjah.ac.ae')).toBe(true);
    expect(isBuiltInBlackboardHost('zu.blackboard.com')).toBe(true);
    expect(isBuiltInBlackboardHost('ilearn.aus.edu')).toBe(false);
  });
});
