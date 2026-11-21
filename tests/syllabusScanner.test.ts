import { describe, it, expect, vi } from 'vitest';
import {
  discoverAndExtractBlackboardSyllabi,
  scoreSyllabusIndicator,
  shouldAutoScanSyllabiOnFirstScan
} from '../src/scan/syllabusScanner';
import type { AiEndpoint } from '../src/engine/aiProviders';
import type { CourseDraft } from '../src/core/courseDocument';

const MOCK_AI: AiEndpoint = {
  provider: 'openrouter',
  chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: 'sk-test-key',
  model: 'google/gemini-3.8-flash'
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Blackboard Syllabus Auto-Discovery', () => {
  it('enforces first-scan-only and AI-key gates in shouldAutoScanSyllabiOnFirstScan', () => {
    const missingCourse = [{ syllabus: [] }];
    const completeCourse = [{ syllabus: [{ id: '1', name: 'Final', type: 'exam' as const, totalWeight: 100 }] }];

    expect(shouldAutoScanSyllabiOnFirstScan({ firstScanDone: false, aiEndpoint: null, courses: missingCourse, scanSucceeded: true })).toBe(false);
    expect(shouldAutoScanSyllabiOnFirstScan({ firstScanDone: true, aiEndpoint: MOCK_AI, courses: missingCourse, scanSucceeded: true })).toBe(false);
    expect(shouldAutoScanSyllabiOnFirstScan({ firstScanDone: false, aiEndpoint: MOCK_AI, courses: missingCourse, scanSucceeded: false })).toBe(false);
    expect(shouldAutoScanSyllabiOnFirstScan({ firstScanDone: false, aiEndpoint: MOCK_AI, courses: completeCourse, scanSucceeded: true })).toBe(false);
    expect(shouldAutoScanSyllabiOnFirstScan({ firstScanDone: false, aiEndpoint: MOCK_AI, courses: missingCourse, scanSucceeded: true })).toBe(true);
  });

  it('scores syllabus filenames accurately and ignores unsupported binary formats', () => {
    expect(scoreSyllabusIndicator('RES691 Course Syllabus.pdf', 'application/pdf')).toBeGreaterThan(10);
    expect(scoreSyllabusIndicator('خطة المساق وتوزيع الدرجات.docx')).toBeGreaterThan(8);
    expect(scoreSyllabusIndicator('Lecture 01 Slides.pdf')).toBe(0);
    expect(scoreSyllabusIndicator('Syllabus Walkthrough Video.mp4')).toBe(0);
  });

  it('refuses to crawl Blackboard when no AI key is configured', async () => {
    const fetchFn = vi.fn();
    const res = await discoverAndExtractBlackboardSyllabi({
      origin: 'https://blackboard.buid.ac.ae',
      fetchFn,
      ai: null
    });

    expect(res.ok).toBe(false);
    expect(res.skippedReason).toBe('no-ai-key');
    expect(res.courses).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('discovers syllabus attachments on enrolled courses, extracts text, runs AI and returns drafts for confirmation', async () => {
    const fetchFn = vi.fn(async (path: string) => {
      if (path === '/learn/api/v1/users/me') {
        return jsonResponse({ id: '_u1', userName: '26000061', displayName: 'Test Scholar' });
      }
      if (path.startsWith('/learn/api/public/v1/users/me/courses')) {
        return jsonResponse({
          results: [
            { courseId: '_10_1', course: { name: 'Qualitative Research Methods and Paradigms', courseId: 'RES691_SEP26' } },
            { courseId: '_99_1', course: { name: 'Library Essentials: Your Complete Student Guide', courseId: 'LIB001' } }
          ]
        });
      }
      if (path.includes('/courses/_10_1/contents?recursive=true')) {
        return jsonResponse({
          results: [
            { id: '_c1', title: 'Week 1 Lecture Slides', contentHandler: { id: 'resource/x-bb-file' } },
            { id: '_c2', title: 'Course Syllabus & Assessment Guide', contentHandler: { id: 'resource/x-bb-file' } }
          ]
        });
      }
      if (path.includes('/courses/_10_1/contents/_c2/attachments')) {
        return jsonResponse({
          results: [
            { id: '_att1', fileName: 'RES691_Syllabus.pdf', mimeType: 'application/pdf' }
          ]
        });
      }
      if (path.includes('/attachments/_att1/download')) {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { 'content-type': 'application/pdf' }
        });
      }
      return jsonResponse({ results: [] }, 404);
    });

    const extractTextFromFile = vi.fn(async (file: File) => {
      expect(file.name).toBe('RES691_Syllabus.pdf');
      return 'Course Syllabus\nCredit Hours: 20\nAssessed Essay 50%\nResearch Proposal 50%';
    });

    const extractWithAi = vi.fn(async (): Promise<CourseDraft[]> => [
      {
        courseCode: '',
        courseName: '',
        creditHours: 20,
        scheduleSlots: [],
        syllabus: [
          { id: 'essay', name: 'Assessed Essay', type: 'assignment', totalWeight: 50 },
          { id: 'proposal', name: 'Research Proposal', type: 'project', totalWeight: 50 }
        ]
      }
    ]);

    const res = await discoverAndExtractBlackboardSyllabi({
      origin: 'https://blackboard.buid.ac.ae',
      fetchFn,
      ai: MOCK_AI,
      extractTextFromFile,
      extractWithAi
    });

    expect(res.ok).toBe(true);
    expect(res.scannedCourses).toBe(1);
    expect(res.matchedFiles).toBe(1);
    expect(res.courses).toHaveLength(1);
    expect(res.courses[0]).toMatchObject({
      courseCode: 'RES691',
      courseName: 'Qualitative Research Methods and Paradigms',
      creditHours: 20
    });
    expect(res.courses[0].syllabus).toHaveLength(2);
  });

  it('extracts inline Blackboard HTML syllabus documents when no file attachment exists', async () => {
    const fetchFn = vi.fn(async (path: string) => {
      if (path === '/learn/api/v1/users/me') {
        return jsonResponse({ id: '_u1' });
      }
      if (path.startsWith('/learn/api/public/v1/users/me/courses')) {
        return jsonResponse({
          results: [
            { courseId: '_20_1', course: { name: 'Mixed Methods Research', courseId: 'RES695_SEP26' } }
          ]
        });
      }
      if (path.includes('/courses/_20_1/contents?recursive=true')) {
        return jsonResponse({
          results: [
            {
              id: '_c9',
              title: 'Course Syllabus',
              body: '<p>Credit hours: 20. Assessment grading breakdown: Portfolio 40% and Final Research Paper 60%. Classes meet Tuesday 18:00-21:00.</p>',
              contentHandler: { id: 'resource/x-bb-document' }
            }
          ]
        });
      }
      if (path.includes('/attachments')) {
        return jsonResponse({ results: [] });
      }
      return jsonResponse({ results: [] }, 404);
    });

    const extractWithAi = vi.fn(async (text: string): Promise<CourseDraft[]> => {
      expect(text).toContain('Portfolio 40%');
      return [{
        courseCode: 'RES 695',
        courseName: 'Mixed Methods Research',
        creditHours: 20,
        scheduleSlots: [],
        syllabus: [
          { id: 'p1', name: 'Portfolio', type: 'project', totalWeight: 40 },
          { id: 'f1', name: 'Final Research Paper', type: 'assignment', totalWeight: 60 }
        ]
      }];
    });

    const res = await discoverAndExtractBlackboardSyllabi({
      origin: 'https://blackboard.buid.ac.ae',
      fetchFn,
      ai: MOCK_AI,
      extractWithAi
    });

    expect(res.ok).toBe(true);
    expect(res.courses).toHaveLength(1);
    expect(res.courses[0].syllabus.map(s => s.totalWeight)).toEqual([40, 60]);
  });
});
