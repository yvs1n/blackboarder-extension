// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeTaskTranslationSig,
  localizedTaskView,
  syncArabicMirrorOnTask,
  translateTaskTitleToArabic,
} from '../src/core/arabicTranslator';
import { translateTasksToArabicWithAi } from '../src/engine/aiTranslator';
import { translateStaticUiElements } from '../src/core/i18n';
import type { DeadlineTask } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  document.body.innerHTML = '';
});

function sampleTask(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 'task_1',
    courseCode: '0402202',
    courseName: '0402202 Calculus 1',
    type: 'quiz',
    title: 'Quiz 2',
    dueDate: '2026-12-01T10:00:00.000Z',
    hasSpecificTime: true,
    room: 'W8-102',
    weight: 5,
    weightDisplay: '5% of course',
    description: 'Quiz 2 covers Chapter 3.\n\n[Professor Update]:\nMoved to room M3-110 at 11:00 AM.',
    sourceSnippet: 'Quiz 2 covers Chapter 3. Moved to room M3-110 at 11:00 AM.',
    priority: 'medium',
    confidence: 0.95,
    status: 'pending',
    extractedBy: 'local',
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    summary: {
      brief: 'Covers Chapter 3',
      topics: 'Derivatives and limits',
      formatRules: 'Calculators allowed',
    },
    ...overrides,
  };
}

describe('Bilingual Arabic mirrors and runtime i18n RTL switching', () => {
  it('builds offline Arabic mirrors preserving course codes, professor updates, and rooms', () => {
    const task = sampleTask();
    const mirrored = syncArabicMirrorOnTask(task);

    expect(mirrored.ar).toBeDefined();
    expect(mirrored.ar?.translatedBy).toBe('local');
    expect(mirrored.ar?.sourceSig).toBe(computeTaskTranslationSig(task));
    expect(mirrored.ar?.title).toContain('كويز');
    expect(mirrored.ar?.title).toContain('2');
    expect(mirrored.ar?.description).toContain('[تحديث الأستاذ]:');
    expect(mirrored.ar?.room).toContain('W8-102');
    expect(translateTaskTitleToArabic('Final Exam', 'exam')).toContain('الامتحان النهائي');
  });

  it('refreshes the Arabic mirror automatically when an English announcement receives a new update', () => {
    const initial = syncArabicMirrorOnTask(sampleTask());
    const initialSig = initial.ar?.sourceSig;

    // Pretend an AI mirror was stored for version 1 of the announcement
    const withAiMirror: DeadlineTask = {
      ...initial,
      ar: {
        ...initial.ar!,
        title: 'اختبار قصير 2',
        translatedBy: 'ai',
      },
    };

    // Calling sync with no changes keeps existing AI mirror intact
    const unchanged = syncArabicMirrorOnTask(withAiMirror);
    expect(unchanged.ar?.title).toBe('اختبار قصير 2');
    expect(unchanged.ar?.translatedBy).toBe('ai');

    // Professor posts a room & time update
    const updatedTask = syncArabicMirrorOnTask({
      ...withAiMirror,
      room: 'W9-204',
      description: withAiMirror.description + '\n\n[Professor Update]: Quiz moved to W9-204.',
    });

    expect(updatedTask.ar?.sourceSig).not.toBe(initialSig);
    expect(updatedTask.ar?.room).toContain('W9-204');
    expect(updatedTask.ar?.description).toContain('W9-204');
    expect(updatedTask.ar?.translatedBy).toBe('local');
  });

  it('localizedTaskView swaps cleanly between English and Arabic views without mutating source English', () => {
    const task = syncArabicMirrorOnTask(sampleTask());
    const enView = localizedTaskView(task, 'en');
    const arView = localizedTaskView(task, 'ar');

    expect(enView.title).toBe('Quiz 2');
    expect(enView.room).toBe('W8-102');
    expect(arView.title).toBe(task.ar?.title);
    expect(arView.weightDisplay).not.toBe('');
  });

  it('batches AI Arabic translations through server proxy or direct endpoints with safe offline fallback', async () => {
    const task1 = syncArabicMirrorOnTask(sampleTask({ id: 't_needs_ai' }));
    const sig1 = computeTaskTranslationSig(task1);
    const task2 = syncArabicMirrorOnTask({
      ...sampleTask({ id: 't_already_ai' }),
      ar: {
        title: 'اختبار سابق مترجم بالذكاء الاصطناعي',
        translatedBy: 'ai',
        sourceSig: computeTaskTranslationSig(sampleTask({ id: 't_already_ai' })),
        updatedAt: '2026-11-26T00:00:00.000Z',
      },
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: 't_needs_ai',
                  title: 'الاختبار القصير الثاني في التفاضل',
                  courseName: '0402202 التفاضل والتكامل 1',
                  brief: 'يغطي الفصل الثالث',
                  topics: 'المشتقات والنهايات',
                  formatRules: 'يُسمح بالآلة الحاسبة',
                  description: 'يشمل الفصل الثالث.\n\n[تحديث الأستاذ]: نُقل إلى القاعة M3-110.'
                }
              ]
            })
          }
        }]
      }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await translateTasksToArabicWithAi([task1, task2], {
      provider: 'server',
      chatUrl: 'https://example.test/api/ai/extract',
      apiKey: '',
      model: '',
      syncKey: 'BBS-TESTKEY',
      aiPass: 'pass-123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const reqBody = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(reqBody.syncKey).toBe('BBS-TESTKEY');
    expect(reqBody.aiPass).toBe('pass-123');
    // Only t_needs_ai (local mirror) was sent; up-to-date AI mirror skipped
    expect(reqBody.messages[1].content).toContain('t_needs_ai');
    expect(reqBody.messages[1].content).not.toContain('t_already_ai');

    const updated = out.find(t => t.id === 't_needs_ai');
    expect(updated?.ar?.translatedBy).toBe('ai');
    expect(updated?.ar?.sourceSig).toBe(sig1);
    expect(updated?.ar?.title).toBe('الاختبار القصير الثاني في التفاضل');

    // Network failure keeps existing offline mirror intact
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const fallbackOut = await translateTasksToArabicWithAi([task1], {
      provider: 'openrouter',
      chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'google/gemini-3.8-flash',
    });
    expect(fallbackOut[0].ar?.title).toBe(task1.ar?.title);
  });

  it('switches static DOM labels and RTL/LTR attributes via translateStaticUiElements', () => {
    document.body.innerHTML = `
      <button id="tab-nav-calendar"><span>Calendar</span></button>
      <button id="tab-nav-details"><span>Deadlines</span></button>
      <button id="btn-scan-syllabi"><span>Scan Syllabi</span></button>
      <button id="btn-calibrate-courses"><span>Calibrate</span></button>
      <h3 id="calibration-modal-title">Calibrate Courses &amp; AI Setup</h3>
      <button id="btn-calibration-skip">Skip for Now</button>
      <button id="btn-calibration-confirm">Confirm &amp; Start Using Blackboarder</button>
    `;

    translateStaticUiElements(document, 'ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('#tab-nav-calendar > span:first-of-type')?.textContent).toBe('التقويم');
    expect(document.querySelector('#btn-scan-syllabi span')?.textContent).toBe('مسح خطط المساقات');
    expect(document.querySelector('#btn-calibrate-courses span')?.textContent).toBe('معايرة المساقات');
    expect(document.querySelector('#calibration-modal-title')?.textContent).toBe('معايرة المساقات وإعداد الذكاء الاصطناعي');
    expect(document.querySelector('#btn-calibration-confirm')?.textContent).toBe('تأكيد والبدء في الاستخدام');

    translateStaticUiElements(document, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.querySelector('#tab-nav-calendar > span:first-of-type')?.textContent).toBe('Calendar');
    expect(document.querySelector('#btn-calibrate-courses span')?.textContent).toBe('Calibrate');
  });
});
