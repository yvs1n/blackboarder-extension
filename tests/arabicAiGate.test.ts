import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractDeadlinesHybridDetailed, hasAcademicKeywords } from '../src/engine/hybridExtractor';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import * as aiExtractor from '../src/engine/aiExtractor';
import * as localExtractor from '../src/engine/localExtractor';
import { Announcement, DEFAULT_SETTINGS } from '../src/types';

function ann(title: string, contentText: string): Announcement {
  return {
    id: 'ann_test_1',
    courseCode: 'ISL101',
    courseName: 'Islamic Culture',
    title,
    contentText,
    sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
    scannedAt: new Date().toISOString()
  };
}

const aiSettings = {
  ...DEFAULT_SETTINGS,
  useAiExtraction: true,
  openRouterApiKey: 'test-key'
};

describe('AI keyword gate handles Arabic', () => {
  afterEach(() => vi.restoreAllMocks());

  it('recognises Arabic assessment words, which \\b never matched', () => {
    expect(hasAcademicKeywords('إعلان: عروض الطلاب يوم الأحد')).toBe(true);
    expect(hasAcademicKeywords('تذكير بموعد تسليم الواجب')).toBe(true);
    expect(hasAcademicKeywords('الاختبار القصير الأسبوع القادم')).toBe(true);
    expect(hasAcademicKeywords('مشروع المادة')).toBe(true);
  });

  it('recognises English words the gate used to miss', () => {
    expect(hasAcademicKeywords('Group presentations next week')).toBe(true);
    expect(hasAcademicKeywords('Test 2 on Monday')).toBe(true);
    expect(hasAcademicKeywords('Submit your report')).toBe(true);
  });

  it('still lets plain notices through without calling AI', () => {
    expect(hasAcademicKeywords('Welcome to the semester')).toBe(false);
    expect(hasAcademicKeywords('مرحبا بكم في الفصل الدراسي')).toBe(false);
  });

  it('sends an Arabic presentations announcement to the AI', async () => {
    vi.spyOn(localExtractor, 'extractDeadlinesLocally').mockReturnValue([]);
    const spyAi = vi.spyOn(aiExtractor, 'extractDeadlinesWithAi').mockResolvedValue([]);
    await extractDeadlinesHybridDetailed(ann('إعلان: عروض الطلاب', 'ستكون عروض الطلاب يوم الأحد القادم في القاعة'), aiSettings);
    expect(spyAi).toHaveBeenCalledTimes(1);
  });
});

describe('presentations are not turned into tasks by the local parser', () => {
  it('leaves an Arabic presentations announcement to the AI instead of making a "Meeting"', () => {
    const tasks = extractDeadlinesLocally(ann('إعلان: عروض الطلاب', 'عروض الطلاب يوم 2026-11-05 الساعة 10:00 صباحاً'));
    expect(tasks).toHaveLength(0);
  });
});
