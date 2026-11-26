// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractSharedPreferencesFromSettings,
  pickNewerSharedPreferences,
  sanitizeSharedPreferences,
  sharedPreferencesToSettingsPatch,
} from '../../src/core/sharedPreferences';
import { mergeForCloudWrite } from '../../src/utils/sync/syncMerge';
import { unwrapCloudVault, wrapCloudVault } from '../../src/utils/sync/vaultCrypto';
import { discoverAndExtractBlackboardSyllabi } from '../../src/scan/syllabusScanner';
import {
  buildCalibrationCourseDrafts,
  readCalibrationCourses,
  renderCalibrationAiSetupHtml,
  renderCalibrationCourseCardHtml,
} from '../../src/core/calibrationWizard';
import { DEFAULT_SETTINGS, type UserCourseConfig } from '../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Cross-device shared preferences sync (Extension <-> Companion)', () => {
  it('extracts and applies only shared cross-device settings while excluding local-only AI keys and autoScan', () => {
    const prefs = extractSharedPreferencesFromSettings(
      {
        ...DEFAULT_SETTINGS,
        language: 'ar',
        theme: 'dark',
        showClassesInCalendar: false,
        showPaymentsInCalendar: true,
        reminderHoursBefore: 12,
        classReminderMinutes: 30,
        openRouterApiKey: 'sk-or-v1-secret',
        autoScanOnPageLoad: false,
      },
      'classes',
      '2026-11-26T15:00:00.000Z'
    );

    expect(prefs).toEqual({
      language: 'ar',
      theme: 'dark',
      showClassesInCalendar: false,
      showPaymentsInCalendar: true,
      calendarFeedShow: 'classes',
      reminderHoursBefore: 12,
      classReminderMinutes: 30,
      updatedAt: '2026-11-26T15:00:00.000Z',
    });
    expect((prefs as any).openRouterApiKey).toBeUndefined();
    expect((prefs as any).autoScanOnPageLoad).toBeUndefined();

    const patch = sharedPreferencesToSettingsPatch(prefs);
    expect(patch).toEqual({
      language: 'ar',
      theme: 'dark',
      showClassesInCalendar: false,
      showPaymentsInCalendar: true,
      reminderHoursBefore: 12,
      classReminderMinutes: 30,
    });

    expect(sanitizeSharedPreferences({ language: 'fr', theme: 'neon', reminderHoursBefore: -5 })).toBeUndefined();
    expect(sanitizeSharedPreferences({ language: 'fr', theme: 'dark', reminderHoursBefore: -5 })).toEqual({
      theme: 'dark',
    });
  });

  it('picks newer preferences by updatedAt in mergeForCloudWrite and preserves them inside AES-256-GCM vaults', async () => {
    const olderLocal = {
      language: 'en' as const,
      theme: 'light' as const,
      showClassesInCalendar: true,
      updatedAt: '2026-11-26T10:00:00.000Z',
    };
    const newerCloud = {
      language: 'ar' as const,
      theme: 'dark' as const,
      showPaymentsInCalendar: false,
      updatedAt: '2026-11-26T12:00:00.000Z',
    };

    const picked = pickNewerSharedPreferences(olderLocal, newerCloud);
    expect(picked.fromCloud).toBe(true);
    expect(picked.preferences?.language).toBe('ar');
    expect(picked.preferences?.theme).toBe('dark');
    expect(picked.preferences?.showClassesInCalendar).toBe(true);

    const merged = mergeForCloudWrite(
      { tasks: [], preferences: olderLocal },
      { tasks: [], preferences: newerCloud }
    );
    expect(merged.preferencesFromCloud).toBe(true);
    expect(merged.preferences?.language).toBe('ar');
    expect(merged.preferences?.showPaymentsInCalendar).toBe(false);

    const syncKey = 'BBS-TESTSYNCKEY999999999999';
    const vaultDoc = await wrapCloudVault(
      {
        tasks: [],
        courses: [],
        preferences: merged.preferences,
        lastSync: '2026-11-26T12:05:00.000Z',
      },
      syncKey
    );
    expect(typeof vaultDoc.vault).toBe('string');
    const unwrapped = await unwrapCloudVault(vaultDoc, syncKey);
    expect(unwrapped.preferences).toEqual(merged.preferences);
  });
});

describe('First-scan syllabus discovery local fallback & Calibration Wizard', () => {
  const jsonOk = (data: unknown) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  it('supports allowLocalFallback without an AI key while keeping default Scan Syllabi gated', async () => {
    const fetchFn = vi.fn(async (path: string) => {
      if (path === '/learn/api/v1/users/me') {
        return jsonOk({ id: '_u1' });
      }
      if (path.startsWith('/learn/api/public/v1/users/me/courses')) {
        return jsonOk({
          results: [
            { courseId: '_50_1', course: { name: 'Linear Algebra', courseId: 'MATH204_FALL26' } }
          ]
        });
      }
      if (path.includes('/courses/_50_1/contents?recursive=true')) {
        return jsonOk({
          results: [
            {
              id: '_syl_doc',
              title: 'Course Syllabus',
              body: '<p>MATH 204 Linear Algebra</p><p>Credit Hours: 3</p><p>Mon Wed 10:00 - 11:15 M9-105</p><ul><li>Quizzes 20%</li><li>Midterm Exam 30%</li><li>Final Exam 50%</li></ul>',
              contentHandler: { id: 'resource/x-bb-document' }
            }
          ]
        });
      }
      return jsonOk({ results: [] });
    });

    const gated = await discoverAndExtractBlackboardSyllabi({
      origin: 'https://elearning.sharjah.ac.ae',
      fetchFn,
      ai: null,
    });
    expect(gated.ok).toBe(false);
    expect(gated.skippedReason).toBe('no-ai-key');
    expect(fetchFn).not.toHaveBeenCalled();

    const localRes = await discoverAndExtractBlackboardSyllabi({
      origin: 'https://elearning.sharjah.ac.ae',
      fetchFn,
      ai: null,
      allowLocalFallback: true,
    });
    expect(localRes.ok).toBe(true);
    expect(localRes.courses.length).toBe(1);
    expect(localRes.courses[0].courseCode.replace(/\s+/g, '')).toBe('MATH204');
    expect(localRes.courses[0].syllabus.some(s => s.totalWeight === 50)).toBe(true);
  });

  it('renders editable course/AI calibration UI and reads back schedules, quiz counts & best-N-of-M rules', () => {
    const existing: UserCourseConfig[] = [
      {
        id: 'course_phys',
        courseCode: 'PHYS101',
        courseName: '0403101 Physics 1_FALL26',
        creditHours: 4,
        colorHex: '#0284c7',
        aliases: [],
        scheduleSlots: [],
        syllabus: [],
      }
    ];

    const drafts = buildCalibrationCourseDrafts(existing, [
      {
        courseCode: 'PHYS101',
        courseName: 'Physics 1',
        creditHours: 4,
        scheduleSlots: [{ days: ['sun', 'tue'], startTime: '08:00', endTime: '09:15', room: 'W8-101' }],
        syllabus: [
          { id: 'q', name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 4, outOf: 5 },
          { id: 'f', name: 'Final Exam', type: 'exam', totalWeight: 80 },
        ],
      }
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].scheduleSlots).toHaveLength(1);
    expect(drafts[0].syllabus[0]).toMatchObject({ count: 4, outOf: 5, totalWeight: 20 });

    const container = document.createElement('div');
    container.innerHTML =
      renderCalibrationAiSetupHtml(DEFAULT_SETTINGS, 'en') +
      drafts.map((c, idx) => renderCalibrationCourseCardHtml(c, idx, 'en')).join('');

    expect(container.querySelector('#cal-ai-key-input')).not.toBeNull();
    expect(container.querySelector('#btn-cal-test-save-ai')).not.toBeNull();
    expect(container.querySelector('.cal-weight-total-pill')?.textContent).toContain('100% / 100%');

    // Simulate user adjusting course title and room
    const nameInput = container.querySelector<HTMLInputElement>('.cal-course-name')!;
    const roomInput = container.querySelector<HTMLInputElement>('.cal-slot-room')!;
    nameInput.value = 'General Physics I';
    roomInput.value = 'M4-210';

    const confirmed = readCalibrationCourses(container, existing);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].courseName).toBe('General Physics I');
    expect(confirmed[0].scheduleSlots[0].room).toBe('M4-210');
    expect(confirmed[0].syllabus[0]).toMatchObject({
      count: 4,
      outOf: 5,
      totalWeight: 20,
      unitWeight: 5,
    });
  });
});
