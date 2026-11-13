import { saveSettings, getCachedSettingsSync } from '../../utils/storage';
import { popupState } from './state';

const THEME_SYSTEM_DEFAULT_FLAG = 'bbs_theme_system_default_v1';

export function applyTheme(theme: 'light' | 'dark' | 'system' = 'light') {
  popupState.currentThemeSetting = theme;
  let isDark = false;
  if (theme === 'system') {
    isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (themeSelect && themeSelect.value !== theme) {
    themeSelect.value = theme;
  }
}

/**
 * The Theme dropdown in Settings > General applies and saves at once
 * (it replaced the header's light/dark toggle button).
 */
export async function setThemeNow(newTheme: 'light' | 'dark' | 'system') {
  applyTheme(newTheme);
  try {
    localStorage.setItem('bbs_theme', newTheme);
    await saveSettings({ theme: newTheme });
    const channel = new BroadcastChannel('bbs_sync_channel');
    channel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
    channel.close();
  } catch {}
}

/**
 * One-time switch to "Match System Theme" (the new default). Saved light/dark values
 * came from the old 'light' default or the removed header toggle, so everyone starts
 * on System once; picking Light or Dark afterwards sticks.
 */
export async function migrateThemeToSystemDefault() {
  try {
    const flags = await chrome.storage.local.get(THEME_SYSTEM_DEFAULT_FLAG);
    if (flags[THEME_SYSTEM_DEFAULT_FLAG]) return;
    await saveSettings({ theme: 'system' });
    try { localStorage.setItem('bbs_theme', 'system'); } catch {}
    applyTheme('system');
    await chrome.storage.local.set({ [THEME_SYSTEM_DEFAULT_FLAG]: true });
  } catch {}
}

export function initThemeSync() {
  let theme: 'light' | 'dark' | 'system' = 'system';
  try {
    const localTheme = localStorage.getItem('bbs_theme') as any;
    if (localTheme) {
      theme = localTheme;
    } else {
      const cached = getCachedSettingsSync();
      if (cached.theme) theme = cached.theme;
    }
  } catch {}
  applyTheme(theme);
}
