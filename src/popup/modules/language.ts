import type { UiLanguage } from '../../types';
import { ensureArabicMirrorsOnTasks } from '../../core/arabicTranslator';
import {
  LANG_STORAGE_KEY,
  applyDocumentLanguage,
  getSavedUiLanguage,
  normalizeUiLanguage,
  translateStaticUiElements,
} from '../../core/i18n';
import { resolveAiEndpoint } from '../../engine/aiProviders';
import { translateTasksToArabicWithAi } from '../../engine/aiTranslator';
import { getSettings, saveSettings } from '../../utils/storage/index';
import { renderAdminBanners } from './adminBanners';
import { popupActions, popupState } from './state';

let aiTranslationInFlight = false;

export function applyLanguageUi(lang: UiLanguage): void {
  const clean = normalizeUiLanguage(lang);
  popupState.currentLanguage = clean;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, clean);
  } catch {}
  applyDocumentLanguage(document, clean);
  translateStaticUiElements(document, clean);
  renderAdminBanners();

  const select = document.getElementById('setting-language') as HTMLSelectElement | null;
  if (select && select.value !== clean) {
    select.value = clean;
  }

  popupActions.renderLegend?.();
  if (popupState.currentActiveView === 'settings') {
    void popupActions.loadSettingsForm?.();
  }
}

async function upgradeMissingArabicMirrorsWithAi(): Promise<void> {
  if (aiTranslationInFlight || popupState.currentLanguage !== 'ar') return;
  aiTranslationInFlight = true;
  try {
    const settings = await getSettings();
    const endpoint = resolveAiEndpoint(settings);
    if (!endpoint || !Array.isArray(popupState.currentTasks) || popupState.currentTasks.length === 0) return;
    const prev = popupState.currentTasks;
    const upgraded = await translateTasksToArabicWithAi(prev, endpoint, 12);
    const changed = upgraded.some((t, idx) =>
      t.ar?.sourceSig !== prev[idx]?.ar?.sourceSig ||
      t.ar?.translatedBy !== prev[idx]?.ar?.translatedBy ||
      t.ar?.title !== prev[idx]?.ar?.title
    );
    if (changed) {
      popupState.currentTasks = upgraded;
      await popupActions.persistTasksInBackground(popupState.currentTasks, true);
      popupActions.refreshAllViews();
      popupActions.syncTasksToCloud(popupState.currentTasks, 'AI Arabic Mirror Upgrade');
    }
  } catch {
    // Offline local Arabic mirror already populated; keep silent on background failure
  } finally {
    aiTranslationInFlight = false;
  }
}

export async function setLanguageNow(
  newLang: UiLanguage,
  options: { save?: boolean; sync?: boolean; upgradeWithAi?: boolean } = { save: true, sync: true, upgradeWithAi: true }
): Promise<void> {
  const clean = normalizeUiLanguage(newLang);
  applyLanguageUi(clean);

  if (clean === 'ar' && Array.isArray(popupState.currentTasks) && popupState.currentTasks.length > 0) {
    popupState.currentTasks = ensureArabicMirrorsOnTasks(popupState.currentTasks);
  }

  popupActions.refreshAllViews();

  if (options.save !== false) {
    try {
      await saveSettings({ language: clean });
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'LANGUAGE_CHANGED', language: clean });
      channel.close();
    } catch {}
  }

  if (options.sync !== false) {
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Language Preference Update');
  }

  if (clean === 'ar' && options.upgradeWithAi !== false) {
    void upgradeMissingArabicMirrorsWithAi();
  }
}

export async function initLanguageSync(): Promise<void> {
  const cached = getSavedUiLanguage();
  applyLanguageUi(cached);
  try {
    const settings = await getSettings();
    const saved = normalizeUiLanguage(settings.language || cached);
    if (saved !== popupState.currentLanguage) {
      applyLanguageUi(saved);
    }
    if (saved === 'ar' && Array.isArray(popupState.currentTasks) && popupState.currentTasks.length > 0) {
      ensureArabicMirrorsOnTasks(popupState.currentTasks);
    }
  } catch {}
}
