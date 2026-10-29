import { describe, it, expect, beforeEach } from 'vitest';
import {
  findCourseSchedule,
  resolveTaskTimeWithSchedule,
  getAllCourseSchedules,
  extractRoomFromText,
  resolveTaskRoom
} from '../src/core/courseSchedule';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Student Class Schedule Engine (schedule.pdf)', () => {
  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
  });
  it('loads all 6 registered courses with accurate class timings', () => {
    const schedules = getAllCourseSchedules();
    expect(schedules.length).toBe(6);

    const calc = schedules.find(s => s.courseId === 'calc1');
    expect(calc).toBeDefined();
    expect(calc?.startHour).toBe(12);
    expect(calc?.startMinute).toBe(30);
    expect(calc?.days).toEqual(['Tuesday', 'Thursday']);

    const phy1 = schedules.find(s => s.courseId === 'phy1');
    expect(phy1).toBeDefined();
    expect(phy1?.startHour).toBe(11);
    expect(phy1?.startMinute).toBe(0);
    expect(phy1?.days).toEqual(['Monday', 'Wednesday']);

    const islamic = schedules.find(s => s.courseId === 'islamic');
    expect(islamic).toBeDefined();
    expect(islamic?.startHour).toBe(17);
    expect(islamic?.startMinute).toBe(0);
    expect(islamic?.days).toEqual(['Monday', 'Wednesday']);

    const compeng = schedules.find(s => s.courseId === 'compeng');
    expect(compeng).toBeDefined();
    expect(compeng?.startHour).toBe(11);
    expect(compeng?.startMinute).toBe(0);
    expect(compeng?.days).toEqual(['Tuesday', 'Thursday']);

    const eap = schedules.find(s => s.courseId === 'eap');
    expect(eap).toBeDefined();
    expect(eap?.startHour).toBe(14);
    expect(eap?.startMinute).toBe(0);
    expect(eap?.days).toEqual(['Tuesday', 'Thursday']);

    const phyLab = schedules.find(s => s.courseId === 'phy1lab');
    expect(phyLab).toBeDefined();
    expect(phyLab?.startHour).toBe(14);
    expect(phyLab?.startMinute).toBe(0);
    expect(phyLab?.days).toEqual(['Wednesday']);
  });

  describe('findCourseSchedule', () => {
    it('correctly matches Calculus 1 by name, code, or Arabic', () => {
      expect(findCourseSchedule('Calculus I for Engineering')?.courseId).toBe('calc1');
      expect(findCourseSchedule('حسبان 1')?.courseId).toBe('calc1');
      expect(findCourseSchedule('1440133')?.courseId).toBe('calc1');
    });

    it('distinguishes Physics 1 from Physics 1 Lab', () => {
      expect(findCourseSchedule('Physics 1')?.courseId).toBe('phy1');
      expect(findCourseSchedule('Physics 1 Lab')?.courseId).toBe('phy1lab');
      expect(findCourseSchedule('General Physics 1')?.courseId).toBe('phy1');
      expect(findCourseSchedule('مختبر فيزياء 1')?.courseId).toBe('phy1lab');
    });

    it('correctly matches Intro to Comp Eng and Islamic Culture', () => {
      expect(findCourseSchedule('Introduction to Computer Eng.')?.courseId).toBe('compeng');
      expect(findCourseSchedule('Islamic Culture - الثقافة الإسلامية')?.courseId).toBe('islamic');
    });
  });

  describe('resolveTaskTimeWithSchedule', () => {
    it('preserves teacher explicit assigned time when hasSpecificTime is true', () => {
      const teacherDate = new Date('2026-10-15T23:59:00');
      const res = resolveTaskTimeWithSchedule({
        dueDate: teacherDate,
        courseNameOrCode: 'Calculus I for Engineering',
        hasSpecificTime: true,
        announcementText: 'Submit on Blackboard before 11:59 PM',
        title: 'HW 2'
      });

      expect(res.appliedSchedule).toBe(false);
      expect(res.dueDate.getHours()).toBe(23);
      expect(res.dueDate.getMinutes()).toBe(59);
    });

    it('sets exact class time (12:30 PM) for Calculus 1 when no specific time is stated', () => {
      const dateWithoutTime = new Date('2026-10-20T00:00:00');
      const res = resolveTaskTimeWithSchedule({
        dueDate: dateWithoutTime,
        courseNameOrCode: 'Calculus I for Engineering',
        hasSpecificTime: false,
        announcementText: 'Quiz 2 will take place on Tuesday.',
        title: 'Quiz 2'
      });

      expect(res.appliedSchedule).toBe(true);
      expect(res.dueDate.getHours()).toBe(12);
      expect(res.dueDate.getMinutes()).toBe(30);
      expect(res.classTimeStr).toBe('12:30');
    });

    it('sets exact class time (11:00 AM) for Physics 1 when no specific time is stated', () => {
      const dateWithoutTime = new Date('2026-10-21T00:00:00');
      const res = resolveTaskTimeWithSchedule({
        dueDate: dateWithoutTime,
        courseNameOrCode: 'Physics 1',
        hasSpecificTime: false,
        announcementText: 'Midterm Exam next Wednesday.',
        title: 'Midterm Exam'
      });

      expect(res.appliedSchedule).toBe(true);
      expect(res.dueDate.getHours()).toBe(11);
      expect(res.dueDate.getMinutes()).toBe(0);
      expect(res.classTimeStr).toBe('11:00');
    });

    it('sets exact class time (5:00 PM / 17:00) for Islamic Culture when no specific time is stated', () => {
      const dateWithoutTime = new Date('2026-10-19T00:00:00');
      const res = resolveTaskTimeWithSchedule({
        dueDate: dateWithoutTime,
        courseNameOrCode: 'الثقافة الإسلامية',
        hasSpecificTime: false,
        announcementText: 'امتحان المنتصف يوم الاثنين',
        title: 'امتحان المنتصف'
      });

      expect(res.appliedSchedule).toBe(true);
      expect(res.dueDate.getHours()).toBe(17);
      expect(res.dueDate.getMinutes()).toBe(0);
      expect(res.classTimeStr).toBe('17:00');
    });
  });

  describe('Default Course Rooms (Student Exact Assignments)', () => {
    it('has the correct default room assigned for each of the 6 courses', () => {
      const schedules = getAllCourseSchedules();

      const compeng = schedules.find(s => s.courseId === 'compeng');
      expect(compeng?.room).toBe('A8-103');

      const calc = schedules.find(s => s.courseId === 'calc1');
      expect(calc?.room).toBe('A12-110');

      const eap = schedules.find(s => s.courseId === 'eap');
      expect(eap?.room).toBe('A3-184');

      const phy1 = schedules.find(s => s.courseId === 'phy1');
      expect(phy1?.room).toBe('A8-110');

      const phy1lab = schedules.find(s => s.courseId === 'phy1lab');
      expect(phy1lab?.room).toBe('Central Lab Men - 105');

      const islamic = schedules.find(s => s.courseId === 'islamic');
      expect(islamic?.room).toBe('A8-TH005');
    });
  });

  describe('extractRoomFromText', () => {
    it('extracts building and room numbers formatted like A8-103, A12 - 110, A3-184, A8-TH005', () => {
      expect(extractRoomFromText('The exam will be held in A8-103.')).toBe('A8-103');
      expect(extractRoomFromText('Calculus midterm in A12 - 110 at 12:30 PM')).toBe('A12-110');
      expect(extractRoomFromText('Please come to room A3-184.')).toBe('A3-184');
      expect(extractRoomFromText('Lecture in A8-TH005 auditorium')).toBe('A8-TH005');
    });

    it('extracts central laboratory format', () => {
      expect(extractRoomFromText('Physics experiment in Central Lab Men - 105')).toBe('Central Lab Men - 105');
      expect(extractRoomFromText('Meet in Central Laboratories (Men) 105')).toBe('Central Lab Men - 105');
    });

    it('extracts English keywords with room and hall numbers', () => {
      expect(extractRoomFromText('Exam is in room A8-204')).toBe('A8-204');
      expect(extractRoomFromText('Class will meet in hall TH005')).toBe('TH005');
      expect(extractRoomFromText('Quiz in rm 103')).toBe('103');
    });

    it('extracts Arabic keywords for classroom/hall/lab', () => {
      expect(extractRoomFromText('سيعقد الاختبار في قاعة 103')).toBe('103');
      expect(extractRoomFromText('المحاضرة في مدرج TH005')).toBe('TH005');
      expect(extractRoomFromText('التجربة في مختبر 105')).toBe('105');
    });

    it('returns null when no room or hall is mentioned', () => {
      expect(extractRoomFromText('Please solve assignment 2 before Sunday.')).toBeNull();
      expect(extractRoomFromText('')).toBeNull();
    });
  });

  describe('resolveTaskRoom', () => {
    it('prioritizes explicit room mentioned by professor in announcement text', () => {
      const res = resolveTaskRoom({
        courseNameOrCode: 'Calculus I for Engineering',
        title: 'Midterm Exam',
        announcementText: 'Please note the exam will be held in room A8-204 instead of our normal room.'
      });
      expect(res.room).toBe('A8-204');
      expect(res.isCustom).toBe(true);
    });

    it('prioritizes existingRoom if already defined and valid', () => {
      const res = resolveTaskRoom({
        courseNameOrCode: 'Calculus I for Engineering',
        title: 'Midterm Exam',
        existingRoom: 'M9-021'
      });
      expect(res.room).toBe('M9-021');
      expect(res.isCustom).toBe(true);
    });

    it('falls back to default schedule rooms for each course when not stated in announcement', () => {
      expect(resolveTaskRoom({ courseNameOrCode: 'English for Academic Purposes' }).room).toBe('A3-184');
      expect(resolveTaskRoom({ courseNameOrCode: 'Calculus I for Engineering' }).room).toBe('A12-110');
      expect(resolveTaskRoom({ courseNameOrCode: 'Introduction to Computer Eng.' }).room).toBe('A8-103');
      expect(resolveTaskRoom({ courseNameOrCode: 'Physics 1' }).room).toBe('A8-110');
      expect(resolveTaskRoom({ courseNameOrCode: 'Physics 1 Lab' }).room).toBe('Central Lab Men - 105');
      expect(resolveTaskRoom({ courseNameOrCode: 'Islamic Culture' }).room).toBe('A8-TH005');
      expect(resolveTaskRoom({ courseNameOrCode: 'الثقافة الإسلامية' }).room).toBe('A8-TH005');
    });
  });
});
