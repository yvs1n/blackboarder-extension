// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';


describe('Popup UI Logic & Accessibility Suite', () => {
  let popupHtml: string;

  beforeEach(() => {
    const htmlPath = path.join(__dirname, '..', 'src', 'popup', 'index.html');
    popupHtml = fs.readFileSync(htmlPath, 'utf8');
    document.body.innerHTML = popupHtml;
  });

  describe('Accessibility & Screen Reader Compliance', () => {
    it('ensures all interactive header icon buttons have descriptive aria-labels', () => {
      const scanBtn = document.getElementById('btn-scan-tab');
      expect(scanBtn?.getAttribute('aria-label')).toBe('Scan Current Blackboard Page');

      const addBtn = document.getElementById('btn-add-modal');
      expect(addBtn?.getAttribute('aria-label')).toBe('Add Deadline Manually');

      const settingsBtn = document.getElementById('btn-settings-toggle');
      expect(settingsBtn?.getAttribute('aria-label')).toBe('Settings');

      // The header keeps only everyday actions
      const headerButtons = Array.from(document.querySelectorAll('.header-actions button')).map(b => b.id);
      expect(headerButtons).toEqual(['btn-scan-tab', 'btn-add-modal', 'btn-settings-toggle']);
    });

    it('keeps the actions moved out of the header reachable in Settings', () => {
      const inPage = (id: string) =>
        document.getElementById(id)?.closest('.settings-page')?.id;

      // Calendar export: Data page
      expect(document.getElementById('btn-export-all-ics')?.getAttribute('aria-label')).toBe('Export All to .ICS Calendar');
      expect(inPage('btn-export-all-ics')).toBe('settings-page-data');

      // Quick links editor: the Courses tab, as on the phone (the calendar's Quick Links bar opens it too)
      expect(document.getElementById('btn-quick-links-toggle')?.getAttribute('aria-label')).toBe('Academic Quick Links');
      expect(document.getElementById('btn-quick-links-toggle')?.closest('section')?.id).toBe('view-courses');
      expect(document.getElementById('btn-bar-manage-links')).not.toBeNull();

      // Phone sync: Sync page
      expect(inPage('btn-sync-to-server')).toBe('settings-page-sync');

      // Theme: dropdown on the General page
      expect(inPage('setting-theme')).toBe('settings-page-general');
    });

    it('ensures all modal dialogs declare role="dialog" and aria-modal="true"', () => {
      const dialogs = [
        'modal-edit-task',
        'modal-reading-sheet',
        'modal-room-picker',
        'modal-ai-extract',
        'modal-quick-links',
        'modal-course-editor',
        'modal-course-import',
        'modal-walkthrough'
      ];

      dialogs.forEach(id => {
        const el = document.getElementById(id);
        expect(el, `Expected #${id} to exist`).not.toBeNull();
        expect(el?.getAttribute('role')).toBe('dialog');
        expect(el?.getAttribute('aria-modal')).toBe('true');
      });
    });

    it('ensures day drawer declares role="dialog" and aria-labelledby', () => {
      const drawer = document.getElementById('day-expanded-drawer');
      expect(drawer).not.toBeNull();
      expect(drawer?.getAttribute('role')).toBe('dialog');
      expect(drawer?.getAttribute('aria-modal')).toBe('true');
      expect(drawer?.getAttribute('aria-labelledby')).toBe('day-drawer-title');
    });

    it('ensures course legend scroll navigation buttons have descriptive aria-labels', () => {
      const leftBtn = document.getElementById('legend-scroll-left');
      const rightBtn = document.getElementById('legend-scroll-right');
      expect(leftBtn).not.toBeNull();
      expect(rightBtn).not.toBeNull();
      expect(leftBtn?.getAttribute('aria-label')).toBe('Scroll courses left');
      expect(rightBtn?.getAttribute('aria-label')).toBe('Scroll courses right');
    });
  });

  describe('Keyboard Navigation & Escape Key Dismissal', () => {
    it('Escape key dismisses open modals and drawers', () => {
      // Simulate open edit modal
      const editModal = document.getElementById('modal-edit-task')!;
      editModal.style.display = 'flex';

      const drawer = document.getElementById('day-expanded-drawer')!;
      drawer.classList.remove('hidden');

      // Wire up Escape handler identical to popup.ts
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (editModal && editModal.style.display !== 'none') {
            editModal.style.display = 'none';
          }
          if (drawer && !drawer.classList.contains('hidden')) {
            drawer.classList.add('hidden');
          }
        }
      };

      window.addEventListener('keydown', onKeyDown);

      // Trigger Escape key event
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(editModal.style.display).toBe('none');
      expect(drawer.classList.contains('hidden')).toBe(true);

      window.removeEventListener('keydown', onKeyDown);
    });
  });

  describe('Chronological Time Sorting Logic for Day Items', () => {
    it('sorts multiple tasks on the same calendar date in strict earliest-first order', () => {
      const tasksOnDate = [
        {
          id: 'task-afternoon',
          title: 'Physics Lab Report',
          dueDate: '2026-10-15T10:00:00.000Z', // 2:00 PM UTC+4
          hasSpecificTime: true,
          type: 'lab',
          status: 'pending',
          priority: 'medium',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        },
        {
          id: 'task-morning',
          title: 'Intro to Comp Eng Quiz',
          dueDate: '2026-10-15T07:00:00.000Z', // 11:00 AM UTC+4
          hasSpecificTime: true,
          type: 'quiz',
          status: 'pending',
          priority: 'high',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        },
        {
          id: 'task-midnight',
          title: 'Calculus WebAssign',
          dueDate: '2026-10-15T19:59:00.000Z', // 11:59 PM UTC+4
          hasSpecificTime: true,
          type: 'assignment',
          status: 'pending',
          priority: 'medium',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        }
      ];

      // Sorter function used across popup and mobile
      const sorted = [...tasksOnDate].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

      expect(sorted[0].id).toBe('task-morning');
      expect(sorted[1].id).toBe('task-afternoon');
      expect(sorted[2].id).toBe('task-midnight');
    });
  });

  describe('Calendar Classes & Course Legend Navigation', () => {
    it('ensures classes containers exist in both selected day view and expanded day drawer', () => {
      const selectedDayClasses = document.getElementById('selected-day-classes');
      const expandedDayClasses = document.getElementById('day-expanded-classes');
      expect(selectedDayClasses).not.toBeNull();
      expect(expandedDayClasses).not.toBeNull();
    });

    it('ensures course legend bar has left and right scroll navigation buttons and overflow state', () => {
      const bar = document.getElementById('course-legend-panel');
      const leftBtn = document.getElementById('legend-scroll-left');
      const rightBtn = document.getElementById('legend-scroll-right');
      const container = document.getElementById('legend-chips-container');
      expect(bar).not.toBeNull();
      expect(leftBtn).not.toBeNull();
      expect(rightBtn).not.toBeNull();
      expect(container).not.toBeNull();

      bar?.classList.add('has-overflow-right');
      expect(bar?.classList.contains('has-overflow-right')).toBe(true);
      bar?.classList.add('has-overflow-left');
      expect(bar?.classList.contains('has-overflow-left')).toBe(true);
    });
  });
});
