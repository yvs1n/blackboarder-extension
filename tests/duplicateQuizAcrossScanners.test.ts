import { describe, it, expect, afterEach } from 'vitest';
import { areTasksDuplicates, deduplicateTaskList } from '../src/utils/taskMerge';
import { setActiveUserCourses } from '../src/core/userCourses';
import { DeadlineTask } from '../src/types';

/*
 * The HTTP scanner and the page scanner can name the same course differently
 * ("PHYS 101 - Physics I" from the enrolment list, "Physics I" on a stream card), and the
 * stream sometimes gives no course at all. The same quiz must still show once.
 */
function task(overrides: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: 'x',
    title: 'Quiz 2',
    courseName: 'Physics I',
    courseCode: '',
    type: 'quiz',
    status: 'pending',
    dueDate: '2026-11-03T09:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  } as DeadlineTask;
}

const fromStream = (o: Partial<DeadlineTask> = {}) => task({ id: 'stream_PHYS101_Quiz2_1', ...o });
const fromAnnouncement = (o: Partial<DeadlineTask> = {}) => task({ id: 'ann_api_9_0', announcementId: 'ann_api_9', dueDate: '2026-11-03T00:00:00.000Z', ...o });

describe('the same quiz from both scanners shows once', () => {
  afterEach(() => setActiveUserCourses([]));

  for (const setUp of [false, true]) {
    describe(setUp ? 'with the course set up' : 'before the course is set up', () => {
      const prepare = () => setActiveUserCourses(setUp ? [{ courseName: 'Physics I', courseCode: 'PHYS101' } as any] : []);

      it('merges a course name with a code in front', () => {
        prepare();
        const list = deduplicateTaskList([fromStream({ courseName: 'PHYS 101 - Physics I', courseCode: 'PHYS101' }), fromAnnouncement()]);
        expect(list).toHaveLength(1);
      });

      it('merges a course name with a section after it', () => {
        prepare();
        expect(areTasksDuplicates(fromStream({ courseName: 'Physics I (Lecture) - 12' }), fromAnnouncement())).toBe(true);
      });

      it('merges a copy with no course when the title and day are the same', () => {
        prepare();
        expect(areTasksDuplicates(fromStream({ courseName: '' }), fromAnnouncement())).toBe(true);
        expect(areTasksDuplicates(fromStream({ courseName: 'General Course' }), fromAnnouncement())).toBe(true);
      });
    });
  }

  it('keeps a copy with no course apart when the title or the day differs', () => {
    expect(areTasksDuplicates(fromStream({ courseName: '' }), fromAnnouncement({ title: '2nd Quiz' }))).toBe(false);
    expect(areTasksDuplicates(fromStream({ courseName: '' }), fromAnnouncement({ dueDate: '2026-11-10T00:00:00.000Z' }))).toBe(false);
  });

  it('never merges the same quiz from two different courses', () => {
    expect(areTasksDuplicates(fromStream({ courseName: 'Chemistry I' }), fromAnnouncement())).toBe(false);
    expect(areTasksDuplicates(fromStream({ courseName: 'Physics II' }), fromAnnouncement())).toBe(false);
    expect(areTasksDuplicates(fromStream({ courseName: 'Calculus 1' }), fromAnnouncement({ courseName: 'Calculus 2' }))).toBe(false);
    expect(areTasksDuplicates(
      fromStream({ courseName: 'Physics I', courseCode: 'PHYS101' }),
      fromAnnouncement({ courseName: 'Physics I', courseCode: 'PHYS102' })
    )).toBe(true); // same name wins: the code only decides when the names differ
  });

  it('never merges Quiz 2 with Quiz 3', () => {
    expect(areTasksDuplicates(fromStream({ courseName: 'PHYS 101 - Physics I' }), fromAnnouncement({ title: 'Quiz 3' }))).toBe(false);
  });
});
