/**
 * Remembers unfinished work in the popup (a deadline being added or edited, the Courses tab or the
 * settings page open) so closing the popup does not lose it. Anything else opens on the calendar as before.
 */
export interface PopupDraft {
  view: 'add' | 'edit' | 'settings' | 'courses';
  taskId?: string;
  settingsPage?: string;
  fields?: Record<string, string | boolean>;
  savedAt: number;
}

export const DRAFT_KEY = 'bbs_popup_draft';
/** A draft older than this is treated as abandoned. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const storage = (): chrome.storage.StorageArea | null => {
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
};

export function isDraftFresh(d: PopupDraft | null | undefined, now = Date.now()): d is PopupDraft {
  return !!d && typeof d === 'object' && ['add', 'edit', 'settings', 'courses'].includes(d.view) &&
    typeof d.savedAt === 'number' && now - d.savedAt < DRAFT_MAX_AGE_MS;
}

export async function loadDraft(): Promise<PopupDraft | null> {
  try {
    const s = storage();
    if (!s) return null;
    const data = await s.get(DRAFT_KEY);
    const d = data?.[DRAFT_KEY] as PopupDraft | undefined;
    return isDraftFresh(d) ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Omit<PopupDraft, 'savedAt'>): void {
  try {
    storage()?.set({ [DRAFT_KEY]: { ...d, savedAt: Date.now() } })?.catch?.(() => {});
  } catch {}
}

export function clearDraft(): void {
  try {
    storage()?.remove(DRAFT_KEY)?.catch?.(() => {});
  } catch {}
}

/** Values of a form's fields by id (checkboxes as true/false). */
export function collectFields(form: HTMLElement): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[id], select[id], textarea[id]').forEach(el => {
    if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'password')) return;
    out[el.id] = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });
  return out;
}

export function applyFields(fields: Record<string, string | boolean> | undefined): void {
  if (!fields) return;
  for (const [id, v] of Object.entries(fields)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) el.checked = Boolean(v);
    else el.value = String(v);
  }
}
