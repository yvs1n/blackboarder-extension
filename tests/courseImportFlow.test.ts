// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { findCoursesInDocument, focusDocumentForAi, COURSE_IMPORT_PROMPT } from '../src/engine/aiCourseImport';
import { courseImportReviewHtml, readCourseImportReview } from '../src/core/courseImportView';

const SYLLABUS = 'Course Code: CSC 201\nCourse Title: Data Structures\nAssessment\nMidterm 40%\nFinal 60%';
const aiReply = (courses: unknown) => ({ choices: [{ message: { content: JSON.stringify({ courses }) } }] });
const AI_COURSE = { courseCode: 'CSC 201', courseName: 'Data Structures', meetings: [{ days: ['Monday'], start: '09:00', end: '10:15', room: 'SCI 105' }], assessments: [{ name: 'Midterm', weight: 40 }, { name: 'Final', weight: 60 }] };

afterEach(() => vi.unstubAllGlobals());

describe('finding courses with and without AI', () => {
  it('uses the built-in reader when no AI is set up', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await findCoursesInDocument(SYLLABUS, null);
    expect(r.source).toBe('built-in');
    expect(r.courses[0].syllabus.map(s => s.totalWeight)).toEqual([40, 60]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks the phone server with the sync key and AI pass, never an API key', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: aiReply([AI_COURSE]) })));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await findCoursesInDocument(SYLLABUS, { provider: 'server', chatUrl: 'https://x.test/api/ai/extract', apiKey: '', model: '', syncKey: 'BBS-MADEUP', aiPass: 'made-up-pass' });
    expect(r.source).toBe('ai');
    expect(r.courses[0].scheduleSlots[0]).toMatchObject({ days: ['Monday'], startTime: '09:00', room: 'SCI 105' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ syncKey: 'BBS-MADEUP', aiPass: 'made-up-pass' });
    expect(body.messages[0].content).toBe(COURSE_IMPORT_PROMPT);
    expect(JSON.stringify(body).length).toBeLessThan(20000);
  });

  it('calls the provider directly from the extension, retrying without JSON mode', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('no json mode', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(aiReply([AI_COURSE]))));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await findCoursesInDocument(SYLLABUS, { provider: 'custom', chatUrl: 'https://ai.test/v1/chat/completions', apiKey: 'made-up-key', model: 'm' });
    expect(r.source).toBe('ai');
    expect(JSON.parse((fetchSpy.mock.calls[1] as any)[1].body).response_format).toBeUndefined();
  });

  it('falls back to the built-in reader and says why when the AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'AI pass missing or out of date.' }), { status: 403 })));
    const r = await findCoursesInDocument(SYLLABUS, { provider: 'server', chatUrl: 'https://x.test/api/ai/extract', apiKey: '', model: '', syncKey: 'BBS-MADEUP', aiPass: 'p' });
    expect(r.source).toBe('built-in');
    expect(r.aiProblem).toMatch(/AI pass/);
    expect(r.courses).toHaveLength(1);
  });

  it('sends only the useful parts of a long document', () => {
    const filler = Array.from({ length: 3000 }, (_, i) => `Week ${i} reading about topic number ${i} and more words`).join('\n');
    const text = `Course Code: CSC 201\n${filler}\nGrading\nMidterm 40%\nFinal 60%\nLectures Sun 11:00 - 12:15`;
    const focused = focusDocumentForAi(text);
    expect(focused.length).toBeLessThanOrEqual(15000);
    expect(focused).toContain('Course Code: CSC 201');
    expect(focused).toContain('Midterm 40%');
    expect(focused).toContain('Lectures Sun 11:00 - 12:15');
  });
});

describe('the check-before-saving list', () => {
  const existing: any[] = [{ id: 'csc201', courseCode: 'CSC201', courseName: 'Data Structures', colorHex: '#000', aliases: [], scheduleSlots: [], syllabus: [] }];
  const drafts: any[] = [
    { courseCode: 'CSC 201', courseName: 'Data <b>Structures</b>', creditHours: 3, scheduleSlots: [{ days: ['Sunday', 'Tuesday'], startTime: '11:00', endTime: '12:15', room: 'A8-103' }], syllabus: [{ name: 'Midterm', totalWeight: 40, type: 'exam', id: 'a' }] },
    { courseCode: 'MTH 210', courseName: 'Linear Algebra', scheduleSlots: [], syllabus: [] }
  ];

  it('shows what was found, picks the matching course and escapes names', () => {
    document.body.innerHTML = `<div id="list">${courseImportReviewHtml(drafts, existing)}</div>`;
    const cards = document.querySelectorAll('.ci-card');
    expect(cards).toHaveLength(2);
    expect(document.querySelector('#list b')).toBeNull();
    expect((cards[0].querySelector('.ci-name') as HTMLInputElement).value).toBe('Data <b>Structures</b>');
    expect((cards[0].querySelector('.ci-target') as HTMLSelectElement).value).toBe('csc201');
    expect((cards[1].querySelector('.ci-target') as HTMLSelectElement).value).toBe('new');
    expect(cards[0].textContent).toContain('Sun, Tue 11:00 to 12:15, A8-103');
    expect(cards[0].textContent).toContain('adds up to 40%');
    expect(cards[1].textContent).toContain('No class times found');
  });

  it('reads back the student\'s corrections and leaves out unticked courses', () => {
    document.body.innerHTML = `<div id="list">${courseImportReviewHtml(drafts, existing)}</div>`;
    const cards = document.querySelectorAll('.ci-card');
    (cards[0].querySelector('.ci-name') as HTMLInputElement).value = 'Data Structures';
    (cards[0].querySelector('.ci-credits') as HTMLInputElement).value = '4';
    (cards[1].querySelector('.ci-keep') as HTMLInputElement).checked = false;
    const picks = readCourseImportReview(document.getElementById('list')!, drafts);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ targetId: 'csc201', draft: { courseName: 'Data Structures', creditHours: 4 } });
  });
});
