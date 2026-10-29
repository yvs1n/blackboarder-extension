// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseDirectStreamCard } from '../src/utils/streamParser';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { parseCourseDetails } from '../src/core/courseHelper';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Real Blackboard DOM Scraper & Layout Handling Suite', () => {
  let fixtureHtml: string;

  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
    const fixturePath = path.join(__dirname, 'fixtures', 'test_ultra_stream_fixture.html');
    fixtureHtml = fs.readFileSync(fixturePath, 'utf8');
    document.body.innerHTML = fixtureHtml;
  });

  describe('Scoped Candidate Selection & Direct Due Dates', () => {
    it('accurately discovers direct deadline cards within scoped containers', () => {
      const candidateScope = document.querySelectorAll(
        '[role="feed"] *, .stream-item-container *, .stream-entry *, article *, .element-card *, [class*="activity-card"] *, [class*="stream-item"] *'
      );
      expect(candidateScope.length).toBeGreaterThan(0);

      const leafDateElements: Element[] = [];
      candidateScope.forEach(el => {
        const text = el.textContent || '';
        if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(text)) {
          let hasChildMatch = false;
          for (let j = 0; j < el.children.length; j++) {
            if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(el.children[j].textContent || '')) {
              hasChildMatch = true;
              break;
            }
          }
          if (!hasChildMatch) {
            leafDateElements.push(el);
          }
        }
      });

      expect(leafDateElements.length).toBe(2);
    });

    it('extracts English direct deadline card with exact course, title, and UTC+4 timestamp', () => {
      const card = document.getElementById('stream-card-1');
      expect(card).not.toBeNull();
      const cardText = card?.textContent?.trim() || '';

      const task = parseDirectStreamCard(cardText);
      expect(task).not.toBeNull();
      expect(task?.title).toBe('Assignment-1-Graded');
      expect(task?.courseName).toBe('Calculus I for Engineering');
      expect(task?.dueDate).toBe('2026-09-25T19:59:00.000Z');
      expect(task?.status).toBe('pending');
    });

    it('extracts Arabic direct deadline card with exact course and timestamp', () => {
      const card = document.getElementById('stream-card-2');
      expect(card).not.toBeNull();
      const cardText = card?.textContent?.trim() || '';

      const task = parseDirectStreamCard(cardText);
      expect(task).not.toBeNull();
      expect(task?.courseName).toBe('Islamic Culture');
      expect(task?.courseCode).toBe('0104100');
      expect(task?.title).toContain('كويز 1');
      expect(task?.dueDate).toBe('2026-10-12T06:00:00.000Z'); // 10:00 AM UTC+4 -> 06:00 UTC
    });

    it('ignores submission confirmations and receipts as non-deadlines', () => {
      const card = document.getElementById('stream-card-3');
      const cardText = card?.textContent || '';
      const isSubmission = /(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم)/i.test(cardText);
      expect(isSubmission).toBe(true);

      const parsed = parseDirectStreamCard(cardText);
      expect(parsed).toBeNull();
    });

    it('ignores grade posted notifications as non-deadlines', () => {
      const card = document.getElementById('stream-card-4');
      const cardText = card?.textContent || '';
      const isGraded = /(?:grade\s+posted|score\s+posted|تم\s+نشر\s+الدرجة)/i.test(cardText);
      expect(isGraded).toBe(true);

      const parsed = parseDirectStreamCard(cardText);
      expect(parsed).toBeNull();
    });
  });

  describe('Doctor Announcements & Local NLP Deadline Extraction', () => {
    it('extracts deadline and exam room from doctor announcement card', () => {
      const annCard = document.getElementById('stream-card-5');
      expect(annCard).not.toBeNull();

      const bodyText = annCard?.querySelector('.announcement-body')?.textContent?.trim() || '';
      const title = annCard?.querySelector('.js-title-link')?.textContent?.trim() || '';

      const ann = {
        id: 'ann-dom-test-1',
        courseCode: '1502101',
        courseName: 'Introduction to Computer Eng.',
        title,
        postedAt: '2026-10-10T08:00:00Z',
        contentText: bodyText,
        sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
        scannedAt: new Date().toISOString()
      };

      const extracted = extractDeadlinesLocally(ann);
      expect(extracted.length).toBeGreaterThanOrEqual(1);

      const examTask = extracted[0];
      expect(examTask.type).toBe('exam');
      expect(examTask.room).toBe('A8-103');
      expect(examTask.courseName).toBe('Introduction to Computer Eng.');
    });

    it('identifies enrolled courses from page links', () => {
      const links = document.querySelectorAll('a[href*="/ultra/courses/"]');
      const courses: { name: string; code?: string }[] = [];

      links.forEach(link => {
        const text = link.textContent?.trim() || '';
        const parsed = parseCourseDetails(text);
        if (parsed.name && parsed.name !== 'General Course') {
          courses.push({ name: parsed.name, code: parsed.code });
        }
      });

      expect(courses.length).toBeGreaterThanOrEqual(3);
      expect(courses.some(c => c.name.includes('Calculus'))).toBe(true);
      expect(courses.some(c => c.name.includes('Islamic'))).toBe(true);
      expect(courses.some(c => c.name.includes('Computer'))).toBe(true);
    });
  });
});
