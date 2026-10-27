import { describe, it, expect } from 'vitest';
import {
  analyzeCourseDocument, daysInText, timeRangeIn, roomIn, courseCodesIn, assessmentFromLine,
  sanitizeCourseDrafts, matchExistingCourse, applyCourseImport
} from '../src/core/courseDocument';

// Made-up documents in the shapes real ones come in
const US_SCHEDULE = `Student Schedule - Fall 2026
CRN	Course	Title	Days	Time	Location	Instructor
41022	CSC 201-01	Data Structures	MW	9:30 AM - 10:45 AM	SCI 105	Made, Up
41388	MTH 210-02	Linear Algebra	TR	1:00 PM - 2:15 PM	MATH 2106	Sample, Person
41501	ENG 102-05	Academic Writing	F	11:00 AM - 11:50 AM	HUM 120	Test, Name`;

const BANNER = `Calculus I for Engineering - 1440133 - 02
CRN: 10806
Instructors: Made Up (Primary)
Class 12:30 pm - 1:45 pm | Tue Thu | UOS Men's Campus, A12, 110 | Type: Class
Introduction to Computer Engineering - 1502101 - 01
CRN: 12056
Class 11:00 am - 12:15 pm | Mon Wed | UOS Men's Campus, A8, 103 | Type: Class`;

const BY_DAY = `Weekly Timetable
Sunday
08:00 - 09:15 PHY 101 General Physics Room B12-205
11:00 - 12:15 CHE 105 Chemistry Room B10-101
Tuesday
08:00 - 09:15 PHY 101 General Physics Room B12-205
Wednesday
14:00 - 16:45 PHY 101L Physics Lab Room LAB-3`;

const SYLLABUS = `Course Syllabus
Course Code: CSC 201
Course Title: Data Structures and Algorithms
Credit Hours: 3
Instructor: Dr. Made Up    Email: made.up@example.edu
Office Hours: Sun, Tue 1:00 - 2:00 PM, Office B5-201
Lectures: Sunday and Tuesday 11:00 - 12:15, Room A8-103

Attendance Policy
Students who miss more than 25% of classes will receive a warning.

Assessment
Quizzes (best 3 of 4)	15%
Assignments 4 x 5%
Midterm Exam	25%
Project	20%
Final Exam	20%
Total	100%

Grading Scale
A 90-100
B+ 85-89
B 80-84`;

describe('reading parts of a document', () => {
  it('finds days written every way', () => {
    expect(daysInText('Sun/Tue')).toEqual(['Sunday', 'Tuesday']);
    expect(daysInText('MW')).toEqual(['Monday', 'Wednesday']);
    expect(daysInText('TR 1:00 PM')).toEqual(['Tuesday', 'Thursday']);
    expect(daysInText('Monday, Wednesday and Friday')).toEqual(['Monday', 'Wednesday', 'Friday']);
    expect(daysInText('Days: M W')).toEqual(['Monday', 'Wednesday']);
    expect(daysInText('TTh')).toEqual(['Tuesday', 'Thursday']);
    expect(daysInText('الأحد والثلاثاء')).toEqual(['Sunday', 'Tuesday']);
    // Not days
    expect(daysInText('the students sat the exam')).toEqual([]);
    expect(daysInText('A W')).toEqual([]);
  });

  it('reads class times and ignores numbers that are not times', () => {
    expect(timeRangeIn('11:00 - 12:15')).toMatchObject({ start: '11:00', end: '12:15' });
    expect(timeRangeIn('1:00 PM - 2:15 PM')).toMatchObject({ start: '13:00', end: '14:15' });
    expect(timeRangeIn('11:00 am - 12:15 pm')).toMatchObject({ start: '11:00', end: '12:15' });
    expect(timeRangeIn('2-3:15 PM')).toMatchObject({ start: '14:00', end: '15:15' });
    expect(timeRangeIn('1:00 - 2:15')).toMatchObject({ start: '13:00', end: '14:15' });
    expect(timeRangeIn('9.30 to 10.45')).toMatchObject({ start: '09:30', end: '10:45' });
    expect(timeRangeIn('14:00-16:45')).toMatchObject({ start: '14:00', end: '16:45' });
    expect(timeRangeIn('Week 3-4')).toBeNull();
    expect(timeRangeIn('Quizzes 10-20%')).toBeNull();
    expect(timeRangeIn('pages 10-200')).toBeNull();
    expect(timeRangeIn('10.11 - 12.11')).toBeNull();
  });

  it('finds rooms and course codes', () => {
    expect(roomIn('Lectures in Room A8-103')).toBe('A8-103');
    expect(roomIn('Room: 2106')).toBe('2106');
    expect(roomIn('Class at M5 - 105 today')).toBe('M5-105');
    expect(courseCodesIn('CSC 201-01 and MTH210').map(c => c.code)).toEqual(['CSC 201', 'MTH 210']);
    expect(courseCodesIn('Room 2106, ISBN 9781, Fall 2026').map(c => c.code)).toEqual([]);
    expect(courseCodesIn('1440133 and 1502 101', true).map(c => c.code)).toEqual(['1440133', '1502101']);
  });

  it('reads one assessment line', () => {
    expect(assessmentFromLine('Midterm Exam 30%', true, 0)).toMatchObject({ name: 'Midterm Exam', totalWeight: 30, type: 'exam' });
    expect(assessmentFromLine('Quizzes (4) 20%', true, 0)).toMatchObject({ name: 'Quizzes', totalWeight: 20, count: 4, unitWeight: 5, type: 'quiz' });
    expect(assessmentFromLine('Labs 6 x 5%', true, 0)).toMatchObject({ name: 'Labs', totalWeight: 30, count: 6 });
    expect(assessmentFromLine('Quizzes 20% (5% each)', true, 0)).toMatchObject({ totalWeight: 20 });
    expect(assessmentFromLine('Homework\t15', true, 0)).toMatchObject({ name: 'Homework', totalWeight: 15 });
    expect(assessmentFromLine('Homework\t15', false, 0)).toBeNull();
    expect(assessmentFromLine('Students who miss more than 25% of classes will fail', true, 0)).toBeNull();
    expect(assessmentFromLine('A 90-100%', true, 0)).toBeNull();
    expect(assessmentFromLine('Total 100%', true, 0)).toBeNull();
  });
});

describe('reading a class schedule', () => {
  it('reads a registration table from any university', () => {
    const r = analyzeCourseDocument(US_SCHEDULE);
    expect(r.kind).toBe('schedule');
    expect(r.courses.map(c => c.courseCode)).toEqual(['CSC 201', 'MTH 210', 'ENG 102']);
    expect(r.courses[0]).toMatchObject({ courseName: 'Data Structures' });
    expect(r.courses[0].scheduleSlots[0]).toMatchObject({ days: ['Monday', 'Wednesday'], startTime: '09:30', endTime: '10:45', room: 'SCI 105' });
    expect(r.courses[1].scheduleSlots[0]).toMatchObject({ days: ['Tuesday', 'Thursday'], startTime: '13:00', endTime: '14:15' });
  });

  it('reads UOS Banner text', () => {
    const r = analyzeCourseDocument(BANNER);
    expect(r.kind).toBe('schedule');
    expect(r.courses.map(c => c.courseCode)).toEqual(['1440133', '1502101']);
    expect(r.courses[0]).toMatchObject({ crn: '10806' });
    expect(r.courses[0].scheduleSlots[0]).toMatchObject({ days: ['Tuesday', 'Thursday'], startTime: '12:30', endTime: '13:45', room: 'A12-110' });
  });

  it('reads a timetable laid out day by day and joins the same class on two days', () => {
    const r = analyzeCourseDocument(BY_DAY);
    expect(r.kind).toBe('schedule');
    const phy = r.courses.find(c => c.courseCode === 'PHY 101')!;
    expect(phy.courseName).toBe('General Physics');
    expect(phy.scheduleSlots).toEqual([{ days: ['Sunday', 'Tuesday'], startTime: '08:00', endTime: '09:15', room: 'B12-205', location: 'B12-205' }]);
    expect(r.courses.find(c => c.courseCode === 'PHY 101L')?.scheduleSlots[0]).toMatchObject({ days: ['Wednesday'], startTime: '14:00', endTime: '16:45' });
  });
});

describe('reading a syllabus', () => {
  it('finds the course, credits, instructor, class times and weights, and skips office hours and policies', () => {
    const r = analyzeCourseDocument(SYLLABUS);
    expect(r.kind).toBe('syllabus');
    const c = r.courses[0];
    expect(c).toMatchObject({ courseCode: 'CSC 201', courseName: 'Data Structures and Algorithms', creditHours: 3, instructor: 'Dr. Made Up' });
    expect(c.scheduleSlots).toEqual([{ days: ['Sunday', 'Tuesday'], startTime: '11:00', endTime: '12:15', room: 'A8-103', location: 'A8-103', instructor: 'Dr. Made Up' }]);
    expect(c.syllabus.map(s => [s.name, s.totalWeight])).toEqual([
      ['Quizzes', 15], ['Assignments', 20], ['Midterm Exam', 25], ['Project', 20], ['Final Exam', 20]
    ]);
    expect(c.syllabus[0]).toMatchObject({ count: 3, outOf: 4, unitWeight: 5 });
    expect(c.syllabus[1]).toMatchObject({ count: 4, unitWeight: 5 });
  });

  it('reads Arabic digits and a weights table without % signs', () => {
    const r = analyzeCourseDocument(`MTH 112 Calculus II
عدد الساعات المعتمدة: ٣
Grade Distribution (%)
Quizzes\t١٠
Midterm\t٣٠
Final\t٤٠
Homework\t٢٠`);
    expect(r.kind).toBe('syllabus');
    expect(r.courses[0]).toMatchObject({ courseCode: 'MTH 112', courseName: 'Calculus II', creditHours: 3 });
    expect(r.courses[0].syllabus.map(s => s.totalWeight)).toEqual([10, 30, 40, 20]);
  });

  it('finds nothing in a document that is neither', () => {
    expect(analyzeCourseDocument('Dear students, the library opens at 9.').kind).toBe('none');
    expect(analyzeCourseDocument('')).toEqual({ kind: 'none', courses: [] });
  });
});

describe('AI answers and saving', () => {
  const existing: any[] = [
    { id: 'csc201', courseCode: 'CSC201', courseName: 'Data Structures', colorHex: '#123456', aliases: ['ds'], creditHours: 4,
      scheduleSlots: [{ days: ['Monday'], startTime: '08:00', endTime: '09:00', room: 'OLD' }], syllabus: [] }
  ];

  it('cleans what an AI returns', () => {
    const drafts = sanitizeCourseDrafts({ courses: [
      { courseCode: 'CSC 201', courseName: 'Data Structures', creditHours: 3, instructor: 'Dr. Made Up',
        meetings: [{ days: ['Sunday', 'Tuesday'], start: '11:00', end: '12:15', room: 'A8-103' }, { days: [], start: 'x', end: 'y' }],
        assessments: [{ name: 'Midterm', weight: 30 }, { name: 'Bad', weight: 300 }, { name: 'Quizzes', weight: 20, count: 4 }] },
      { nothing: true },
      'junk'
    ] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].scheduleSlots).toEqual([{ days: ['Sunday', 'Tuesday'], startTime: '11:00', endTime: '12:15', room: 'A8-103', location: 'A8-103', instructor: 'Dr. Made Up' }]);
    expect(drafts[0].syllabus.map(s => s.name)).toEqual(['Midterm', 'Quizzes']);
    expect(drafts[0].syllabus[1]).toMatchObject({ count: 4, unitWeight: 5 });
    expect(sanitizeCourseDrafts('nope')).toEqual([]);
  });

  it('matches a found course to one the student has', () => {
    expect(matchExistingCourse({ courseCode: 'CSC 201', courseName: '', scheduleSlots: [], syllabus: [] }, existing)?.id).toBe('csc201');
    expect(matchExistingCourse({ courseCode: '', courseName: 'Data Structures and Algorithms', scheduleSlots: [], syllabus: [] }, existing)?.id).toBe('csc201');
    expect(matchExistingCourse({ courseCode: 'MTH 210', courseName: 'Linear Algebra', scheduleSlots: [], syllabus: [] }, existing)).toBeNull();
  });

  it('saves into the chosen course, keeping its name and colour, and adds new ones', () => {
    const r = analyzeCourseDocument(SYLLABUS);
    const saved = applyCourseImport(existing, [
      { draft: r.courses[0], targetId: 'csc201' },
      { draft: { courseCode: 'MTH 210', courseName: 'Linear Algebra', creditHours: 3, scheduleSlots: [], syllabus: [] }, targetId: 'new' }
    ]);
    expect(saved).toHaveLength(2);
    const csc = saved.find(c => c.id === 'csc201')!;
    expect(csc.courseName).toBe('Data Structures');
    expect(csc.colorHex).toBe('#123456');
    expect(csc.creditHours).toBe(3);
    expect(csc.scheduleSlots[0].room).toBe('A8-103');
    expect(csc.syllabus).toHaveLength(5);
    expect(csc.aliases).toContain('data structures and algorithms');
    expect(saved[1]).toMatchObject({ courseCode: 'MTH 210', courseName: 'Linear Algebra', creditHours: 3 });
    // The list the student had is not changed in place
    expect(existing[0].scheduleSlots[0].room).toBe('OLD');
  });
});
