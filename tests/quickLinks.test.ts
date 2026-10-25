import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_QUICK_LINKS,
  QuickLink
} from '../src/types';
import {
  getQuickLinks,
  saveQuickLinks,
  addQuickLink,
  updateQuickLink,
  deleteQuickLink,
  resetQuickLinksToDefault
} from '../src/utils/storage';
import { pushTasksToFirebase, fetchTasksFromFirebase, FIREBASE_DB_URL } from '../src/utils/firebaseSync';

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

describe('Academic Quick Links Management & Sync', () => {
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    (globalThis as any).localStorage = new LocalStorageMock();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('provides sensible default academic quick links out of the box', () => {
    expect(DEFAULT_QUICK_LINKS).toHaveLength(4);
    const categories = DEFAULT_QUICK_LINKS.map(l => l.category);
    expect(categories).toContain('attendance');
    expect(categories).toContain('study_plan');
    expect(categories).toContain('marks');
    expect(categories).toContain('portal');

    const attendanceLink = DEFAULT_QUICK_LINKS.find(l => l.category === 'attendance');
    expect(attendanceLink?.url).toContain('banner.sharjah.ac.ae');
  });

  it('getQuickLinks falls back to DEFAULT_QUICK_LINKS when storage is empty', async () => {
    const links = await getQuickLinks();
    expect(links).toHaveLength(4);
    expect(links[0].title).toBe(DEFAULT_QUICK_LINKS[0].title);
  });

  it('addQuickLink adds a new item and auto-prefixes protocol if omitted', async () => {
    const initial = await getQuickLinks();
    const updated = await addQuickLink({
      title: 'Academic Advising',
      url: 'banner.sharjah.ac.ae/advising',
      category: 'other'
    });

    expect(updated.length).toBe(initial.length + 1);
    const added = updated.find(l => l.title === 'Academic Advising');
    expect(added).toBeDefined();
    expect(added?.url).toBe('https://banner.sharjah.ac.ae/advising');
    expect(added?.id).toBeDefined();
    expect(added?.createdAt).toBeDefined();
  });

  it('updateQuickLink modifies existing properties while retaining id and createdAt', async () => {
    const links = await getQuickLinks();
    const first = links[0];
    const originalCreatedAt = first.createdAt;

    const updatedList = await updateQuickLink(first.id, {
      title: 'Updated Attendance Portal',
      url: 'https://banner.sharjah.ac.ae/new_attendance'
    });

    const updated = updatedList.find(l => l.id === first.id);
    expect(updated?.title).toBe('Updated Attendance Portal');
    expect(updated?.url).toBe('https://banner.sharjah.ac.ae/new_attendance');
    expect(updated?.createdAt).toBe(originalCreatedAt);
    expect(updated?.updatedAt).toBeDefined();
  });

  it('deleteQuickLink removes the item by ID', async () => {
    const initial = await getQuickLinks();
    const targetId = initial[0].id;

    const remaining = await deleteQuickLink(targetId);
    expect(remaining.length).toBe(initial.length - 1);
    expect(remaining.find(l => l.id === targetId)).toBeUndefined();
  });

  it('resetQuickLinksToDefault resets custom links back to default presets', async () => {
    // Save custom link
    await saveQuickLinks([{
      id: 'custom-only',
      title: 'Custom Portal',
      url: 'https://example.com',
      category: 'other',
      createdAt: new Date().toISOString()
    }]);
    const customLinks = await getQuickLinks();
    expect(customLinks).toHaveLength(1);
    expect(customLinks[0].title).toBe('Custom Portal');

    const resetLinks = await resetQuickLinksToDefault();
    expect(resetLinks).toHaveLength(4);
    expect(resetLinks.map(l => l.id)).toEqual(DEFAULT_QUICK_LINKS.map(l => l.id));
  });

  it('pushTasksToFirebase includes quickLinks in the cloud payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const customLinks: QuickLink[] = [
      {
        id: 'ql-custom-1',
        title: 'Sharjah Portal',
        url: 'https://my.sharjah.ac.ae',
        category: 'portal',
        createdAt: '2026-10-01T00:00:00.000Z'
      }
    ];

    await pushTasksToFirebase([], 'Extension Test', undefined, customLinks);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${FIREBASE_DB_URL}/data.json`,
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"quickLinks"')
      })
    );

    const callArgs = fetchSpy.mock.calls[0];
    const bodyObj = JSON.parse(callArgs[1]?.body as string);
    expect(bodyObj.quickLinks).toBeDefined();
    expect(bodyObj.quickLinks[0].title).toBe('Sharjah Portal');

    fetchSpy.mockRestore();
  });

  it('fetchTasksFromFirebase parses quickLinks from the cloud response', async () => {
    const cloudPayload = {
      tasks: [],
      quickLinks: [
        {
          id: 'ql_cloud_1',
          title: 'Cloud Attendance',
          url: 'https://banner.sharjah.ac.ae',
          category: 'attendance',
          createdAt: '2026-10-01T00:00:00.000Z'
        }
      ],
      lastSync: '2026-10-01T12:00:00.000Z',
      device: 'Mobile Web App'
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(cloudPayload), { status: 200 })
    );

    const res = await fetchTasksFromFirebase();
    expect(res.quickLinks).toBeDefined();
    expect(res.quickLinks).toHaveLength(1);
    expect(res.quickLinks?.[0].title).toBe('Cloud Attendance');
  });
});
