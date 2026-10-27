/**
 * Settings > General > Your University: the university (grading scale and quick links), the
 * scale itself (editable, since some universities let instructors set the percentages) and
 * Blackboard addresses that are not built in. The walkthrough has the same university picker.
 */
import type { StudentProfile } from '../types';
import { UNIVERSITY_PRESETS, getUniversity, normalizeGradeScale, GradeRow } from '../core/universities';
import { profileUniversity, profileGradeScale } from '../core/studentProfile';
import { getProfile, saveProfile, PROFILE_KEY } from '../utils/profile';
import { getExtraSites, saveExtraSites, normalizeBlackboardOrigin, isBuiltInBlackboardHost, originPattern } from '../utils/blackboardSites';

export interface UniversitySettingsHooks {
  /** The profile changed here or from a sync: re-render marks, and push to the cloud when it changed here */
  onProfileChanged: (profile: StudentProfile | null, fromHere: boolean, previousUniversityId: string) => void;
  toast: (message: string) => void;
}

let cached: StudentProfile | null = null;

export function getCachedProfile(): StudentProfile | null {
  return cached;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fillUniversitySelect(select: HTMLSelectElement | null, profile: StudentProfile | null) {
  if (!select) return;
  if (!select.options.length) {
    select.innerHTML = UNIVERSITY_PRESETS
      .map(u => `<option value="${esc(u.id)}">${esc(u.name)}${u.id === 'other' ? '' : ` (${esc(u.shortName)})`}</option>`)
      .join('');
  }
  select.value = profileUniversity(profile).id;
}

function renderScaleEditor(profile: StudentProfile | null) {
  const box = document.getElementById('grade-scale-editor');
  if (!box) return;
  const scale = profileGradeScale(profile);
  box.innerHTML = scale.map((g, i) => `
    <div class="grade-scale-row" data-index="${i}">
      <input type="text" class="form-input grade-scale-letter" value="${esc(g.letter)}" maxlength="4" aria-label="Letter">
      <input type="number" class="form-input grade-scale-min" value="${g.min}" min="0" max="100" step="0.5" aria-label="Lowest percentage for ${esc(g.letter)}" ${g.min === 0 ? 'disabled' : ''}>
      <span class="grade-scale-unit">%+</span>
      <input type="number" class="form-input grade-scale-points" value="${g.points}" min="0" max="5" step="0.1" aria-label="Grade points for ${esc(g.letter)}">
      <span class="grade-scale-unit">pts</span>
      <button type="button" class="grade-scale-remove" aria-label="Remove ${esc(g.letter)}" ${g.min === 0 ? 'disabled' : ''}>✕</button>
    </div>`).join('');
  const uni = profileUniversity(profile);
  const note = document.getElementById('grade-scale-note');
  if (note) {
    note.textContent = profile?.gradeScale
      ? 'Your own scale. Use University Scale goes back to the published one.'
      : uni.cutoffsFromSyllabus
        ? `${uni.shortName === 'Other' ? 'This is a common UAE scale.' : `${uni.shortName} publishes grade points only;`} Instructors set the percentages, so edit them to match your syllabus.`
        : `${uni.name}'s published scale. Lowest pass: ${uni.lowestPass}.`;
  }
}

function readScaleEditor(): GradeRow[] | null {
  const rows = Array.from(document.querySelectorAll<HTMLDivElement>('#grade-scale-editor .grade-scale-row')).map(row => ({
    letter: (row.querySelector<HTMLInputElement>('.grade-scale-letter')?.value || '').trim(),
    min: Number(row.querySelector<HTMLInputElement>('.grade-scale-min')?.value),
    points: Number(row.querySelector<HTMLInputElement>('.grade-scale-points')?.value)
  }));
  return normalizeGradeScale(rows);
}

async function renderSites() {
  const list = document.getElementById('blackboard-sites-list');
  if (!list) return;
  const sites = await getExtraSites();
  if (!sites.length) {
    list.innerHTML = '';
    return;
  }
  const rows = await Promise.all(sites.map(async origin => {
    let allowed = false;
    try { allowed = await chrome.permissions.contains({ origins: [originPattern(origin)] }); } catch {}
    return `<div class="blackboard-site-row">
      <span class="blackboard-site-host">${esc(origin.replace(/^https:\/\//, ''))}</span>
      <span class="blackboard-site-state">${allowed ? 'Allowed' : 'Not allowed yet'}</span>
      ${allowed ? '' : `<button type="button" class="btn-secondary blackboard-site-allow" data-origin="${esc(origin)}">Allow</button>`}
      <button type="button" class="grade-scale-remove blackboard-site-remove" data-origin="${esc(origin)}" aria-label="Remove ${esc(origin)}">✕</button>
    </div>`;
  }));
  list.innerHTML = rows.join('');
}

async function addSite(input: string, hooks: UniversitySettingsHooks) {
  const origin = normalizeBlackboardOrigin(input);
  if (!origin) {
    hooks.toast('Enter your Blackboard address, for example lms.youruniversity.edu');
    return;
  }
  if (isBuiltInBlackboardHost(new URL(origin).hostname)) {
    hooks.toast('That address already works without adding it.');
    return;
  }
  // Runs straight from the click: the browser only asks for permission during a user action
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
  } catch {}
  await saveExtraSites([...(await getExtraSites()), origin]);
  await renderSites();
  hooks.toast(granted
    ? 'Added. Reload your Blackboard tab and Blackboarder will scan it.'
    : 'Saved, but the browser did not allow it. Press Allow to try again.');
}

function refresh() {
  fillUniversitySelect(document.getElementById('setting-university') as HTMLSelectElement | null, cached);
  fillUniversitySelect(document.getElementById('wt-university') as HTMLSelectElement | null, cached);
  renderScaleEditor(cached);
  const note = document.getElementById('university-detect-note');
  if (note) {
    note.textContent = cached?.source === 'detected'
      ? 'Found from your Blackboard address. Change it if it is wrong.'
      : cached ? '' : 'Not set yet. Pick yours, or scan any Blackboard page and it is filled in.';
  }
}

async function update(hooks: UniversitySettingsHooks, next: Omit<StudentProfile, 'updatedAt'>) {
  const before = profileUniversity(cached).id;
  cached = await saveProfile(next);
  refresh();
  hooks.onProfileChanged(cached, true, before);
}

export async function initUniversitySettings(hooks: UniversitySettingsHooks): Promise<void> {
  cached = await getProfile();
  refresh();
  renderSites().catch(() => {});

  for (const id of ['setting-university', 'wt-university']) {
    document.getElementById(id)?.addEventListener('change', e => {
      // A new university starts from its own scale
      const universityId = getUniversity((e.target as HTMLSelectElement).value).id;
      update(hooks, { universityId, source: 'picked' }).catch(() => {});
    });
  }

  const editor = document.getElementById('grade-scale-editor');
  editor?.addEventListener('change', () => {
    const scale = readScaleEditor();
    if (!scale) return;
    update(hooks, { universityId: profileUniversity(cached).id, gradeScale: scale, source: cached?.source || 'picked' }).catch(() => {});
  });
  editor?.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('.grade-scale-remove') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    btn.closest('.grade-scale-row')?.remove();
    editor.dispatchEvent(new Event('change'));
  });
  document.getElementById('btn-grade-row-add')?.addEventListener('click', () => {
    const scale = profileGradeScale(cached);
    const lowest = scale.filter(g => g.min > 0).pop();
    const row: GradeRow = {
      letter: 'D-',
      min: Math.max(1, (lowest?.min ?? 60) - 3),
      points: Math.max(0, Math.round(((lowest?.points ?? 1) - 0.3) * 10) / 10)
    };
    update(hooks, { universityId: profileUniversity(cached).id, gradeScale: [...scale, row], source: cached?.source || 'picked' }).catch(() => {});
  });
  document.getElementById('btn-grade-scale-reset')?.addEventListener('click', () => {
    update(hooks, { universityId: profileUniversity(cached).id, source: cached?.source || 'picked' }).catch(() => {});
  });

  const urlInput = document.getElementById('setting-blackboard-url') as HTMLInputElement | null;
  document.getElementById('btn-add-blackboard-site')?.addEventListener('click', () => {
    addSite(urlInput?.value || '', hooks).then(() => { if (urlInput) urlInput.value = ''; }).catch(() => {});
  });
  document.getElementById('blackboard-sites-list')?.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    const origin = (target.closest('[data-origin]') as HTMLElement | null)?.dataset.origin;
    if (!origin) return;
    if (target.closest('.blackboard-site-allow')) {
      try { await chrome.permissions.request({ origins: [originPattern(origin)] }); } catch {}
    } else if (target.closest('.blackboard-site-remove')) {
      await saveExtraSites((await getExtraSites()).filter(o => o !== origin));
      try { await chrome.permissions.remove({ origins: [originPattern(origin)] }); } catch {}
    }
    renderSites().catch(() => {});
  });

  // A scan or a sync can change the profile while the popup is open
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[PROFILE_KEY]) return;
    const before = profileUniversity(cached).id;
    getProfile().then(p => {
      if (JSON.stringify(p) === JSON.stringify(cached)) return;
      cached = p;
      refresh();
      hooks.onProfileChanged(cached, false, before);
    }).catch(() => {});
  });
}
