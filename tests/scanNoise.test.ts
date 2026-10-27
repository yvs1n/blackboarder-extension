import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { isPresentationTask, processAnnouncementsBatch } from '../src/engine/hybridExtractor';
import { Announcement, DeadlineTask, DEFAULT_SETTINGS } from '../src/types';

const task = (over: Partial<DeadlineTask> = {}): DeadlineTask => ({
  id: 'ex1',
  courseCode: 'MATH101',
  courseName: 'Calculus',
  title: 'Midterm Exam',
  description: '',
  dueDate: '2026-11-10T10:00:00.000Z',
  hasSpecificTime: true,
  type: 'exam',
  priority: 'high',
  status: 'pending',
  sourceSnippet: '',
  confidence: 1,
  extractedBy: 'local',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over
});

const ann = (title: string, text: string): Announcement => ({
  id: 'a-new',
  courseCode: 'MATH101',
  courseName: 'Calculus',
  title,
  contentText: text,
  postedAt: '2026-10-20T08:00:00.000Z',
  sourceUrl: 'https://example.test',
  scannedAt: '2026-10-20T08:00:00.000Z'
});

describe('scan noise', () => {
  it('presentation dates are not made into tasks', () => {
    const tasks = extractDeadlinesLocally(ann('Presentations', 'Presentations will be held on 5 November 2026 in room A8-103.'));
    expect(tasks).toHaveLength(0);
    expect(isPresentationTask({ title: 'Project Presentation' })).toBe(true);
    expect(isPresentationTask({ title: 'Quiz 1' })).toBe(false);
  });

  it('an announcement about how the exam goes does not add the exam again', async () => {
    const existing = task();
    const r = await processAnnouncementsBatch(
      [ann('Midterm', 'The midterm exam will be held on 10 November 2026 at 10:00 AM in A8-103. It has 30 multiple choice questions.')],
      [existing],
      DEFAULT_SETTINGS
    );
    expect(r.newTasks.filter(t => t.type === 'exam')).toHaveLength(0);
    expect(r.allTasks.filter(t => t.type === 'exam')).toHaveLength(1);
  });

  it('a different exam of the same course is still added', async () => {
    const r = await processAnnouncementsBatch(
      [ann('Final Exam', 'The final exam will be held on 20 December 2026 at 10:00 AM in A8-103.')],
      [task()],
      DEFAULT_SETTINGS
    );
    expect(r.newTasks.some(t => t.type === 'exam')).toBe(true);
  });

  it('the extension never fills in student notes by itself', () => {
    expect(fs.readFileSync('src/engine/aiExtractor.ts', 'utf8')).not.toMatch(/^\s*notes:/m);
    expect(fs.readFileSync('src/popup/popup.ts', 'utf8')).not.toContain("notes: (t as any).notes");
    const tasks = extractDeadlinesLocally(ann('Quiz 2', 'Quiz 2 will be held on 12 November 2026 at 11:00 AM.'));
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.notes).toBeUndefined();
  });
});
