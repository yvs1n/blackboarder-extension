import { AiProvider, UserSettings } from '../../types';
import { IFM_MODEL, normalizeAiBaseUrl, resolveAiEndpoint, testAiEndpoint } from '../../engine/aiProviders';
import { describeAiLock, ensureAiPass, getAiLockState, newAiPass, syncAiKeyLock } from '../../utils/aiKeyLock';
import { getSettings, saveLastScanCheckpoint, saveSettings } from '../../utils/storage';
import { loadSyncStatus, setupSyncSettingsEvents } from './settingsSync';
import { dom, popupActions, popupState } from './state';
import { applyTheme, setThemeNow } from './theme';

export { exportJsonBackup, handleRestoreJson } from './settingsSync';
export { initWalkthroughModal, initSessionBanner } from './settingsWalkthrough';
export { initExtensionUpdateSystem } from './settingsUpdates';

const AI_PROVIDER_UI: Record<AiProvider, { label: string; placeholder: string; keyField: 'openRouterApiKey' | 'ifmApiKey' | 'customAiApiKey'; hint: string }> = {
  openrouter: {
    label: 'OpenRouter API Key (AI Fallback)',
    placeholder: 'sk-or-v1-...',
    keyField: 'openRouterApiKey',
    hint: 'Paid per use. Pick the model below.'
  },
  ifm: {
    label: 'IFM API Key (AI Fallback)',
    placeholder: 'Key from platform.ifm.ai',
    keyField: 'ifmApiKey',
    hint: `Uses ${IFM_MODEL.replace('IFM/', '')}. Get a free key at platform.ifm.ai.`
  },
  custom: {
    label: 'API Key (AI Fallback)',
    placeholder: 'Key for your provider',
    keyField: 'customAiApiKey',
    hint: 'Any service that offers an OpenAI-compatible /chat/completions API.'
  }
};

function selectedAiProvider(): AiProvider {
  const v = (document.getElementById('setting-ai-provider') as HTMLSelectElement | null)?.value;
  return v === 'ifm' || v === 'custom' ? v : 'openrouter';
}

function showAiProviderFields(provider: AiProvider, settings: Partial<UserSettings>): void {
  const ui = AI_PROVIDER_UI[provider];
  const label = document.getElementById('setting-apikey-label');
  const key = document.getElementById('setting-apikey') as HTMLInputElement | null;
  const hint = document.getElementById('setting-ai-provider-hint');
  if (label) label.textContent = ui.label;
  if (key) {
    key.placeholder = ui.placeholder;
    key.value = (settings[ui.keyField] as string) || '';
  }
  if (hint) hint.textContent = ui.hint;
  const custom = document.getElementById('ai-custom-fields');
  if (custom) custom.hidden = provider !== 'custom';
  const orModel = document.getElementById('ai-openrouter-model');
  if (orModel) orModel.hidden = provider !== 'openrouter';
  const baseUrl = document.getElementById('setting-ai-base-url') as HTMLInputElement | null;
  if (baseUrl) baseUrl.value = settings.customAiBaseUrl || '';
  const customModel = document.getElementById('setting-ai-custom-model') as HTMLInputElement | null;
  if (customModel) customModel.value = settings.customAiModel || '';
  const status = document.getElementById('ai-test-status');
  if (status) { status.textContent = ''; status.classList.remove('is-ok'); }
}

export async function refreshAiKeyLock(force = false): Promise<void> {
  const line = document.getElementById('ai-webapp-status');
  try {
    await ensureAiPass();
    const status = await syncAiKeyLock(await getSettings(), force);
    if (line) line.textContent = describeAiLock(status);
  } catch {
    if (line) line.textContent = describeAiLock('error');
  }
}

async function ensureAiHostPermission(baseUrl: string): Promise<boolean> {
  if (!baseUrl || typeof chrome === 'undefined' || !chrome.permissions?.request) return true;
  const origins = [`${new URL(baseUrl).origin}/*`];
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

export async function loadSettingsForm() {
  const settings = await getSettings();
  const aiProviderSelect = document.getElementById('setting-ai-provider') as HTMLSelectElement | null;
  if (aiProviderSelect) aiProviderSelect.value = settings.aiProvider || 'openrouter';
  showAiProviderFields(settings.aiProvider || 'openrouter', settings);
  getAiLockState().then(state => {
    const line = document.getElementById('ai-webapp-status');
    if (line) line.textContent = describeAiLock(state?.status);
  });
  void refreshAiKeyLock();
  (document.getElementById('setting-model') as HTMLSelectElement).value = settings.openRouterModel || 'google/gemini-3.8-flash';
  (document.getElementById('setting-use-ai') as HTMLInputElement).checked = settings.useAiExtraction;
  (document.getElementById('setting-autoscan') as HTMLInputElement).checked = settings.autoScanOnPageLoad;
  (document.getElementById('setting-badge-notif') as HTMLInputElement).checked = settings.badgeNotification;
  (document.getElementById('setting-reminder-hours') as HTMLSelectElement).value = String(settings.reminderHoursBefore || 24);
  const classReminder = document.getElementById('setting-class-reminder') as HTMLSelectElement | null;
  if (classReminder) classReminder.value = String(settings.classReminderMinutes ?? 15);
  const showClasses = document.getElementById('setting-show-classes') as HTMLInputElement | null;
  if (showClasses) showClasses.checked = settings.showClassesInCalendar !== false;
  const settingTheme = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (settingTheme) settingTheme.value = settings.theme || 'system';

  const settingBbDark = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  if (settingBbDark) settingBbDark.checked = settings.blackboardDarkMode !== false;

  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  if (settingSyncMidnight) settingSyncMidnight.checked = settings.autoSyncMidnight !== false;
  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  if (settingSyncOnScan) settingSyncOnScan.checked = settings.autoSyncOnScan !== false;

  loadSyncStatus(settings);
}

async function setBlackboardDarkMode(enabled: boolean) {
  await saveSettings({ blackboardDarkMode: enabled });
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ blackboardDarkMode: enabled, darkModeEnabled: enabled });
  }
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const notifyOrInjectTab = (tab: chrome.tabs.Tab) => {
      if (!tab.id) return;
      const tabId = tab.id;
      chrome.tabs.sendMessage(tabId, {
        action: 'toggleDarkMode',
        type: 'TOGGLE_BLACKBOARD_DARK_MODE',
        enabled
      }).catch(() => {
        if (enabled && chrome.scripting && tab.url && /(?:sharjah\.ac\.ae|blackboard\.com)/i.test(tab.url)) {
          chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['blackboard-dark.css']
          }).catch(() => {});
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['blackboard-dark.js']
          }).catch(() => {});
        }
      });
    };
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => tabs?.forEach(notifyOrInjectTab));
    chrome.tabs.query({}, tabs => tabs?.forEach(notifyOrInjectTab));
  }
}

export function setupSettingsEvents() {
  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
  themeSelect?.addEventListener('change', () => {
    setThemeNow((themeSelect.value || 'system') as 'light' | 'dark' | 'system');
  });

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (popupState.currentThemeSetting === 'system') applyTheme('system');
    });
  }

  const settingBbDarkToggle = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  settingBbDarkToggle?.addEventListener('change', async () => {
    const isChecked = settingBbDarkToggle.checked;
    await setBlackboardDarkMode(isChecked);
    popupActions.showToast(`Blackboard Dark Mode ${isChecked ? 'Enabled' : 'Disabled'}`);
  });

  const settingUseAi = document.getElementById('setting-use-ai') as HTMLInputElement | null;
  const settingApiKey = document.getElementById('setting-apikey') as HTMLInputElement | null;
  settingUseAi?.addEventListener('change', async () => {
    const enabled = settingUseAi.checked;
    await saveSettings({ useAiExtraction: enabled });
    if (enabled && !settingApiKey?.value.trim()) {
      popupActions.showToast('AI Deep Extraction on - add an API key to use it');
    } else {
      popupActions.showToast(`AI Deep Extraction ${enabled ? 'Enabled' : 'Disabled'}`);
    }
  });
  settingApiKey?.addEventListener('change', async () => {
    const ui = AI_PROVIDER_UI[selectedAiProvider()];
    await saveSettings({ [ui.keyField]: settingApiKey.value.trim() });
    popupActions.showToast('API key saved');
  });
  const settingAiProvider = document.getElementById('setting-ai-provider') as HTMLSelectElement | null;
  settingAiProvider?.addEventListener('change', async () => {
    const provider = selectedAiProvider();
    await saveSettings({ aiProvider: provider });
    showAiProviderFields(provider, await getSettings());
    popupActions.showToast('AI provider saved');
  });
  const settingAiBaseUrl = document.getElementById('setting-ai-base-url') as HTMLInputElement | null;
  settingAiBaseUrl?.addEventListener('change', async () => {
    const base = normalizeAiBaseUrl(settingAiBaseUrl.value);
    if (settingAiBaseUrl.value.trim() && !base) {
      popupActions.showToast('Base URL must start with https://');
      return;
    }
    settingAiBaseUrl.value = base;
    await saveSettings({ customAiBaseUrl: base });
    if (base && !(await ensureAiHostPermission(base))) {
      popupActions.showToast('Saved, but access to that site was not allowed');
      return;
    }
    popupActions.showToast('Base URL saved');
  });
  const settingAiCustomModel = document.getElementById('setting-ai-custom-model') as HTMLInputElement | null;
  settingAiCustomModel?.addEventListener('change', async () => {
    await saveSettings({ customAiModel: settingAiCustomModel.value.trim() });
    popupActions.showToast('Model saved');
  });
  for (const id of ['setting-use-ai', 'setting-apikey', 'setting-ai-provider', 'setting-ai-base-url', 'setting-ai-custom-model', 'setting-model']) {
    document.getElementById(id)?.addEventListener('change', () => {
      setTimeout(() => void refreshAiKeyLock(), 500);
    });
  }
  document.getElementById('btn-new-ai-pass')?.addEventListener('click', async () => {
    if (!confirm('Make a new AI pass? Phones lose AI access until you open the new pairing link on them.')) return;
    await saveSettings({ aiPass: newAiPass() });
    await refreshAiKeyLock(true);
    popupActions.showToast('New AI pass made. Copy the pairing link to your phone again.');
  });
  document.getElementById('btn-test-ai')?.addEventListener('click', async () => {
    const status = document.getElementById('ai-test-status');
    const show = (text: string, ok = false) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('is-ok', ok);
    };
    const provider = selectedAiProvider();
    const key = settingApiKey?.value.trim() || '';
    const endpoint = resolveAiEndpoint({
      aiProvider: provider,
      [AI_PROVIDER_UI[provider].keyField]: key,
      openRouterModel: (document.getElementById('setting-model') as HTMLSelectElement | null)?.value,
      customAiBaseUrl: settingAiBaseUrl?.value,
      customAiModel: settingAiCustomModel?.value
    });
    if (!endpoint) {
      show(provider === 'custom' ? 'Add the base URL, model and key first' : 'Add an API key first');
      return;
    }
    if (provider === 'custom' && !(await ensureAiHostPermission(normalizeAiBaseUrl(settingAiBaseUrl?.value)))) {
      show('Access to that site was not allowed');
      return;
    }
    show('Testing...');
    const result = await testAiEndpoint(endpoint);
    show(result.message, result.ok);
  });

  const settingShowClasses = document.getElementById('setting-show-classes') as HTMLInputElement | null;
  settingShowClasses?.addEventListener('change', async () => {
    await saveSettings({ showClassesInCalendar: settingShowClasses.checked });
    popupState.dirtyViews.add('calendar');
    popupActions.renderCalendar();
    popupActions.renderSelectedDay();
    const drawer = dom.dayExpandedDrawer();
    if (drawer && !drawer.classList.contains('hidden') && drawer.classList.contains('open')) {
      popupActions.openDayExpandedDrawer(popupState.selectedDateStr);
    }
    popupActions.showToast(settingShowClasses.checked ? 'Classes shown in the calendar' : 'Classes hidden from the calendar');
  });
  const settingClassReminder = document.getElementById('setting-class-reminder') as HTMLSelectElement | null;
  settingClassReminder?.addEventListener('change', async () => {
    const minutes = Math.max(0, parseInt(settingClassReminder.value, 10) || 0);
    await saveSettings({ classReminderMinutes: minutes });
    popupActions.showToast(minutes ? `Class reminders ${minutes} minutes before` : 'Class reminders off');
  });
  const settingModel = document.getElementById('setting-model') as HTMLSelectElement | null;
  settingModel?.addEventListener('change', async () => {
    await saveSettings({ openRouterModel: settingModel.value });
    popupActions.showToast('AI model saved');
  });

  const settingBadgeNotif = document.getElementById('setting-badge-notif') as HTMLInputElement | null;
  settingBadgeNotif?.addEventListener('change', async () => {
    await saveSettings({ badgeNotification: settingBadgeNotif.checked });
    try { chrome.runtime?.sendMessage?.({ type: 'UPDATE_BADGE' }); } catch {}
    popupActions.showToast(settingBadgeNotif.checked ? 'Toolbar badge active' : 'Toolbar badge disabled');
  });

  const settingReminderHours = document.getElementById('setting-reminder-hours') as HTMLSelectElement | null;
  settingReminderHours?.addEventListener('change', async () => {
    const hours = parseInt(settingReminderHours.value, 10) || 24;
    await saveSettings({ reminderHoursBefore: hours });
    popupActions.showToast(`Notification alert window ${hours}h`);
  });

  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  settingSyncMidnight?.addEventListener('change', async () => {
    await saveSettings({ autoSyncMidnight: settingSyncMidnight.checked });
    popupActions.showToast(settingSyncMidnight.checked ? 'Midnight sync on' : 'Midnight sync off');
  });

  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  settingSyncOnScan?.addEventListener('change', async () => {
    await saveSettings({ autoSyncOnScan: settingSyncOnScan.checked });
    popupActions.showToast(settingSyncOnScan.checked ? 'Scan sync on' : 'Scan sync off');
  });

  const settingAutoScan = document.getElementById('setting-autoscan') as HTMLInputElement | null;
  settingAutoScan?.addEventListener('change', async () => {
    await saveSettings({ autoScanOnPageLoad: settingAutoScan.checked });
    popupActions.showToast(settingAutoScan.checked ? 'Auto-scan on' : 'Auto-scan off');
  });

  dom.formSettings().addEventListener('submit', async e => {
    e.preventDefault();
    const apiKey = (document.getElementById('setting-apikey') as HTMLInputElement).value;
    const model = (document.getElementById('setting-model') as HTMLSelectElement).value;
    const useAi = (document.getElementById('setting-use-ai') as HTMLInputElement).checked;
    const autoScan = (document.getElementById('setting-autoscan') as HTMLInputElement).checked;
    const badgeNotif = (document.getElementById('setting-badge-notif') as HTMLInputElement).checked;
    const reminderHours = parseInt((document.getElementById('setting-reminder-hours') as HTMLSelectElement).value, 10);

    const syncMidnight = (document.getElementById('setting-sync-midnight') as HTMLInputElement)?.checked ?? true;
    const syncOnScan = (document.getElementById('setting-sync-onscan') as HTMLInputElement)?.checked ?? true;

    const prevSettings = await getSettings();
    const prevSyncKey = prevSettings.syncKey || '';
    const syncKey = prevSyncKey;
    const selectedTheme = ((document.getElementById('setting-theme') as HTMLSelectElement)?.value || 'system') as 'light' | 'dark' | 'system';
    const bbDark = (document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement)?.checked ?? true;

    const aiProvider = selectedAiProvider();
    const customBase = normalizeAiBaseUrl((document.getElementById('setting-ai-base-url') as HTMLInputElement | null)?.value);
    const customModel = (document.getElementById('setting-ai-custom-model') as HTMLInputElement | null)?.value.trim() || '';

    await saveSettings({
      [AI_PROVIDER_UI[aiProvider].keyField]: apiKey.trim(),
      aiProvider,
      customAiBaseUrl: customBase,
      customAiModel: customModel,
      openRouterModel: model,
      useAiExtraction: useAi,
      autoScanOnPageLoad: autoScan,
      badgeNotification: badgeNotif,
      reminderHoursBefore: reminderHours,
      autoSyncMidnight: syncMidnight,
      autoSyncOnScan: syncOnScan,
      syncKey,
      theme: selectedTheme,
      blackboardDarkMode: bbDark,
      showClassesInCalendar: (document.getElementById('setting-show-classes') as HTMLInputElement)?.checked ?? true
    });

    await setBlackboardDarkMode(bbDark);
    void refreshAiKeyLock(true);

    if (syncKey && syncKey !== prevSyncKey) {
      await popupActions.pullTasksFromFirebaseIfNewer();
      popupActions.refreshAllViews();
    }

    applyTheme(selectedTheme);
    try {
      localStorage.setItem('bbs_theme', selectedTheme);
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'THEME_CHANGED', theme: selectedTheme });
      channel.close();
    } catch {}

    alert('Settings saved successfully!');
    popupActions.switchView('calendar');
  });

  const btnTriggerFullRescan = document.getElementById('btn-trigger-full-rescan');
  const btnResetCheckpoint = document.getElementById('btn-reset-checkpoint');
  const rescanStatusMsg = document.getElementById('rescan-status-msg');

  btnTriggerFullRescan?.addEventListener('click', async () => {
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Triggering Full Re-scan on active tab...';
      rescanStatusMsg.style.color = 'var(--text-muted)';
    }
    await popupActions.scanActiveTab(true);
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Full re-scan started. Progress shows at the top; you can close this window.';
      rescanStatusMsg.style.color = 'var(--text-main)';
    }
  });

  btnResetCheckpoint?.addEventListener('click', async () => {
    await saveLastScanCheckpoint({
      lastScannedAt: '',
      processedAnnouncementIds: [],
      processedDirectTaskIds: [],
      processedAnnouncementKeys: []
    });
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Scan cache cleared! Next scan will evaluate all announcements.';
      rescanStatusMsg.style.color = 'var(--text-main)';
    }
    alert('Scan cache has been cleared. Your next scan will examine all announcements from scratch and update existing tasks in place without resetting your data.');
  });

  setupSyncSettingsEvents();
}
