// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeAnnouncementsFull } from '../src/content/scraper';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { isValidTask } from '../src/core/courseHelper';

// Card markup copied from the live UOS Ultra activity stream (2026-10-22). The stream
// shows no announcement text: `.content` is empty and only the timestamp is left.
function card(opts: { icon: string; courseId: string; course: string; titleHref: string; title: string; date: string; time: string }): string {
  return `
  <div class="element-card stream-panel-activity-card">
    <ng-switch><div class="element-image"><div class="content-item-icon"><div><bb-ui-content-icon><div>
      <bb-ui-icon-large-${opts.icon} class="react-container"></bb-ui-icon-large-${opts.icon}>
    </div></bb-ui-content-icon></div></div></div></ng-switch>
    <div class="element-details course-color-2">
      <div class="timestamp"><div><div class="js-split-datetime"><span class="date">${opts.date}</span><span class="time">${opts.time}</span></div></div></div>
      <div class="context">
        <a analytics-id="stream.entry.course" href="https://elearning.sharjah.ac.ae/ultra/courses/${opts.courseId}/outline">${opts.course}</a><span></span>
      </div>
      <div class="name"><ng-switch><a class="js-title-link" analytics-id="stream.entry.title" href="${opts.titleHref}">${opts.title}</a></ng-switch></div>
      <div class="content"></div>
    </div>
  </div>`;
}

function streamPage(cards: string[]): void {
  document.title = 'Activity Stream';
  document.body.innerHTML = `<section class="js-base-stream-container route-view-container" aria-label="Activity Stream">${cards.join('')}</section>`;
}

const QUIZ3_BODY = '<p>Dear Students,</p><p>Quiz 3 will be conducted on <u>Thursday, 29 October 2026</u>, during the lecture time. Quiz 3 will cover Modules 6 and 7.</p>';

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = routes[path];
    if (body === undefined) return new Response('{}', { status: 403 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('UOS Ultra stream cards', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({}));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('skips "Added: file" content cards instead of reading their timestamp as text', async () => {
    streamPage([card({
      icon: 'presentation', courseId: '_85276_1', course: 'Physics 1 Lab- 11L - مختبر الفيزياء 1',
      titleHref: 'https://elearning.sharjah.ac.ae/bbcswebdav/pid-2449176-dt-content-rid-61563231_1/xid-61563',
      title: 'Added: Final Exam Review( MH).ppt', date: 'Oct 18, 2026', time: '2:20 PM'
    })]);
    const anns = await scrapeAnnouncementsFull({ fullRescan: true });
    expect(anns).toHaveLength(0);
  });

  it('never uses the timestamp as announcement text when the card has no body', async () => {
    streamPage([card({
      icon: 'announcement', courseId: '_84837_1', course: 'Islamic Culture- 13A - الثقافة الإسلامية',
      titleHref: '#', title: 'Exam reminder', date: 'Oct 18, 2026', time: '2:20 PM'
    })]);
    const anns = await scrapeAnnouncementsFull({ fullRescan: true });
    for (const a of anns) {
      expect(a.contentText).not.toMatch(/Oct 18, 2026|2:20 PM/);
    }
    const tasks = anns.flatMap(a => extractDeadlinesLocally(a));
    expect(tasks).toHaveLength(0);
  });

  it('fetches course announcements with the real course name, from the endpoint Ultra uses when the public one is refused', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/learn/api/v1/courses/_86929_1/announcements': {
        results: [{ id: '_9001_1', title: 'Quiz 3 - Thursday 29 October 2026', body: { displayText: QUIZ3_BODY }, created: '2026-10-22T09:00:00.000Z' }]
      }
    }));
    streamPage([card({
      icon: 'document', courseId: '_86929_1', course: 'Calculus I for Engineering- 21 - حسبان 1',
      titleHref: 'https://elearning.sharjah.ac.ae/bbcswebdav/pid-1/xid-1', title: 'Added: Lecture 9.pdf', date: '2 hours', time: '10:00 AM'
    })]);
    const anns = await scrapeAnnouncementsFull({ fullRescan: true });
    const quiz = anns.find(a => /Quiz 3/.test(a.title));
    expect(quiz).toBeDefined();
    expect(quiz!.courseName).toMatch(/Calculus/i);
    expect(quiz!.contentText).toMatch(/29 October 2026/);
    const tasks = extractDeadlinesLocally(quiz!);
    expect(tasks.map(t => [t.type, t.dueDate.slice(0, 10)])).toEqual([['quiz', '2026-10-29']]);
  });
});

describe('Blackboard requests ignore the page <base href>', () => {
  afterEach(() => {
    document.head.querySelectorAll('base').forEach(b => b.remove());
    vi.restoreAllMocks();
  });

  it('sends every request to the Blackboard site, not the CloudFront asset host', async () => {
    // Live UOS Ultra pages set <base href> to a CloudFront host, so "/learn/api/..." 404'd there
    const base = document.createElement('base');
    base.href = 'https://dmuwut6e40u5o.cloudfront.net/ultra/';
    document.head.appendChild(base);
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    streamPage([card({
      icon: 'document', courseId: '_86929_1', course: 'Calculus I for Engineering- 21 - حسبان 1',
      titleHref: 'https://elearning.sharjah.ac.ae/bbcswebdav/pid-1/xid-1', title: 'Added: Lecture 9.pdf', date: '2 hours', time: '10:00 AM'
    })]);
    await scrapeAnnouncementsFull({ fullRescan: true });
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith(window.location.origin + '/')).toBe(true);
    }
  });
});

describe('fake tasks made from a timestamp are dropped', () => {
  const junk = { title: 'Exam', courseName: 'Physics 1', courseCode: '1430 115', extractedBy: 'local' };
  it('drops a task whose only text is the posting time', () => {
    expect(isValidTask({ ...junk, description: '*Oct 18, 2026\n2:20 PM', sourceSnippet: '*Oct 18, 2026\n2:20 PM' })).toBe(false);
    expect(isValidTask({ ...junk, description: '23 hours 3:00 PM' })).toBe(false);
  });
  it('keeps real tasks and anything the student edited', () => {
    expect(isValidTask({ ...junk, description: 'Exam on Oct 29, 2026 at 2:20 PM in M5-101' })).toBe(true);
    expect(isValidTask({ ...junk, description: '*Oct 18, 2026\n2:20 PM', userEdited: true })).toBe(true);
  });
});
