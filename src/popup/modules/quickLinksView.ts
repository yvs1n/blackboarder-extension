import type { QuickLinkCategory } from '../../types';
import { profileUniversity } from '../../core/studentProfile';
import { quickLinkPreset } from '../../core/universities';
import { pushTasksToFirebase } from '../../utils/firebaseSync';
import { getQuickLinkIconList, quickLinkIconHtml, quickLinkMeta, reorderQuickLinksList } from '../../utils/quickLinkMeta';
import {
  addQuickLink,
  deleteQuickLink,
  getCoursesUpdatedAt,
  getQuickLinksUpdatedAt,
  getSettings,
  moveQuickLink,
  resetQuickLinksToDefault,
  saveQuickLinks,
  updateQuickLink,
} from '../../utils/storage';
import { getLocalTombstones } from '../../utils/tombstones';
import { escapeHtml } from '../../utils/uiCommon';
import { getCachedProfile } from '../universitySettings';
import { popupActions, popupState } from './state';

export function openQuickLinkUrl(rawUrl: string) {
  let url = (rawUrl || '').trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function renderQuickLinksBar() {
  const container = document.getElementById('calendar-quick-links-chips');
  const bar = document.getElementById('calendar-quick-links-bar');
  if (!container) return;

  if (!popupState.currentQuickLinks || popupState.currentQuickLinks.length === 0) {
    if (bar) bar.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  if (bar) bar.style.display = '';

  container.innerHTML = popupState.currentQuickLinks.map(link => {
    const meta = quickLinkMeta(link.category, link.icon);
    return `
      <a class="ql-chip ${meta.badgeClass}" data-id="${escapeHtml(link.id)}" data-url="${escapeHtml(link.url)}" title="${escapeHtml(link.title)} (${escapeHtml(link.url)})">
        ${quickLinkIconHtml(link.category, 'ql-chip-icon', link.icon)}
        <span>${escapeHtml(link.title)}</span>
        <svg class="ql-chip-external-icon"><use href="#icon-external-link"></use></svg>
      </a>
    `;
  }).join('');

  container.querySelectorAll('.ql-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chip.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });
}

export function renderQuickLinkIconPicker(currentIconId = '') {
  const container = document.getElementById('ql-icon-picker-grid');
  const iconInput = document.getElementById('ql-icon') as HTMLInputElement | null;
  const iconNameLabel = document.getElementById('ql-selected-icon-name');
  if (!container) return;

  const icons = getQuickLinkIconList();
  const selected = currentIconId || '';
  if (iconInput) iconInput.value = selected;
  if (iconNameLabel) {
    const found = icons.find(i => i.id === selected);
    iconNameLabel.textContent = found ? found.label : 'Default';
  }

  container.innerHTML = icons.map(icon => {
    const isSelected = icon.id === selected;
    return `
      <div class="ql-icon-tile ${isSelected ? 'is-selected' : ''}" data-icon="${escapeHtml(icon.id)}" title="${escapeHtml(icon.label)}" role="radio" aria-checked="${isSelected}">
        <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.path}</svg>
        <span class="ql-icon-tile-label">${escapeHtml(icon.id)}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.ql-icon-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const iconId = tile.getAttribute('data-icon') || '';
      container.querySelectorAll('.ql-icon-tile').forEach(t => {
        t.classList.remove('is-selected');
        t.setAttribute('aria-checked', 'false');
      });
      tile.classList.add('is-selected');
      tile.setAttribute('aria-checked', 'true');
      if (iconInput) iconInput.value = iconId;
      if (iconNameLabel) {
        const found = icons.find(i => i.id === iconId);
        iconNameLabel.textContent = found ? found.label : 'Default';
      }
    });
  });
}

export function renderQuickLinksManager() {
  const listContainer = document.getElementById('quick-links-manager-list');
  if (!listContainer) return;

  if (!popupState.currentQuickLinks || popupState.currentQuickLinks.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 12px;">
        No quick links yet. Click <strong>Add Link</strong> to add your attendance, marks or study plan pages.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = popupState.currentQuickLinks.map((link, idx) => {
    const meta = quickLinkMeta(link.category, link.icon);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    const isFirst = idx === 0;
    const isLast = idx === popupState.currentQuickLinks.length - 1;

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${escapeHtml(link.id)}" data-index="${idx}" draggable="true">
        <div class="ql-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</div>
        <div class="ql-item-left">
          <div class="ql-item-icon-box">
            ${quickLinkIconHtml(link.category, '', link.icon)}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <div class="ql-move-group">
            <button type="button" class="btn-ql-move btn-move-ql-up" data-id="${escapeHtml(link.id)}" title="Move up" aria-label="Move up" ${isFirst ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn-ql-move btn-move-ql-down" data-id="${escapeHtml(link.id)}" title="Move down" aria-label="Move down" ${isLast ? 'disabled' : ''}>↓</button>
          </div>
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
          <button type="button" class="btn-ql-action btn-edit-ql" data-id="${escapeHtml(link.id)}" title="Edit link" aria-label="Edit link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="btn-ql-action delete btn-delete-ql" data-id="${escapeHtml(link.id)}" title="Delete link" aria-label="Delete link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  listContainer.querySelectorAll('.btn-move-ql-up').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      popupState.currentQuickLinks = await moveQuickLink(id, 'up');
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
    });
  });

  listContainer.querySelectorAll('.btn-move-ql-down').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      popupState.currentQuickLinks = await moveQuickLink(id, 'down');
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
    });
  });

  let draggedId: string | null = null;
  listContainer.querySelectorAll<HTMLElement>('.ql-item-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.getAttribute('data-id');
      card.classList.add('is-dragging');
      e.dataTransfer?.setData('text/plain', draggedId || '');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      listContainer.querySelectorAll('.ql-item-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      draggedId = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedId || card.getAttribute('data-id') === draggedId) return;
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        card.classList.add('drag-over-top');
        card.classList.remove('drag-over-bottom');
      } else {
        card.classList.add('drag-over-bottom');
        card.classList.remove('drag-over-top');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const targetId = card.getAttribute('data-id');
      if (!draggedId || !targetId || draggedId === targetId) return;

      const fromIndex = popupState.currentQuickLinks.findIndex(l => l.id === draggedId);
      const toIndex = popupState.currentQuickLinks.findIndex(l => l.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return;

      popupState.currentQuickLinks = reorderQuickLinksList(popupState.currentQuickLinks, fromIndex, toIndex);
      await saveQuickLinks(popupState.currentQuickLinks);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
    });
  });

  listContainer.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  listContainer.querySelectorAll('.btn-edit-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const target = popupState.currentQuickLinks.find(l => l.id === id);
      if (!target) return;

      const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
      const editIdInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;

      if (form && editIdInput && titleInput && urlInput && catSelect) {
        editIdInput.value = target.id;
        titleInput.value = target.title;
        urlInput.value = target.url;
        catSelect.value = target.category || 'other';
        renderQuickLinkIconPicker(target.icon || '');
        if (saveBtn) saveBtn.textContent = 'Update Link';
        form.style.display = 'block';
        titleInput.focus();
      }
    });
  });

  listContainer.querySelectorAll('.btn-delete-ql').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const target = popupState.currentQuickLinks.find(l => l.id === id);
      const title = target ? target.title : 'link';
      popupState.currentQuickLinks = await deleteQuickLink(id);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      popupActions.showToast(`Removed "${title}" from quick links`);
    });
  });
}

export function initQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const btnToggle = document.getElementById('btn-quick-links-toggle');
  const btnClose = document.getElementById('btn-close-quick-links');
  const btnBarManage = document.getElementById('btn-bar-manage-links');
  const btnToggleForm = document.getElementById('btn-toggle-add-link-form');
  const btnReset = document.getElementById('btn-reset-quick-links');
  const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
  const btnCancelForm = document.getElementById('btn-cancel-ql-form');

  const openModal = () => {
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
      renderQuickLinksManager();
    }
  };

  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
      if (saveBtn) saveBtn.textContent = 'Save Link';
      renderQuickLinkIconPicker('');
    }
  };

  btnToggle?.addEventListener('click', openModal);
  btnBarManage?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  btnToggleForm?.addEventListener('click', () => {
    if (form) {
      const isVisible = form.style.display !== 'none';
      if (isVisible) {
        form.style.display = 'none';
      } else {
        form.reset();
        const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
        if (editId) editId.value = '';
        const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
        if (saveBtn) saveBtn.textContent = 'Save Link';
        renderQuickLinkIconPicker('');
        form.style.display = 'block';
        (document.getElementById('ql-title') as HTMLInputElement | null)?.focus();
      }
    }
  });

  btnCancelForm?.addEventListener('click', () => {
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
      renderQuickLinkIconPicker('');
    }
  });

  const categoryDefaultIcons: Record<string, string> = {
    attendance: 'list-check',
    study_plan: 'book',
    marks: 'scale',
    portal: 'globe',
    other: 'link',
  };

  document.querySelectorAll('.btn-preset-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;

      if (form) form.style.display = 'block';

      const filled = quickLinkPreset(profileUniversity(getCachedProfile()).id, (preset || 'other') as any);
      if (titleInput) titleInput.value = filled.title;
      if (urlInput) {
        urlInput.value = filled.url;
        if (!filled.url) urlInput.focus();
      }
      if (catSelect) catSelect.value = filled.category;
      const defaultIcon = categoryDefaultIcons[filled.category] || '';
      renderQuickLinkIconPicker(defaultIcon);
    });
  });

  document.getElementById('ql-category')?.addEventListener('change', (e) => {
    const cat = (e.target as HTMLSelectElement).value;
    const currentIcon = (document.getElementById('ql-icon') as HTMLInputElement | null)?.value;
    if (!currentIcon) {
      renderQuickLinkIconPicker(categoryDefaultIcons[cat] || '');
    }
  });

  btnReset?.addEventListener('click', async () => {
    const uni = profileUniversity(getCachedProfile());
    const question = (uni.quickLinks || []).length
      ? `Replace your quick links with ${uni.shortName}'s built-in links?`
      : 'Remove all your quick links? Your university has no built-in links, so you add your own.';
    if (confirm(question)) {
      popupState.currentQuickLinks = await resetQuickLinksToDefault(profileUniversity(getCachedProfile()).id);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      popupActions.showToast('Quick links reset to defaults');
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = (document.getElementById('ql-edit-id') as HTMLInputElement | null)?.value || '';
    const title = (document.getElementById('ql-title') as HTMLInputElement | null)?.value.trim() || '';
    let url = (document.getElementById('ql-url') as HTMLInputElement | null)?.value.trim() || '';
    const category = ((document.getElementById('ql-category') as HTMLSelectElement | null)?.value || 'other') as QuickLinkCategory;
    const icon = (document.getElementById('ql-icon') as HTMLInputElement | null)?.value.trim() || undefined;

    if (!title || !url) {
      popupActions.showToast('Please provide both title and URL.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editId) {
      popupState.currentQuickLinks = await updateQuickLink(editId, { title, url, category, icon });
      popupActions.showToast(`Updated "${title}"`);
    } else {
      popupState.currentQuickLinks = await addQuickLink({ title, url, category, icon });
      popupActions.showToast(`Added "${title}" to quick links!`);
    }

    form.reset();
    form.style.display = 'none';
    const idInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
    if (idInput) idInput.value = '';
    renderQuickLinkIconPicker('');

    renderQuickLinksBar();
    renderQuickLinksManager();
    syncQuickLinksToCloud();
  });
}

export async function syncQuickLinksToCloud() {
  try {
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);
    await pushTasksToFirebase(
      popupState.currentTasks,
      'Chrome Extension',
      settings.syncKey,
      popupState.currentQuickLinks,
      tombstones,
      popupState.currentUserCourses,
      coursesUpdatedAt || undefined,
      (await getQuickLinksUpdatedAt()) || undefined
    );
  } catch {}
}
