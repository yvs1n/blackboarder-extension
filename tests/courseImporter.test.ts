import { describe, it, expect } from 'vitest';
import {
  convertTo24Hour,
  parseDaysString,
  parseCoursesFromJson,
  parseBannerScheduleText,
  parseSyllabusWeightsText,
  mergeImportedCourses
} from '../src/core/courseImporter';
import { UserCourseConfig } from '../src/types';

describe('Course Importer Engine (courseImporter.ts)', () => {
  describe('convertTo24Hour', () => {
    it('converts 12-hour AM/PM times to 24-hour HH:MM strings', () => {
      expect(convertTo24Hour('11:00 AM')).toBe('11:00');
      expect(convertTo24Hour('1:45 PM')).toBe('13:45');
      expect(convertTo24Hour('12:30 pm')).toBe('12:30');
      expect(convertTo24Hour('12:00 AM')).toBe('00:00');
      expect(convertTo24Hour('12:15 am')).toBe('00:15');
      expect(convertTo24Hour('5:00 pm')).toBe('17:00');
    });

    it('preserves valid 24-hour HH:MM strings', () => {
      expect(convertTo24Hour('14:00')).toBe('14:00');
      expect(convertTo24Hour('09:30')).toBe('09:30');
      expect(convertTo24Hour('17:15')).toBe('17:15');
    });

    it('returns 00:00 for invalid or empty strings', () => {
      expect(convertTo24Hour('')).toBe('00:00');
      expect(convertTo24Hour('invalid')).toBe('00:00');
    });
  });

  describe('parseDaysString', () => {
    it('parses Banner single-letter day codes', () => {
      expect(parseDaysString('TR')).toEqual(['Tuesday', 'Thursday']);
      expect(parseDaysString('MW')).toEqual(['Monday', 'Wednesday']);
      expect(parseDaysString('MWF')).toEqual(['Monday', 'Wednesday', 'Friday']);
      expect(parseDaysString('U')).toEqual(['Sunday']);
      expect(parseDaysString('R')).toEqual(['Thursday']);
      expect(parseDaysString('W')).toEqual(['Wednesday']);
    });

    it('parses natural language words and abbreviations', () => {
      expect(parseDaysString('Tue / Thu')).toEqual(['Tuesday', 'Thursday']);
      expect(parseDaysString('Monday, Wednesday')).toEqual(['Monday', 'Wednesday']);
      expect(parseDaysString('Sunday - Tuesday - Thursday')).toEqual(['Sunday', 'Tuesday', 'Thursday']);
    });

    it('returns empty array for empty or unknown day string', () => {
      expect(parseDaysString('')).toEqual([]);
      expect(parseDaysString('xyz')).toEqual([]);
    });
  });

  describe('parseCoursesFromJson', () => {
    it('parses a valid course array JSON string', () => {
      const json = JSON.stringify([
        {
          id: 'test_course',
          courseCode: '1234 567',
          courseName: 'Test Engineering Course',
          colorHex: '#10b981',
          aliases: ['test eng'],
          scheduleSlots: [
            {
              days: ['Monday', 'Wednesday'],
              startTime: '10:00 AM',
              endTime: '11:15 AM',
              room: 'M1-101'
            }
          ],
          syllabus: [
            {
              id: 'test_midterm',
              name: 'Midterm Exam',
              type: 'exam',
              totalWeight: 30
            }
          ]
        }
      ]);

      const courses = parseCoursesFromJson(json);
      expect(courses.length).toBe(1);
      expect(courses[0].id).toBe('test_course');
      expect(courses[0].courseName).toBe('Test Engineering Course');
      expect(courses[0].scheduleSlots[0].startTime).toBe('10:00');
      expect(courses[0].scheduleSlots[0].endTime).toBe('11:15');
      expect(courses[0].syllabus[0].totalWeight).toBe(30);
    });

    it('parses JSON object with courses key', () => {
      const json = JSON.stringify({
        courses: [
          {
            courseCode: '9999',
            courseName: 'Data Structures'
          }
        ]
      });

      const courses = parseCoursesFromJson(json);
      expect(courses.length).toBe(1);
      expect(courses[0].courseName).toBe('Data Structures');
      expect(courses[0].colorHex).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('throws descriptive error on malformed JSON', () => {
      expect(() => parseCoursesFromJson('not valid json')).toThrow(/Invalid JSON/);
      expect(() => parseCoursesFromJson('[]')).toThrow(/No valid courses array/);
    });
  });

  describe('parseBannerScheduleText', () => {
    it('parses UOS Banner SSB multi-line card view copy-paste', () => {
      const rawText = `
Calculus I for Engineering - 1440 133 - 02
CRN: 10806
Status: **Registered**
Instructors: Randa Al-Teraifi (Primary)
Class 12:30 pm - 1:45 pm | Tue Thu | UOS Men's Campus, A12, 110 | Type: Class

Introduction to Computer Eng. - 1502 101 - 01
CRN: 12056
Status: **Registered**
Instructors: Bilal Arain (Primary)
Class 11:00 am - 12:15 pm | Tue Thu | UOS Men's Campus, A8, 103 | Type: Class
`;

      const courses = parseBannerScheduleText(rawText);
      expect(courses.length).toBe(2);

      const calc = courses.find(c => c.courseName?.includes('Calculus'));
      expect(calc).toBeDefined();
      expect(calc?.crn).toBe('10806');
      expect(calc?.scheduleSlots?.[0].startTime).toBe('12:30');
      expect(calc?.scheduleSlots?.[0].endTime).toBe('13:45');
      expect(calc?.scheduleSlots?.[0].days).toEqual(['Tuesday', 'Thursday']);
      expect(calc?.scheduleSlots?.[0].room).toBe('A12-110');

      const comp = courses.find(c => c.courseName?.includes('Computer'));
      expect(comp).toBeDefined();
      expect(comp?.crn).toBe('12056');
      expect(comp?.scheduleSlots?.[0].room).toBe('A8-103');
    });

    it('parses Banner tabular row copy-paste', () => {
      const tableText = `12056 1502 101 01 Introduction to Computer Eng. 3.00 TR 11:00 AM - 12:15 PM A8-103 Arain, Bilal
10668 1430 115 02 Physics 1 3.00 MW 11:00 AM - 12:15 PM A8-110 Ahriche, Amine`;

      const courses = parseBannerScheduleText(tableText);
      expect(courses.length).toBe(2);

      expect(courses[0].crn).toBe('12056');
      expect(courses[0].courseCode).toBe('1502 101 01');
      expect(courses[0].courseName).toBe('Introduction to Computer Eng.');
      expect(courses[0].scheduleSlots?.[0].days).toEqual(['Tuesday', 'Thursday']);
      expect(courses[0].scheduleSlots?.[0].startTime).toBe('11:00');
      expect(courses[0].scheduleSlots?.[0].endTime).toBe('12:15');
      expect(courses[0].scheduleSlots?.[0].room).toBe('A8-103');

      expect(courses[1].crn).toBe('10668');
      expect(courses[1].courseName).toBe('Physics 1');
      expect(courses[1].scheduleSlots?.[0].days).toEqual(['Monday', 'Wednesday']);
      expect(courses[1].scheduleSlots?.[0].room).toBe('A8-110');
    });
  });

  describe('parseSyllabusWeightsText', () => {
    it('extracts mark allocation lines into CustomSyllabusComponent objects', () => {
      const syllabusText = `
Midterm Exam: 30%
Quizzes (4): 20%
Term Project: 15%
Lab Reports (6): 30%
Final Examination: 40%
Attendance & Participation: 5 marks
`;

      const components = parseSyllabusWeightsText(syllabusText);
      expect(components.length).toBe(6);

      const midterm = components.find(c => c.name.toLowerCase().includes('midterm'));
      expect(midterm).toBeDefined();
      expect(midterm?.type).toBe('exam');
      expect(midterm?.totalWeight).toBe(30);
      expect(midterm?.unitWeight).toBe(30);

      const quizzes = components.find(c => c.name.toLowerCase().includes('quizzes'));
      expect(quizzes).toBeDefined();
      expect(quizzes?.type).toBe('quiz');
      expect(quizzes?.totalWeight).toBe(20);
      expect(quizzes?.count).toBe(4);
      expect(quizzes?.unitWeight).toBe(5);

      const labs = components.find(c => c.name.toLowerCase().includes('lab'));
      expect(labs).toBeDefined();
      expect(labs?.type).toBe('lab');
      expect(labs?.totalWeight).toBe(30);
      expect(labs?.count).toBe(6);
      expect(labs?.unitWeight).toBe(5);

      const part = components.find(c => c.name.toLowerCase().includes('participation'));
      expect(part).toBeDefined();
      expect(part?.type).toBe('other');
      expect(part?.totalWeight).toBe(5);
    });
  });

  describe('mergeImportedCourses', () => {
    it('updates matching course schedule slots without wiping existing fields', () => {
      const existing: UserCourseConfig[] = [
        {
          id: 'compeng',
          courseCode: '1502 101',
          courseName: 'Introduction to Computer Eng.',
          colorHex: '#7c7c7c',
          aliases: ['intro comp'],
          scheduleSlots: [
            {
              days: ['Tuesday', 'Thursday'],
              startTime: '11:00',
              endTime: '12:15',
              room: 'A8-103'
            }
          ],
          syllabus: [
            {
              id: 'c_midterm',
              name: 'Midterm',
              type: 'exam',
              totalWeight: 30
            }
          ]
        }
      ];

      const incoming = [
        {
          courseCode: '1502 101',
          scheduleSlots: [
            {
              days: ['Tuesday', 'Thursday'] as any,
              startTime: '11:30',
              endTime: '12:45',
              room: 'A8-204'
            }
          ]
        }
      ];

      const merged = mergeImportedCourses(existing, incoming);
      expect(merged.length).toBe(1);
      expect(merged[0].scheduleSlots[0].room).toBe('A8-204');
      expect(merged[0].scheduleSlots[0].startTime).toBe('11:30');
      // Syllabus and colorHex preserved!
      expect(merged[0].syllabus.length).toBe(1);
      expect(merged[0].colorHex).toBe('#7c7c7c');
    });

    it('adds new course if no matching code or name found', () => {
      const existing: UserCourseConfig[] = [
        {
          id: 'calc1',
          courseCode: '1440 133',
          courseName: 'Calculus I',
          colorHex: '#dc2626',
          aliases: ['calc'],
          scheduleSlots: [],
          syllabus: []
        }
      ];

      const incoming = [
        {
          courseCode: '1501 201',
          courseName: 'Object Oriented Programming',
          scheduleSlots: [
            {
              days: ['Monday', 'Wednesday'] as any,
              startTime: '09:00',
              endTime: '10:15',
              room: 'W8-105'
            }
          ]
        }
      ];

      const merged = mergeImportedCourses(existing, incoming);
      expect(merged.length).toBe(2);
      expect(merged[1].courseCode).toBe('1501 201');
      expect(merged[1].courseName).toBe('Object Oriented Programming');
      expect(merged[1].scheduleSlots[0].room).toBe('W8-105');
    });
  });
});
