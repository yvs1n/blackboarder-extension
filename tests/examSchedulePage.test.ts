import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  parseExamTime,
  parseExamDateTime,
  normalizeExamTypeTitle,
  resolveExamRoom,
  extractExamScheduleRowsFromDoc,
  scrapeExamScheduleFromDoc,
  extractExamScheduleRowsFromHtml,
  scrapeExamScheduleFromHtml,
  isExamSchedulePage,
  mergeExamScheduleTasks
} from '../src/core/examSchedule';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';
import type { DeadlineTask } from '../src/types';

const BANNER_STUDENT_EXAM_HTML = `
<!DOCTYPE html>
<html>
<head><title>Student Exam Page</title></head>
<body>
  <h1>Student Exam Page</h1>
  <table>
    <tr>
      <th>Student ID</th>
      <th>Student Name</th>
      <th>College</th>
      <th>Major</th>
      <th>Campus</th>
      <th>Registration Term</th>
    </tr>
    <tr>
      <td>U00000000</td>
      <td>Test Student</td>
      <td>Engineering</td>
      <td>Computer Engineering</td>
      <td>UOS Men's Campus</td>
      <td>Fall 2026/2027</td>
    </tr>
  </table>

  <table>
    <thead>
      <tr>
        <th>CRN</th>
        <th>Course Number</th>
        <th>Course Title</th>
        <th>Exam Date</th>
        <th>From / Time</th>
        <th>To / Time</th>
        <th>Building</th>
        <th>Room</th>
        <th>Exam Type</th>
        <th>Exam Method</th>
        <th>Comment</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>10475</td>
        <td>0104100</td>
        <td>Islamic Culture</td>
        <td>10/10/2026</td>
        <td>08:30AM</td>
        <td>09:30AM</td>
        <td>A12</td>
        <td>TH007-008</td>
        <td>MIDTERM</td>
        <td>Paper_Based</td>
        <td>C12 TH005</td>
      </tr>
      <tr>
        <td>10806</td>
        <td>1440133</td>
        <td>Calculus I for Engineering</td>
        <td>22/10/2026</td>
        <td>14:30PM</td>
        <td>15:30PM</td>
        <td>A12</td>
        <td>110</td>
        <td>MIDTERM</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>12056</td>
        <td>1502101</td>
        <td>Introduction to Computer Eng.</td>
        <td>22/10/2026</td>
        <td>11:00AM</td>
        <td>12:30PM</td>
        <td>A8</td>
        <td>103</td>
        <td>MIDTERM</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>10668</td>
        <td>1430115</td>
        <td>Physics 1</td>
        <td>24/10/2026</td>
        <td>17:00PM</td>
        <td>18:00PM</td>
        <td>A1</td>
        <td>101D-102</td>
        <td>MIDTERM</td>
        <td>Paper_Based</td>
        <td>A10-006</td>
      </tr>
      <tr>
        <td>10175</td>
        <td>0202112</td>
        <td>English for Academic Purposes</td>
        <td>26/10/2026</td>
        <td>17:00PM</td>
        <td>18:30PM</td>
        <td>A10</td>
        <td>MUL007</td>
        <td>MIDTERM</td>
        <td>AKINDI</td>
        <td></td>
      </tr>
      <tr>
        <td>10475</td>
        <td>0104100</td>
        <td>Islamic Culture</td>
        <td>24/11/2026</td>
        <td>10:00AM</td>
        <td>12:00PM</td>
        <td>A8</td>
        <td>TH005</td>
        <td>FINAL</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>10806</td>
        <td>1440133</td>
        <td>Calculus I for Engineering</td>
        <td>06/12/2026</td>
        <td>08:30AM</td>
        <td>10:30AM</td>
        <td>A12</td>
        <td>TH007</td>
        <td>FINAL</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>10668</td>
        <td>1430115</td>
        <td>Physics 1</td>
        <td>08/12/2026</td>
        <td>08:30AM</td>
        <td>10:30AM</td>
        <td>A10</td>
        <td>006</td>
        <td>FINAL</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>10708</td>
        <td>1430116</td>
        <td>Physics 1 Lab</td>
        <td>28/11/2026</td>
        <td>16:00PM</td>
        <td>18:00PM</td>
        <td></td>
        <td>B3-105</td>
        <td>FINAL</td>
        <td></td>
        <td></td>
      </tr>
      <tr>
        <td>10175</td>
        <td>0202112</td>
        <td>English for Academic Purposes</td>
        <td>05/12/2026</td>
        <td>13:30PM</td>
        <td>15:30PM</td>
        <td>A13</td>
        <td>TH006-STU008</td>
        <td>FINAL</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
      <tr>
        <td>12056</td>
        <td>1502101</td>
        <td>Introduction to Computer Eng.</td>
        <td>06/12/2026</td>
        <td>13:30PM</td>
        <td>15:30PM</td>
        <td>A8</td>
        <td>103</td>
        <td>FINAL</td>
        <td>Paper_Based</td>
        <td></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

describe('Banner Student Exam Schedule Page Parser', () => {
  beforeEach(() => {
    setActiveUserCourses(DEFAULT_USER_COURSES);
  });

  it('parses both standard 12-hour times and Banner 24-hour+PM hybrid times', () => {
    expect(parseExamTime('08:30AM')).toEqual({ hour: 8, minute: 30, display: '08:30 AM' });
    expect(parseExamTime('12:30PM')).toEqual({ hour: 12, minute: 30, display: '12:30 PM' });
    expect(parseExamTime('14:30PM')).toEqual({ hour: 14, minute: 30, display: '02:30 PM' });
    expect(parseExamTime('17:00PM')).toEqual({ hour: 17, minute: 0, display: '05:00 PM' });
    expect(parseExamTime('16:00PM')).toEqual({ hour: 16, minute: 0, display: '04:00 PM' });
    expect(parseExamTime('13:30PM')).toEqual({ hour: 13, minute: 30, display: '01:30 PM' });
    expect(parseExamTime('12:00AM')).toEqual({ hour: 0, minute: 0, display: '12:00 AM' });
    expect(parseExamTime('')).toBeNull();
  });

  it('parses DD/MM/YYYY exam dates with start times accurately', () => {
    const dt = parseExamDateTime('22/10/2026', '14:30PM');
    expect(dt).not.toBeNull();
    expect(dt!.hasSpecificTime).toBe(true);
    expect(dt!.date.getFullYear()).toBe(2026);
    expect(dt!.date.getMonth()).toBe(9); // October (0-indexed)
    expect(dt!.date.getDate()).toBe(22);
    expect(dt!.date.getHours()).toBe(14);
    expect(dt!.date.getMinutes()).toBe(30);
  });

  it('normalizes exam types into clean titles', () => {
    expect(normalizeExamTypeTitle('MIDTERM')).toEqual({ title: 'Midterm Exam', kindKey: 'midterm' });
    expect(normalizeExamTypeTitle('FINAL')).toEqual({ title: 'Final Exam', kindKey: 'final' });
    expect(normalizeExamTypeTitle('MAKEUP')).toEqual({ title: 'Makeup Exam', kindKey: 'makeup' });
  });

  it('resolves rooms from Building, Room, and section override Comments', () => {
    expect(resolveExamRoom('A12', 'TH007-008', 'C12 TH005')).toEqual({
      room: 'C12-TH005',
      scheduledHall: 'A12-TH007-008',
      commentRoom: 'C12-TH005'
    });
    expect(resolveExamRoom('A1', '101D-102', 'A10-006')).toEqual({
      room: 'A10-006',
      scheduledHall: 'A1-101D-102',
      commentRoom: 'A10-006'
    });
    expect(resolveExamRoom('', 'B3-105', '')).toEqual({
      room: 'B3-105',
      scheduledHall: 'B3-105',
      commentRoom: ''
    });
    expect(resolveExamRoom('A10', 'MUL007', '')).toEqual({
      room: 'A10-MUL007',
      scheduledHall: 'A10-MUL007',
      commentRoom: ''
    });
  });

  it('extracts all 11 exam rows from the Student Exam Page table and resolves syllabus weights', () => {
    const dom = new JSDOM(BANNER_STUDENT_EXAM_HTML);
    const doc = dom.window.document;

    expect(isExamSchedulePage({ pathname: '/BannerExtensibility/customPage/page/StudentExamPage' }, doc)).toBe(true);

    const rows = extractExamScheduleRowsFromDoc(doc);
    expect(rows).toHaveLength(11);
    expect(extractExamScheduleRowsFromHtml(BANNER_STUDENT_EXAM_HTML)).toEqual(rows);

    const tasks = scrapeExamScheduleFromDoc(doc, '2026-10-27T18:00:00.000Z');
    expect(tasks).toHaveLength(11);
    expect(scrapeExamScheduleFromHtml(BANNER_STUDENT_EXAM_HTML, '2026-10-27T18:00:00.000Z')).toEqual(tasks);

    // 1. Islamic Culture Midterm (Comment override C12 TH005)
    const islamicMid = tasks.find(t => t.courseCode === '0104100' && t.title === 'Midterm Exam')!;
    expect(islamicMid).toBeDefined();
    expect(islamicMid.courseName).toBe('Islamic Culture');
    expect(islamicMid.room).toBe('C12-TH005');
    expect(islamicMid.weight).toBe(25);
    expect(islamicMid.description).toContain('08:30 AM - 09:30 AM');
    expect(islamicMid.description).toContain('Scheduled hall: A12-TH007-008');

    // 2. Calculus I Midterm (14:30PM -> 2:30 PM)
    const calcMid = tasks.find(t => t.courseCode === '1440133' && t.title === 'Midterm Exam')!;
    expect(calcMid).toBeDefined();
    expect(calcMid.courseName).toBe('Calculus I for Engineering');
    expect(calcMid.room).toBe('A12-110');
    expect(calcMid.weight).toBe(30);
    expect(new Date(calcMid.dueDate).getHours()).toBe(14);
    expect(new Date(calcMid.dueDate).getMinutes()).toBe(30);

    // 3. Physics 1 Midterm (Comment override A10-006)
    const phyMid = tasks.find(t => t.courseCode === '1430115' && t.title === 'Midterm Exam')!;
    expect(phyMid).toBeDefined();
    expect(phyMid.room).toBe('A10-006');
    expect(phyMid.weight).toBe(25);

    // 4. EAP Midterm (AKINDI)
    const eapMid = tasks.find(t => t.courseCode === '0202112' && t.title === 'Midterm Exam')!;
    expect(eapMid).toBeDefined();
    expect(eapMid.room).toBe('A10-MUL007');
    expect(eapMid.weight).toBe(20);
    expect(eapMid.description).toContain('Method: Akindi');

    // 5. Physics 1 Lab Final (Empty building, Room B3-105)
    const phyLabFinal = tasks.find(t => t.courseCode === '1430116' && t.title === 'Final Exam')!;
    expect(phyLabFinal).toBeDefined();
    expect(phyLabFinal.courseName).toBe('Physics 1 Lab');
    expect(phyLabFinal.room).toBe('B3-105');
    expect(phyLabFinal.weight).toBe(40);
    expect(new Date(phyLabFinal.dueDate).getHours()).toBe(16);

    // 6. Intro to Computer Eng Final (06/12/2026 at 13:30PM)
    const compFinal = tasks.find(t => t.courseCode === '1502101' && t.title === 'Final Exam')!;
    expect(compFinal).toBeDefined();
    expect(compFinal.courseName).toBe('Introduction to Computer Eng.');
    expect(compFinal.room).toBe('A8-103');
    expect(compFinal.weight).toBe(45);
    expect(new Date(compFinal.dueDate).getHours()).toBe(13);
    expect(new Date(compFinal.dueDate).getMinutes()).toBe(30);
  });

  it('merges with existing exam tasks without duplicating or overwriting user-edited tasks', () => {
    const dom = new JSDOM(BANNER_STUDENT_EXAM_HTML);
    const examTasks = scrapeExamScheduleFromDoc(dom.window.document, '2026-10-27T18:00:00.000Z');

    // Suppose an announcement previously created a tentative Calculus Midterm without the official time/room
    const existingTentativeCalcMid: DeadlineTask = {
      id: 'ann_calc_midterm',
      courseCode: '1440 133',
      courseName: 'Calculus I for Engineering',
      title: 'Midterm Exam',
      description: 'Midterm will be held on Oct 22.',
      dueDate: new Date(2026, 9, 22, 12, 30, 0).toISOString(),
      hasSpecificTime: false,
      type: 'exam',
      priority: 'high',
      status: 'pending',
      sourceSnippet: 'Midterm will be held on Oct 22.',
      confidence: 0.9,
      extractedBy: 'local',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z'
    };

    // And suppose the student manually edited the Physics 1 Midterm room/notes
    const userEditedPhyMid: DeadlineTask = {
      id: 'manual_phy_midterm',
      courseCode: '1430115',
      courseName: 'Physics 1',
      title: 'Midterm Exam',
      description: 'My custom physics midterm note',
      dueDate: new Date(2026, 9, 24, 17, 0, 0).toISOString(),
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'completed',
      sourceSnippet: '',
      confidence: 1.0,
      extractedBy: 'manual',
      userEdited: true,
      room: 'Custom-Room-99',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-05T10:00:00.000Z'
    };

    const { tasks: merged, addedCount, updatedCount } = mergeExamScheduleTasks(
      [existingTentativeCalcMid, userEditedPhyMid],
      examTasks,
      {},
      '2026-10-27T19:00:00.000Z'
    );

    // 11 total in table: 2 matched existing (1 updated, 1 skipped because userEdited), 9 newly added
    expect(addedCount).toBe(9);
    expect(updatedCount).toBe(1);
    expect(merged).toHaveLength(11);

    // Tentative Calc Midterm got updated with official time (14:30) and room (A12-110)
    const updatedCalc = merged.find(t => t.id === 'ann_calc_midterm')!;
    expect(new Date(updatedCalc.dueDate).getHours()).toBe(14);
    expect(updatedCalc.room).toBe('A12-110');
    expect(updatedCalc.updatedAt).toBe('2026-10-27T19:00:00.000Z');

    // User-edited Physics 1 Midterm was NOT overwritten (Rule 3)
    const keptPhy = merged.find(t => t.id === 'manual_phy_midterm')!;
    expect(keptPhy.room).toBe('Custom-Room-99');
    expect(keptPhy.status).toBe('completed');
    expect(keptPhy.updatedAt).toBe('2026-10-05T10:00:00.000Z');
  });

  it('works for any university or user without hardcoded courses, matching synced user courses or scraping directly', () => {
    setActiveUserCourses([
      {
        id: 'cs202',
        courseCode: 'CMP-202',
        courseName: 'Data Structures & Algorithms',
        colorHex: '#2563eb',
        aliases: ['CMP202', '99112'],
        scheduleSlots: [],
        syllabus: [
          { id: 'cs202_mid', name: 'Midterm Exam', type: 'exam', totalWeight: 25, unitWeight: 25 },
          { id: 'cs202_fin', name: 'Final Exam', type: 'exam', totalWeight: 40, unitWeight: 40 }
        ]
      }
    ]);

    const customUnivHtml = `
      <table>
        <tr>
          <th>CRN</th>
          <th>Course Code</th>
          <th>Course Name</th>
          <th>Exam Date</th>
          <th>Start Time</th>
          <th>End Time</th>
          <th>Building</th>
          <th>Room</th>
          <th>Exam Type</th>
        </tr>
        <tr>
          <td>99112</td>
          <td>CMP-202</td>
          <td>Data Structures</td>
          <td>15/11/2026</td>
          <td>09:00AM</td>
          <td>11:00AM</td>
          <td>ENG</td>
          <td>204</td>
          <td>FINAL</td>
        </tr>
        <tr>
          <td>99115</td>
          <td>BIO-101</td>
          <td>Molecular Biology</td>
          <td>18/11/2026</td>
          <td>14:00PM</td>
          <td>16:00PM</td>
          <td>SCI</td>
          <td>Lab 3</td>
          <td>MIDTERM</td>
        </tr>
      </table>
    `;

    const dom = new JSDOM(customUnivHtml);
    const tasks = scrapeExamScheduleFromDoc(dom.window.document, '2026-10-27T20:00:00.000Z');
    expect(tasks).toHaveLength(2);

    // Matched against user's synced course (uses user's configured courseName & syllabus weight)
    expect(tasks[0].courseCode).toBe('CMP-202');
    expect(tasks[0].courseName).toBe('Data Structures & Algorithms');
    expect(tasks[0].title).toBe('Final Exam');
    expect(tasks[0].weight).toBe(40);
    expect(tasks[0].room).toBe('ENG-204');

    // Unconfigured course from another university is scraped directly from the table without any hardcoded fallback
    expect(tasks[1].courseCode).toBe('BIO-101');
    expect(tasks[1].courseName).toBe('Molecular Biology');
    expect(tasks[1].title).toBe('Midterm Exam');
    expect(tasks[1].room).toBe('SCI Lab 3');
  });
});
