import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isExtensionContextValid,
  saveSettings,
  getTasks,
  saveTasks,
  getLastScanCheckpoint,
  saveLastScanCheckpoint,
  getAnnouncements,
  saveAnnouncements,
  getCachedTasksSync,
  getCachedQuickLinksSync,
  getCachedSettingsSync
} from '../src/utils/storage';
import { extractDeadlinesWithAi } from '../src/engine/aiExtractor';
import { DeadlineTask, Announcement } from '../src/types';

class LocalStorageMock {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] !== undefined ? this.store[key] : null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }
}

describe('Extension Context Validation & Graceful Fallback Suite', () => {
  const originalChrome = (globalThis as any).chrome;
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    (globalThis as any).localStorage = new LocalStorageMock();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  describe('isExtensionContextValid()', () => {
    it('returns false when chrome is undefined', () => {
      delete (globalThis as any).chrome;
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when chrome.runtime is missing or has no id (orphaned context)', () => {
      (globalThis as any).chrome = {
        storage: { local: {} }
      };
      expect(isExtensionContextValid()).toBe(false);

      (globalThis as any).chrome = {
        runtime: {},
        storage: { local: {} }
      };
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when chrome.storage.local is missing', () => {
      (globalThis as any).chrome = {
        runtime: { id: 'test_extension_id' }
      };
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns true when chrome.runtime.id and chrome.storage.local are both present', () => {
      (globalThis as any).chrome = {
        runtime: { id: 'valid_extension_id' },
        storage: { local: { get: vi.fn(), set: vi.fn() } }
      };
      expect(isExtensionContextValid()).toBe(true);
    });

    it('returns false if accessing chrome properties throws an exception', () => {
      (globalThis as any).chrome = {
        get runtime(): any {
          throw new Error('Extension context invalidated.');
        }
      };
      expect(isExtensionContextValid()).toBe(false);
    });
  });

  describe('Storage fallback when extension context is invalidated', () => {
    beforeEach(() => {
      // Clear localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    });

    it('getTasks falls back to localStorage if chrome context is invalid', async () => {
      delete (globalThis as any).chrome;
      const sampleTasks = [
        {
          id: 'task_local_1',
          title: 'Quiz 1',
          courseCode: '1502 101',
          courseName: 'Intro to Comp Eng',
          dueDate: '2026-10-15T10:00:00.000Z',
          hasSpecificTime: true,
          type: 'quiz',
          priority: 'high',
          status: 'pending',
          confidence: 0.9,
          extractedBy: 'local',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ] as unknown as DeadlineTask[];
      localStorage.setItem('bbs_tasks', JSON.stringify(sampleTasks));

      const tasks = await getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task_local_1');
    });

    it('saveTasks does not throw and saves to localStorage if chrome context is invalid', async () => {
      delete (globalThis as any).chrome;
      const sampleTasks = [
        {
          id: 'task_local_2',
          title: 'Midterm',
          courseCode: '1440 133',
          courseName: 'Calculus I',
          dueDate: '2026-11-01T12:30:00.000Z',
          hasSpecificTime: true,
          type: 'exam',
          priority: 'high',
          status: 'pending',
          confidence: 0.95,
          extractedBy: 'local',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ] as unknown as DeadlineTask[];

      await expect(saveTasks(sampleTasks)).resolves.not.toThrow();
      const stored = JSON.parse(localStorage.getItem('bbs_tasks') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('task_local_2');
    });

    it('saveTasks handles chrome.storage.local.set throwing "Extension context invalidated" gracefully', async () => {
      (globalThis as any).chrome = {
        runtime: {
          id: 'test_id',
          sendMessage: vi.fn().mockImplementation(() => {
            throw new Error('Extension context invalidated.');
          })
        },
        storage: {
          local: {
            set: vi.fn().mockImplementation((_data, callback) => {
              // Simulating callback being called, but context gets invalidated during callback
              callback();
            })
          }
        }
      };

      const tasks = [
        {
          id: 'task_throw_test',
          title: 'Physics Lab',
          courseCode: '1430 116',
          courseName: 'Physics 1 Lab',
          dueDate: '2026-10-20T14:00:00.000Z',
          hasSpecificTime: true,
          type: 'lab',
          priority: 'medium',
          status: 'pending',
          confidence: 0.9,
          extractedBy: 'local',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ] as unknown as DeadlineTask[];

      await expect(saveTasks(tasks)).resolves.not.toThrow();
    });

    it('getLastScanCheckpoint and saveLastScanCheckpoint fall back safely', async () => {
      delete (globalThis as any).chrome;
      const initial = await getLastScanCheckpoint();
      expect(initial.processedAnnouncementIds).toEqual([]);

      await saveLastScanCheckpoint({
        lastScannedAt: '2026-09-28T10:00:00.000Z',
        processedAnnouncementIds: ['ann_1', 'ann_2'],
        processedDirectTaskIds: ['direct_1']
      });

      const updated = await getLastScanCheckpoint();
      expect(updated.lastScannedAt).toBe('2026-09-28T10:00:00.000Z');
      expect(updated.processedAnnouncementIds).toContain('ann_1');
      expect(updated.processedDirectTaskIds).toContain('direct_1');
    });

    it('getAnnouncements and saveAnnouncements fall back safely', async () => {
      delete (globalThis as any).chrome;
      const sampleAnn: Announcement = {
        id: 'ann_test_fallback',
        courseCode: '1502 101',
        courseName: 'Intro to Comp Eng',
        title: 'Exam Room Announcement',
        postedAt: '2026-09-28T08:00:00.000Z',
        contentText: 'Exam will be in A8-103',
        sourceUrl: 'https://elearning.sharjah.ac.ae',
        scannedAt: new Date().toISOString()
      };

      await saveAnnouncements([sampleAnn]);
      const stored = await getAnnouncements();
      expect(stored.some(a => a.id === 'ann_test_fallback')).toBe(true);
    });
  });

  describe('Content Script Engine Messaging Resilience', () => {
    it('extractDeadlinesWithAi falls back gracefully when extension context is invalidated in content script', async () => {
      (globalThis as any).window = {
        location: {
          protocol: 'https:',
          origin: 'https://elearning.sharjah.ac.ae'
        }
      };

      // Invalidate extension context
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: vi.fn().mockImplementation(() => {
            throw new Error('Extension context invalidated.');
          })
        }
      };

      const announcement: Announcement = {
        id: 'ann_ai_test',
        courseCode: '1440 133',
        courseName: 'Calculus I',
        title: 'Quiz 2',
        postedAt: '2026-09-28T08:00:00.000Z',
        contentText: 'Quiz 2 will be held on October 15 at 12:30 PM',
        sourceUrl: 'https://elearning.sharjah.ac.ae',
        scannedAt: new Date().toISOString()
      };

      // Global fetch mock to avoid real network call during test
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  deadlines: [
                    {
                      title: 'Quiz 2',
                      dueDate: '2026-10-15T12:30:00',
                      hasSpecificTime: true,
                      type: 'quiz',
                      priority: 'medium',
                      room: null,
                      description: 'Quiz 2',
                      sourceSnippet: 'Quiz 2 will be held on October 15 at 12:30 PM'
                    }
                  ]
                })
              }
            }
          ]
        })
      } as any);

      try {
        const tasks = await extractDeadlinesWithAi(announcement, 'dummy_openrouter_key');
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Quiz 2');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Instant Synchronous Cache Retrieval for Zero-Lag Popup Render', () => {
    it('getCachedTasksSync returns tasks synchronously without awaiting async promises', async () => {
      const mockTask = {
        id: 't_cached_1',
        title: 'Cached Lab',
        courseName: 'Embedded Systems',
        dueDate: '2026-10-20T10:00:00.000Z',
        type: 'lab',
        priority: 'high',
        status: 'pending'
      } as unknown as DeadlineTask;

      // Initially empty
      expect(getCachedTasksSync()).toEqual([]);

      // Save tasks
      await saveTasks([mockTask]);

      // Synchronously retrieved
      const cached = getCachedTasksSync();
      expect(cached).toHaveLength(1);
      expect(cached[0].id).toBe('t_cached_1');
      expect(cached[0].title).toBe('Cached Lab');
    });

    it('getCachedQuickLinksSync returns default quick links or saved links synchronously', () => {
      expect(getCachedQuickLinksSync().length).toBeGreaterThan(0);
    });

    it('getCachedSettingsSync returns settings synchronously', async () => {
      await saveSettings({ theme: 'dark' });
      const cached = getCachedSettingsSync();
      expect(cached.theme).toBe('dark');
    });
  });
});

