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
  resetQuickLinksToDefault,
  moveQuickLink,
  reorderQuickLinks
} from '../src/utils/storage';
import { pushTasksToFirebase, fetchTasksFromFirebase, FIREBASE_DB_URL } from '../src/utils/firebaseSync';
import { universityQuickLinks, quickLinkPreset } from '../src/core/universities';
import { quickLinkMeta, quickLinkIconHtml, QUICK_LINK_ICONS, getQuickLinkIconList, reorderQuickLinksList } from '../src/utils/quickLinkMeta';

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

  it('a new install has no quick links: each student adds their own', async () => {
    expect(DEFAULT_QUICK_LINKS).toEqual([]);
    expect(await getQuickLinks()).toEqual([]);
  });

  it('only UOS has built-in links (checked to be right); the rest start empty', () => {
    const uos = universityQuickLinks('uos', '2026-10-27T00:00:00.000Z');
    expect(uos.map(l => l.category).sort()).toEqual(['attendance', 'marks', 'other', 'portal', 'study_plan']);
    expect(uos.find(l => l.category === 'attendance')?.url).toContain('banner.sharjah.ac.ae');
    expect(uos.find(l => l.id === 'ql-exams')?.url).toContain('StudentExamPage');
    for (const id of ['uaeu', 'adu', 'zu', 'aud', 'aus', 'aurak', 'other']) {
      expect(universityQuickLinks(id, 'x')).toEqual([]);
    }
  });

  it('the + Attendance style buttons never fill in another university\'s address', () => {
    expect(quickLinkPreset('uos', 'attendance').url).toContain('banner.sharjah.ac.ae');
    expect(quickLinkPreset('zu', 'attendance')).toEqual({ title: 'Attendance', url: '', category: 'attendance' });
    expect(quickLinkPreset('other', 'portal').url).toBe('');
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
    await saveQuickLinks(universityQuickLinks('uos', '2026-09-01T00:00:00.000Z'));
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
    await saveQuickLinks(universityQuickLinks('uos', '2026-09-01T00:00:00.000Z'));
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

    const resetLinks = await resetQuickLinksToDefault('uos');
    expect(resetLinks).toHaveLength(5);
    expect(resetLinks.map(l => l.id)).toEqual(universityQuickLinks('uos', 'x').map(l => l.id));
    // Elsewhere a reset leaves none
    expect(await resetQuickLinksToDefault('zu')).toEqual([]);
  });

  it('pushTasksToFirebase includes quickLinks in the cloud payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('null', { status: 200 })) // the cloud copy, read first
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const customLinks: QuickLink[] = [
      {
        id: 'ql-custom-1',
        title: 'Sharjah Portal',
        url: 'https://my.sharjah.ac.ae',
        category: 'portal',
        createdAt: '2026-10-01T00:00:00.000Z'
      }
    ];

    await pushTasksToFirebase([], 'Extension Test', 'BBS-TESTKEY1', customLinks);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${FIREBASE_DB_URL}/users/BBS-TESTKEY1/data.json`,
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"quickLinks"')
      })
    );

    const callArgs = fetchSpy.mock.calls[1];
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

    const res = await fetchTasksFromFirebase('BBS-TESTKEY1');
    expect(res.quickLinks).toBeDefined();
    expect(res.quickLinks).toHaveLength(1);
    expect(res.quickLinks?.[0].title).toBe('Cloud Attendance');
  });

  it('quickLinkIconHtml generates valid, self-contained SVG for all categories and fallbacks', () => {
    const categories = ['attendance', 'study_plan', 'marks', 'portal', 'other'] as const;
    for (const cat of categories) {
      const meta = quickLinkMeta(cat);
      expect(meta.label).toBeDefined();
      expect(meta.icon).toBeDefined();
      expect(meta.badgeClass).toBe(`ql-cat-${cat}`);

      const html = quickLinkIconHtml(cat, 'test-icon-class');
      expect(html).toContain('<svg class="ui-icon test-icon-class"');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('fill="none"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('</svg>');
      // Must contain actual vector elements, not be empty
      expect(html).toMatch(/<(path|circle|line)/);
    }

    // Portal specifically contains circle and path for globe
    const portalHtml = quickLinkIconHtml('portal');
    expect(portalHtml).toContain('<circle');

    // Unknown category falls back cleanly to 'other' without throwing
    const fallbackHtml = quickLinkIconHtml('unknown_category' as any);
    expect(fallbackHtml).toContain('<svg class="ui-icon ql-icon"');
    expect(fallbackHtml).toContain('<path');

    // Undefined category falls back cleanly
    const undefHtml = quickLinkIconHtml(undefined);
    expect(undefHtml).toContain('<svg class="ui-icon ql-icon"');
  });

  it('supports selecting and rendering icons from the quick links icon library', async () => {
    const iconList = getQuickLinkIconList();
    expect(iconList.length).toBe(20);
    for (const icon of iconList) {
      expect(icon.id).toBeDefined();
      expect(icon.label).toBeDefined();
      expect(icon.path).toBeDefined();
      expect(QUICK_LINK_ICONS[icon.id]).toBeDefined();
    }

    // Adding link with custom icon preserves icon field
    const added = await addQuickLink({
      title: 'Lab Server',
      url: 'https://lab.sharjah.ac.ae',
      category: 'other',
      icon: 'laptop'
    });
    const labLink = added.find(l => l.title === 'Lab Server');
    expect(labLink?.icon).toBe('laptop');

    // quickLinkIconHtml renders custom icon if specified
    const customHtml = quickLinkIconHtml('other', 'test-custom', 'laptop');
    expect(customHtml).toContain(QUICK_LINK_ICONS['laptop'].path);

    // Fallback to category when custom icon is unknown
    const fallbackHtml = quickLinkIconHtml('marks', 'test-custom', 'nonexistent_icon');
    expect(fallbackHtml).toContain(QUICK_LINK_ICONS['scale'].path);

    // Updating quick link can update or remove custom icon
    if (labLink) {
      const updated = await updateQuickLink(labLink.id, { icon: 'flask-conical' });
      expect(updated.find(l => l.id === labLink.id)?.icon).toBe('flask-conical');
    }
  });

  it('reorders quick links up and down with bounds checking', async () => {
    const list: QuickLink[] = [
      { id: 'l1', title: 'Link 1', url: 'https://1.com', category: 'portal', createdAt: '2026-01-01' },
      { id: 'l2', title: 'Link 2', url: 'https://2.com', category: 'attendance', createdAt: '2026-01-02' },
      { id: 'l3', title: 'Link 3', url: 'https://3.com', category: 'marks', createdAt: '2026-01-03' }
    ];
    await saveQuickLinks(list);

    // Pure reordering list helper
    const reorderedList = reorderQuickLinksList(list, 0, 2);
    expect(reorderedList.map(l => l.id)).toEqual(['l2', 'l3', 'l1']);

    // Out of bounds reordering does not alter list
    expect(reorderQuickLinksList(list, -1, 2)).toEqual(list);
    expect(reorderQuickLinksList(list, 0, 5)).toEqual(list);

    // Move middle link up
    const afterMoveUp = await moveQuickLink('l2', 'up');
    expect(afterMoveUp.map(l => l.id)).toEqual(['l2', 'l1', 'l3']);

    // Move first link up does nothing
    const afterFirstUp = await moveQuickLink('l2', 'up');
    expect(afterFirstUp.map(l => l.id)).toEqual(['l2', 'l1', 'l3']);

    // Move first link down
    const afterFirstDown = await moveQuickLink('l2', 'down');
    expect(afterFirstDown.map(l => l.id)).toEqual(['l1', 'l2', 'l3']);

    // Move last link down does nothing
    const afterLastDown = await moveQuickLink('l3', 'down');
    expect(afterLastDown.map(l => l.id)).toEqual(['l1', 'l2', 'l3']);

    // Arbitrary reordering by list of IDs (e.g. from drag and drop)
    const afterReorder = await reorderQuickLinks(['l3', 'l1', 'l2']);
    expect(afterReorder.map(l => l.id)).toEqual(['l3', 'l1', 'l2']);
  });
});
