import { describe, it, expect } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';

// Posted on Friday 23 Oct 2026 (UAE time). Weeks start on Sunday.
function dayOf(text: string, postedAt = '2026-10-23T09:00:00+04:00'): string {
  const [task] = extractDeadlinesLocally({
    id: 'rel', courseCode: '', courseName: 'Calculus I', title: '', contentText: text,
    postedAt, sourceUrl: '', scannedAt: postedAt
  } as any);
  if (!task) return 'none';
  // The parser works in the device's local time, like a student's browser, so read the date the
  // same way. This passes on a UAE laptop and on GitHub's UTC runners alike.
  const d = new Date(task.dueDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('relative weekdays', () => {
  it('keeps the existing meanings', () => {
    expect(dayOf('quiz this Sunday')).toBe('2026-10-25');
    expect(dayOf('quiz on Sunday')).toBe('2026-10-25');
    expect(dayOf('the quiz is next Sunday')).toBe('2026-10-25');
  });

  it('"after next" is one week later than "next"', () => {
    expect(dayOf('the quiz we talked about is the Sunday after next')).toBe('2026-11-01');
    expect(dayOf('Quiz 2 is on Tuesday after next')).toBe('2026-11-03');
    expect(dayOf('الكويز الأحد بعد القادم')).toBe('2026-11-01');
    expect(dayOf('الكويز يوم الثلاثاء الذي بعد القادم')).toBe('2026-11-03');
  });

  it('"a week from Sunday" is a week after the coming Sunday', () => {
    expect(dayOf('quiz a week from Sunday')).toBe('2026-11-01');
  });

  it('"next week" names a day in the following week', () => {
    expect(dayOf('quiz next week on Tuesday')).toBe('2026-10-27');
    expect(dayOf('quiz on Wednesday next week')).toBe('2026-10-28');
    expect(dayOf('الكويز الأسبوع القادم يوم الثلاثاء')).toBe('2026-10-27');
    expect(dayOf('الكويز يوم الأربعاء من الأسبوع المقبل')).toBe('2026-10-28');
  });

  it('المقبل works like القادم', () => {
    expect(dayOf('الكويز يوم الثلاثاء المقبل')).toBe('2026-10-27');
  });
});
