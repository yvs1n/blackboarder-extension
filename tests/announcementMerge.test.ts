import { describe, it, expect } from 'vitest';
import { mergeStreamAndCourseAnnouncements } from '../src/utils/announcementMerge';
import type { Announcement } from '../src/types';

const CPE_TEXT = 'Dear Students,Quiz 3 will be conducted on Thursday, 29 October 2026, during the lecture time. Quiz 3 will cover Modules 6 and 7.';
const LAB_TEXT = 'Dear Students, the 3rd lab quiz will be held next Wednesday in the lab.';

function ann(extra: Partial<Announcement>): Announcement {
  return {
    id: 'ann_x',
    courseCode: '',
    courseName: '',
    title: 'Quiz 3',
    contentText: '',
    sourceUrl: '',
    scannedAt: '2026-10-22T10:00:00.000Z',
    ...extra
  } as Announcement;
}

describe('stream cards and full course announcements', () => {
  it('never gives the lab "Quiz 3" the CPE "Quiz 3" text', () => {
    const labCard = ann({ id: 'ann_ultra__596674_1', courseName: 'Physics 1 Lab', contentText: 'Dear Students, the 3rd lab quiz will…' });
    const cpeFull = ann({ id: 'ann_api__597049_1', courseName: 'Introduction to Computer Eng.', contentText: CPE_TEXT });
    const labFull = ann({ id: 'ann_api__596674_1', courseName: 'Physics 1 Lab', contentText: LAB_TEXT });

    const out = mergeStreamAndCourseAnnouncements([labCard], [cpeFull, labFull]);
    const lab = out.filter(a => a.courseName === 'Physics 1 Lab');
    const cpe = out.filter(a => a.courseName === 'Introduction to Computer Eng.');
    expect(lab).toHaveLength(1);
    expect(lab[0].contentText).toBe(LAB_TEXT);
    expect(cpe).toHaveLength(1);
    expect(cpe[0].contentText).toBe(CPE_TEXT);
  });

  it('keeps two courses\' same-titled posts apart even when both course codes are blank', () => {
    const cpeFull = ann({ id: 'ann_api__597049_1', courseName: 'Introduction to Computer Eng.', contentText: CPE_TEXT });
    const labFull = ann({ id: 'ann_api__596674_1', courseName: 'Physics 1 Lab', contentText: LAB_TEXT });
    const out = mergeStreamAndCourseAnnouncements([], [cpeFull, labFull]);
    expect(out.map(a => a.contentText).sort()).toEqual([CPE_TEXT, LAB_TEXT].sort());
  });

  it('still fills a cut-short stream card from its own course', () => {
    const card = ann({ id: 'ann_ultra_3_Quiz3', courseName: 'Introduction to Computer Eng.', contentText: 'Dear Students,Quiz 3 will be…' });
    const full = ann({ id: 'ann_api__597049_1', courseName: 'Introduction to Computer Eng.', contentText: CPE_TEXT });
    const out = mergeStreamAndCourseAnnouncements([card], [full]);
    expect(out).toHaveLength(1);
    expect(out[0].contentText).toBe(CPE_TEXT);
  });

  it('matches by Blackboard id when the titles differ', () => {
    const card = ann({ id: 'ann_ultra__597049_1', title: 'Quiz 3', courseName: 'Introduction to Computer Eng.', contentText: 'short…' });
    const full = ann({ id: 'ann_api__597049_1', title: 'Quiz 3 - Modules 6 & 7', courseName: 'Introduction to Computer Eng.', contentText: CPE_TEXT });
    const out = mergeStreamAndCourseAnnouncements([card], [full]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Quiz 3 - Modules 6 & 7');
  });
});
