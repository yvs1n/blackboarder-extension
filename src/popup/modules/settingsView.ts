import { AiProvider, DeadlineTask, UserSettings } from '../../types';
import { AUTO_UPDATE_STATUS_KEY, POPUP_PORT_NAME, type AutoUpdateStatus } from '../../background/autoUpdate';
import { BUILD_INFO } from '../../buildInfo';
import { calendarFeedUrl, cleanCalendarFeedShow } from '../../core/calendarLink';
import { filterCleanUserCourses } from '../../core/courseFilter';
import { detectUserDevice } from '../../core/deviceDetection';
import { profileUniversity } from '../../core/studentProfile';
import { IFM_MODEL, normalizeAiBaseUrl, resolveAiEndpoint, testAiEndpoint } from '../../engine/aiProviders';
import { describeAiLock, ensureAiPass, getAiLockState, newAiPass, pairingLink, syncAiKeyLock } from '../../utils/aiKeyLock';
import { compareTasksByTime } from '../../utils/calendar';
import { sanitizeCloudCourses, sanitizeCloudQuickLinks, sanitizeCloudTasks } from '../../utils/cloudSanitize';
import { deleteSyncDataFromFirebase, fetchTasksFromFirebase, pushTasksToFirebase } from '../../utils/firebaseSync';
import { getProfile, saveProfile } from '../../utils/profile';
import { qrSvg } from '../../utils/qrCode';
import { describeSessionBanner, SESSION_STATUS_KEY, type SessionStatus } from '../../utils/sessionStatus';
import {
  generateUniqueSyncKey,
  getCoursesUpdatedAt,
  getQuickLinks,
  getQuickLinksUpdatedAt,
  getSettings,
  getTasks,
  getUserCourses,
  safeSetLocalStorage,
  saveLastScanCheckpoint,
  saveQuickLinks,
  saveSettings,
  saveTasks,
  saveUserCourses,
} from '../../utils/storage';
import { IS_STORE_BUILD } from '../../utils/storeBuild';
import { getLocalTombstones } from '../../utils/tombstones';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import { describeUpdateBanner, ENABLE_UPDATES_HINT, isUpdateStatusFresh } from '../../utils/updateBanner';
import { GITHUB_REPO_URL, GITHUB_ZIP_URL } from '../../utils/updateChecker';
import { getCachedProfile } from '../universitySettings';
import { dom, popupActions, popupState } from './state';
import { applyTheme, setThemeNow } from './theme';

const SITE_URL = 'https://blackboarder.pages.dev';
const COMPANION_URL = `${SITE_URL}/companion/`;

export async function exportJsonBackup() {
  const settings = await getSettings();
  const courses = await getUserCourses();
  const quickLinks = await getQuickLinks();
  const profile = await getProfile().catch(() => null);
  const backupData = {
    version: BUILD_INFO.version,
    exportedAt: new Date().toISOString(),
    tasks: popupState.currentTasks,
    courses,
    quickLinks,
    profile,
    settings
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackboarder_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  popupActions.showToast('Downloaded full backup with courses, syllabi and deadlines!');
}

export async function handleRestoreJson(file: File) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if ((!data.tasks || !Array.isArray(data.tasks)) && (!data.courses || !Array.isArray(data.courses))) {
      alert('Invalid backup file format.');
      return;
    }

    let restoredTaskCount = 0;
    if (data.tasks && Array.isArray(data.tasks)) {
      const existingMap = new Map<string, DeadlineTask>();
      popupState.currentTasks.forEach(t => existingMap.set(t.id, t));

      sanitizeCloudTasks(data.tasks).forEach((t: DeadlineTask) => {
        if (t.title) {
          existingMap.set(t.id, t);
        }
      });

      const merged = Array.from(existingMap.values()).sort(compareTasksByTime);
      await saveTasks(merged);
      popupState.currentTasks = merged;
      restoredTaskCount = data.tasks.length;
    }

    let restoredCourseCount = 0;
    if (data.courses && Array.isArray(data.courses)) {
      const sanitizedCourses = sanitizeCloudCourses(data.courses) || [];
      const cleanCourses = filterCleanUserCourses(sanitizedCourses);
      if (cleanCourses.length > 0) {
        await saveUserCourses(cleanCourses);
        popupState.currentUserCourses = cleanCourses;
        restoredCourseCount = cleanCourses.length;
      }
    }

    if (data.quickLinks && Array.isArray(data.quickLinks)) {
      const cleanLinks = sanitizeCloudQuickLinks(data.quickLinks);
      if (cleanLinks && cleanLinks.length > 0) {
        await saveQuickLinks(cleanLinks);
        popupState.currentQuickLinks = cleanLinks;
      }
    }

    if (data.profile && typeof data.profile === 'object') {
      await saveProfile(data.profile).catch(() => {});
    }

    if (data.settings && typeof data.settings === 'object') {
      await saveSettings(data.settings);
    }

    popupActions.refreshAllViews();
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Restored Backup', true);
    const msg = restoredCourseCount > 0
      ? `Successfully restored ${restoredTaskCount} deadlines and ${restoredCourseCount} courses!`
      : `Successfully restored ${restoredTaskCount} deadlines!`;
    alert(msg);
  } catch (err) {
    console.error('Failed to parse backup JSON:', err);
    alert('Failed to read or parse the JSON backup file.');
  }
}

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

  const settingSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  if (settingSyncKey) settingSyncKey.value = (settings.syncKey || '').toUpperCase();

  const fbBadge = document.getElementById('firebase-status-badge');
  if (fbBadge) {
    fetchTasksFromFirebase(settings.syncKey).then(async res => {
      if (res.deleted && settings.syncKey) {
        await saveSettings({ syncKey: '' });
        safeSetLocalStorage('bbs_persistent_sync_key', '');
        safeSetLocalStorage('bbs_sync_key', '');
        const input = document.getElementById('setting-sync-key') as HTMLInputElement | null;
        if (input) input.value = '';
        popupActions.showToast('Your Sync Key was deleted on another device. This device has been unpaired.');
        popupActions.refreshAllViews();
        return;
      }
      fbBadge.classList.toggle('is-warn', !res.success);
      if (res.success) {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-flame"></use></svg>
            <span>Firebase Cloud: Online (${res.tasks.length} tasks synced${settings.syncKey ? ` - ${settings.syncKey}` : ''})</span>
          </div>
          <span class="fb-status-sub">24/7 Always Active</span>
        `;
      } else {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-urgent"></use></svg>
            <span>Firebase Cloud: Connecting...</span>
          </div>
          <span class="fb-status-sub">Offline fallback active</span>
        `;
      }
    }).catch(() => {});
  }
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

  document.getElementById('btn-copy-sync-key')?.addEventListener('click', async () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement;
    if (input && input.value) {
      try {
        await navigator.clipboard.writeText(input.value.trim());
        popupActions.showToast(`Copied Sync Key: ${input.value.trim()}`);
      } catch {
        prompt('Your Sync Key:', input.value.trim());
      }
    }
  });

  const regenModal = document.getElementById('modal-regen-key-confirm');
  const btnConfirmRegenKey = document.getElementById('btn-confirm-regen-key') as HTMLButtonElement | null;
  const closeRegenModal = () => {
    if (regenModal) {
      regenModal.style.display = 'none';
      regenModal.classList.add('hidden');
    }
  };
  document.getElementById('btn-regen-sync-key')?.addEventListener('click', () => {
    if (regenModal) {
      regenModal.style.display = 'flex';
      regenModal.classList.remove('hidden');
    }
  });
  document.getElementById('btn-close-regen-modal')?.addEventListener('click', closeRegenModal);
  document.getElementById('btn-cancel-regen-key')?.addEventListener('click', closeRegenModal);
  regenModal?.addEventListener('click', e => {
    if (e.target === regenModal) closeRegenModal();
  });
  document.getElementById('btn-regen-export-backup')?.addEventListener('click', async () => {
    await exportJsonBackup();
  });

  btnConfirmRegenKey?.addEventListener('click', async () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement | null;
    const oldSettings = await getSettings();
    const oldKey = (oldSettings.syncKey || '').trim();
    const newKey = generateUniqueSyncKey();

    btnConfirmRegenKey.setAttribute('disabled', 'true');
    popupActions.showToast('Regenerating sync key & self-destructing old cloud data...');

    if (oldKey && oldKey !== newKey && /^[A-Za-z0-9_-]{8,64}$/.test(oldKey)) {
      try { await deleteSyncDataFromFirebase(oldKey); } catch (err) { console.warn('[Sync] Failed to delete old key from Firebase:', err); }
    }

    await saveSettings({ syncKey: newKey });
    safeSetLocalStorage('bbs_persistent_sync_key', newKey);
    safeSetLocalStorage('bbs_sync_key', newKey);
    if (input) input.value = newKey;

    try {
      const [tasks, tombstones, coursesUpdatedAt, linksUpdatedAt] = await Promise.all([
        getTasks(), getLocalTombstones(), getCoursesUpdatedAt(), getQuickLinksUpdatedAt()
      ]);
      await pushTasksToFirebase(
        tasks, 'Chrome Extension (Key Reset)', newKey, popupState.currentQuickLinks,
        tombstones, popupState.currentUserCourses, coursesUpdatedAt || undefined, linksUpdatedAt || undefined
      );
    } catch (err) {
      console.warn('[Sync] Failed to initialize new cloud bucket:', err);
    }

    void refreshAiKeyLock(true);
    try {
      const aiPass = await ensureAiPass();
      const pairUrl = pairingLink(COMPANION_URL, newKey, aiPass);
      const qrHolder = document.getElementById('pairing-qr-code');
      if (qrHolder && !qrHolder.closest('#pairing-qr-panel')?.hasAttribute('hidden')) {
        qrHolder.innerHTML = qrSvg(pairUrl, { label: 'Phone pairing QR code' });
      }
    } catch {}

    btnConfirmRegenKey.removeAttribute('disabled');
    closeRegenModal();
    popupActions.showToast(`New Sync Key active: ${newKey}. Previous cloud data permanently self-destructed.`);
  });

  document.getElementById('btn-download-recovery-key')?.addEventListener('click', async () => {
    const settings = await getSettings();
    const key = (settings.syncKey || '').trim();
    if (!key) {
      popupActions.showToast('No sync key yet. Open the Sync page again in a moment.');
      return;
    }
    const lines = [
      'Blackboarder recovery file', '', 'Sync key: ' + key, '',
      'This key is the only way back to your online deadlines if you lose the data in this browser.',
      'Anyone who has it can see your deadlines, so keep the file private.', '',
      'To restore: use Settings > Data > Restore JSON, or pair your phone with the key below.',
      'To open it on a phone: ' + COMPANION_URL + '?key=' + encodeURIComponent(key)
    ];
    const url = URL.createObjectURL(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blackboarder-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popupActions.showToast('Recovery file saved. Keep it somewhere private.');
  });

  const btnDeleteCloud = document.getElementById('btn-delete-cloud-data') as HTMLButtonElement | null;
  const deleteCloudStatus = document.getElementById('delete-cloud-status');
  let deleteArmedTimer: ReturnType<typeof setTimeout> | null = null;
  const disarmDeleteCloud = () => {
    if (deleteArmedTimer) clearTimeout(deleteArmedTimer);
    deleteArmedTimer = null;
    const label = btnDeleteCloud?.querySelector('span');
    if (label) label.textContent = 'Delete My Online Data';
  };
  btnDeleteCloud?.addEventListener('click', async () => {
    const label = btnDeleteCloud.querySelector('span');
    if (!deleteArmedTimer) {
      if (label) label.textContent = 'Click again to confirm';
      deleteArmedTimer = setTimeout(disarmDeleteCloud, 6000);
      return;
    }
    disarmDeleteCloud();
    btnDeleteCloud.disabled = true;
    const settings = await getSettings();
    const oldKey = (settings.syncKey || '').trim();
    const result = await deleteSyncDataFromFirebase(oldKey);
    if (result.success) {
      const newKey = generateUniqueSyncKey();
      await saveSettings({ syncKey: newKey });
      safeSetLocalStorage('bbs_persistent_sync_key', newKey);
      safeSetLocalStorage('bbs_sync_key', newKey);
      const input = document.getElementById('setting-sync-key') as HTMLInputElement | null;
      if (input) input.value = newKey;

      try {
        const [tasks, tombstones, coursesUpdatedAt, linksUpdatedAt] = await Promise.all([
          getTasks(), getLocalTombstones(), getCoursesUpdatedAt(), getQuickLinksUpdatedAt()
        ]);
        await pushTasksToFirebase(
          tasks, 'Chrome Extension (Reset Data)', newKey, popupState.currentQuickLinks,
          tombstones, popupState.currentUserCourses, coursesUpdatedAt || undefined, linksUpdatedAt || undefined
        );
      } catch (err) {
        console.warn('[Sync] Failed to initialize new cloud bucket after delete:', err);
      }

      void refreshAiKeyLock(true);
      try {
        const aiPass = await ensureAiPass();
        const pairUrl = pairingLink(COMPANION_URL, newKey, aiPass);
        const qrHolder = document.getElementById('pairing-qr-code');
        if (qrHolder && !qrHolder.closest('#pairing-qr-panel')?.hasAttribute('hidden')) {
          qrHolder.innerHTML = qrSvg(pairUrl, { label: 'Phone pairing QR code' });
        }
      } catch {}

      popupActions.showToast('Online data deleted. You have a new sync key.');
    }
    if (deleteCloudStatus) {
      deleteCloudStatus.style.display = 'block';
      deleteCloudStatus.textContent = result.success
        ? 'Done. Everything stored online under your old key is gone. Pair your phone again from the Sync page.'
        : result.message;
    }
    btnDeleteCloud.disabled = false;
  });

  document.getElementById('btn-copy-pairing-link')?.addEventListener('click', async () => {
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    const pairUrl = pairingLink(COMPANION_URL, settings.syncKey || '', aiPass);
    try {
      await navigator.clipboard.writeText(pairUrl);
      alert(`Copied Mobile Pairing Link to clipboard:\n${pairUrl}\n\nOpen this link on your phone to view and sync your deadlines. It also lets that phone use your AI model, so only send it to yourself.`);
    } catch {
      prompt('Mobile Pairing Link:', pairUrl);
    }
  });

  const btnShowPairingQr = document.getElementById('btn-show-pairing-qr');
  const pairingQrPanel = document.getElementById('pairing-qr-panel');
  btnShowPairingQr?.addEventListener('click', async () => {
    if (!pairingQrPanel) return;
    const label = btnShowPairingQr.querySelector('span');
    if (!pairingQrPanel.hidden) {
      pairingQrPanel.hidden = true;
      btnShowPairingQr.setAttribute('aria-expanded', 'false');
      if (label) label.textContent = 'Show Pairing QR Code';
      return;
    }
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    if (!settings.syncKey) {
      popupActions.showToast('No sync key yet. Open the Sync page again in a moment.');
      return;
    }
    const pairUrl = pairingLink(COMPANION_URL, settings.syncKey, aiPass);
    const holder = document.getElementById('pairing-qr-code');
    if (holder) holder.innerHTML = qrSvg(pairUrl, { label: 'Phone pairing QR code' });
    pairingQrPanel.hidden = false;
    btnShowPairingQr.setAttribute('aria-expanded', 'true');
    if (label) label.textContent = 'Hide Pairing QR Code';
  });

  document.getElementById('btn-sync-to-server')?.addEventListener('click', async () => {
    const settings = await getSettings();
    const statusEl = document.getElementById('sync-status-msg');
    if (statusEl) {
      statusEl.textContent = 'Syncing deadlines with cloud (bidirectional)...';
      statusEl.style.color = 'var(--text-muted)';
    }
    await popupActions.pullTasksFromFirebaseIfNewer();
    const [tombstones, coursesUpdatedAt] = await Promise.all([getLocalTombstones(), getCoursesUpdatedAt()]);
    const fbRes = await pushTasksToFirebase(
      popupState.currentTasks, 'Extension Manual Sync', settings.syncKey, popupState.currentQuickLinks,
      tombstones, popupState.currentUserCourses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined
    );
    popupActions.refreshAllViews();
    if (fbRes.success) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--text-main); display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('check')} <span>Synced ${popupState.currentTasks.length} deadlines with Firebase Cloud!</span></span>`;
      }
      alert(`Successfully synchronized ${popupState.currentTasks.length} deadlines with Firebase Realtime Database!\n\nBoth laptop and mobile devices are now up to date.`);
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--text-main); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('urgent')} <span>${escapeHtml(fbRes.message || 'Sync error')}</span></span>`;
      }
      alert(`Mobile sync failed: ${fbRes.message}`);
    }
  });

  document.getElementById('btn-open-mobile-web')?.addEventListener('click', async () => {
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    const targetUrl = pairingLink(COMPANION_URL, settings.syncKey || '', aiPass);
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  });

  const calendarShowSelect = document.getElementById('setting-calendar-show') as HTMLSelectElement | null;
  if (calendarShowSelect) {
    try { calendarShowSelect.value = cleanCalendarFeedShow(localStorage.getItem('bbs_calendar_feed_show')); } catch {}
    calendarShowSelect.addEventListener('change', () => {
      try { localStorage.setItem('bbs_calendar_feed_show', calendarShowSelect.value); } catch {}
    });
  }

  document.getElementById('btn-copy-webcal-link')?.addEventListener('click', async () => {
    const settings = await getSettings();
    const show = cleanCalendarFeedShow(calendarShowSelect?.value);
    const webcalUrl = calendarFeedUrl(SITE_URL, settings.syncKey || '', show, { webcal: true });
    try {
      await navigator.clipboard.writeText(webcalUrl);
      alert(`Copied WebCal link to clipboard:\n${webcalUrl}\n\nPaste this link into Apple Calendar on your iPhone or Google Calendar on the web to subscribe!`);
    } catch {
      prompt('WebCal Subscription Link:', webcalUrl);
    }
  });

  const selectWidgetPlatform = document.getElementById('select-popup-widget-platform') as HTMLSelectElement | null;
  const widgetDeviceBadge = document.getElementById('popup-detected-device-badge');
  const widgetPanels: Record<string, HTMLElement | null> = {
    windows: document.getElementById('popup-widget-panel-windows'),
    ios: document.getElementById('popup-widget-panel-ios'),
    android: document.getElementById('popup-widget-panel-android'),
    mac: document.getElementById('popup-widget-panel-mac')
  };
  const detectedDev = detectUserDevice();
  let defaultPlat = 'windows';
  let badgeLabel = 'Windows PC';
  if (detectedDev.isIos) {
    defaultPlat = 'ios';
    badgeLabel = detectedDev.isIPhone ? 'iPhone' : (detectedDev.isIPad ? 'iPad' : 'iOS');
  } else if (detectedDev.isAndroid) {
    defaultPlat = 'android';
    badgeLabel = 'Android';
  } else if (detectedDev.isMac) {
    defaultPlat = 'mac';
    badgeLabel = 'macOS';
  }
  if (widgetDeviceBadge) widgetDeviceBadge.textContent = badgeLabel;
  if (selectWidgetPlatform) {
    selectWidgetPlatform.value = defaultPlat;
    const updateWidgetPanels = () => {
      const val = selectWidgetPlatform.value;
      Object.keys(widgetPanels).forEach(k => {
        const p = widgetPanels[k];
        if (p) p.style.display = (k === val) ? 'block' : 'none';
      });
    };
    selectWidgetPlatform.addEventListener('change', updateWidgetPanels);
    updateWidgetPanels();
  }

  document.getElementById('btn-popup-copy-sync-key')?.addEventListener('click', async () => {
    const s = await getSettings();
    if (s.syncKey) {
      await navigator.clipboard.writeText(s.syncKey);
      popupActions.showToast(`Copied Sync Key: ${s.syncKey}`);
    } else {
      popupActions.showToast('No Sync Key found. Set up sync first.');
    }
  });
  document.getElementById('btn-popup-copy-ios-wp')?.addEventListener('click', async () => {
    const s = await getSettings();
    const url = `${SITE_URL}/api/wallpaper?key=${s.syncKey || ''}`;
    try { await navigator.clipboard.writeText(url); popupActions.showToast('Copied Dynamic Wallpaper URL!'); } catch { prompt('Dynamic Wallpaper URL:', url); }
  });
  document.getElementById('btn-popup-download-scriptable')?.addEventListener('click', async () => {
    const s = await getSettings();
    const key = s.syncKey || '';
    try {
      const res = await fetch(`${SITE_URL}/widgets/blackboarder-widget.js`);
      let code = await res.text();
      if (key) code = code.replace(/const SYNC_KEY = '';/, `const SYNC_KEY = '${key}';`);
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blackboarder-widget.js';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      popupActions.showToast('Downloaded Scriptable script with your sync key!');
    } catch {
      window.open(`${SITE_URL}/widgets/blackboarder-widget.js`, '_blank');
    }
  });
  document.getElementById('btn-popup-copy-android-web')?.addEventListener('click', async () => {
    const s = await getSettings();
    const url = `${SITE_URL}/widget?key=${s.syncKey || ''}`;
    try { await navigator.clipboard.writeText(url); popupActions.showToast('Copied Live Web Widget URL!'); } catch { prompt('Widget URL:', url); }
  });
  document.getElementById('btn-popup-copy-mac-cmd')?.addEventListener('click', async () => {
    const s = await getSettings();
    const cmd = `curl -fsSL ${SITE_URL}/install-mac.sh | bash -s "${s.syncKey || ''}"`;
    try { await navigator.clipboard.writeText(cmd); popupActions.showToast('Copied 1-Line Terminal Command!'); } catch { prompt('Mac Terminal Command:', cmd); }
  });
  document.getElementById('btn-popup-copy-mac-wp')?.addEventListener('click', async () => {
    const s = await getSettings();
    const url = `${SITE_URL}/api/wallpaper?key=${s.syncKey || ''}&w=3024&h=1964&pos=bottom`;
    try { await navigator.clipboard.writeText(url); popupActions.showToast('Copied Mac Wallpaper URL!'); } catch { prompt('Mac Wallpaper URL:', url); }
  });

  document.getElementById('btn-backup-json')?.addEventListener('click', exportJsonBackup);
  const inputRestoreJson = document.getElementById('input-restore-json') as HTMLInputElement;
  document.getElementById('btn-restore-json-trigger')?.addEventListener('click', () => inputRestoreJson.click());
  inputRestoreJson?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleRestoreJson(file);
      (e.target as HTMLInputElement).value = '';
    }
  });
}

export async function initWalkthroughModal() {
  const modal = document.getElementById('modal-walkthrough');
  if (!modal) return;
  const btnClose = document.getElementById('btn-close-walkthrough');
  const btnNext = document.getElementById('btn-walkthrough-next');
  const btnBack = document.getElementById('btn-walkthrough-back');
  const btnSkip = document.getElementById('btn-walkthrough-skip');
  const btnReplay = document.getElementById('btn-replay-walkthrough');
  const keyDisplay = document.getElementById('wt-key-display');
  const btnCopyKey = document.getElementById('btn-wt-copy-key');
  const stepButtons = modal.querySelectorAll<HTMLButtonElement>('.walkthrough-step-btn');
  const panes = modal.querySelectorAll<HTMLDivElement>('.walkthrough-pane');

  let currentStep = 1;
  const totalSteps = 2;

  document.getElementById('btn-wt-open-bb')?.addEventListener('click', () => {
    closeModal(true);
    const cached = getCachedProfile();
    const uni = profileUniversity(cached);
    const bbUrl = uni.blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
    try { chrome.tabs.create({ url: bbUrl }); } catch { window.open(bbUrl, '_blank', 'noopener'); }
  });

  const settings = await getSettings();
  if (keyDisplay && settings.syncKey) keyDisplay.textContent = settings.syncKey;

  function setStep(step: number) {
    currentStep = Math.max(1, Math.min(totalSteps, step));
    stepButtons.forEach(btn => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      btn.classList.toggle('active', s === currentStep);
    });
    panes.forEach(pane => pane.classList.remove('active'));
    document.getElementById(`walkthrough-pane-${currentStep}`)?.classList.add('active');
    if (btnBack) btnBack.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
    if (btnNext) btnNext.textContent = currentStep === totalSteps ? 'Get Started' : 'Next Step →';
  }

  function openModal() {
    if (!modal) return;
    getSettings().then(s => {
      if (keyDisplay && s.syncKey) keyDisplay.textContent = s.syncKey;
    }).catch(() => {});
    setStep(1);
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  function closeModal(markSeen = true) {
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
    if (markSeen) {
      try { localStorage.setItem('bbs_walkthrough_seen', 'true'); } catch {}
    }
  }

  btnNext?.addEventListener('click', () => {
    if (currentStep < totalSteps) setStep(currentStep + 1);
    else {
      closeModal(true);
      popupActions.showToast('Welcome to Blackboarder! Ready to scan your courses.');
    }
  });
  btnBack?.addEventListener('click', () => { if (currentStep > 1) setStep(currentStep - 1); });
  btnSkip?.addEventListener('click', () => closeModal(true));
  btnClose?.addEventListener('click', () => closeModal(true));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(true); });
  stepButtons.forEach(btn => btn.addEventListener('click', () => setStep(parseInt(btn.getAttribute('data-step') || '1', 10))));
  btnCopyKey?.addEventListener('click', async () => {
    const s = await getSettings();
    if (s.syncKey) {
      try { await navigator.clipboard.writeText(s.syncKey); popupActions.showToast(`Copied Sync Key: ${s.syncKey}`); } catch { popupActions.showToast(`Sync Key: ${s.syncKey}`); }
    }
  });
  document.getElementById('btn-wt-copy-pairing-link')?.addEventListener('click', () => document.getElementById('btn-copy-pairing-link')?.click());
  btnReplay?.addEventListener('click', openModal);

  if (!localStorage.getItem('bbs_walkthrough_seen')) openModal();
}

export function initSessionBanner() {
  const banner = document.getElementById('session-banner');
  const title = document.getElementById('session-banner-title');
  const text = document.getElementById('session-banner-text');
  const open = document.getElementById('btn-session-open-bb');
  if (!banner) return;
  const render = (status: SessionStatus | null | undefined) => {
    const info = describeSessionBanner(status);
    banner.style.display = info ? 'flex' : 'none';
    if (info) {
      if (title) title.textContent = info.title;
      if (text) text.textContent = info.text;
    }
  };
  try {
    chrome.storage.local.get(SESSION_STATUS_KEY, res => render(res?.[SESSION_STATUS_KEY] as SessionStatus | undefined));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SESSION_STATUS_KEY]) render(changes[SESSION_STATUS_KEY].newValue as SessionStatus | undefined);
    });
  } catch {}
  open?.addEventListener('click', () => {
    const bbUrl = profileUniversity(getCachedProfile()).blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
    try { chrome.tabs.create({ url: bbUrl }); } catch { window.open(bbUrl, '_blank', 'noopener'); }
  });
}

export function initExtensionUpdateSystem() {
  const versionBadge = document.getElementById('ext-version-badge');
  const localCommitEl = document.getElementById('ext-local-commit');
  const localDateEl = document.getElementById('ext-local-date');
  const updateBanner = document.getElementById('ext-update-banner');
  const commitBadge = document.getElementById('eub-commit-badge');
  const bannerTitle = document.getElementById('eub-title');
  const bannerDesc = document.getElementById('eub-desc');
  const btnDismiss = document.getElementById('btn-ext-update-dismiss');
  const btnLater = document.getElementById('btn-ext-update-later');
  const btnApplyUpdateBanner = document.getElementById('btn-ext-apply-update');
  const btnApplyUpdateSettings = document.getElementById('btn-apply-update-settings');
  const btnDownloadBanner = document.getElementById('btn-ext-download-update');
  const btnReloadBanner = document.getElementById('btn-ext-reload');
  const btnCheckManual = document.getElementById('btn-check-ext-update');
  const btnReloadSettings = document.getElementById('btn-reload-ext-settings');
  const btnDownloadSettings = document.getElementById('btn-download-ext-zip');
  const btnOpenGithub = document.getElementById('btn-open-github-repo');
  const statusPill = document.getElementById('ext-update-status-pill');
  const statusDesc = document.getElementById('ext-update-status-desc');

  if (versionBadge) versionBadge.textContent = 'v' + BUILD_INFO.version;
  if (IS_STORE_BUILD) {
    const card = document.getElementById('card-extension-updates');
    const subtitle = card?.querySelector('.settings-card-subtitle');
    if (subtitle) subtitle.textContent = 'Your browser updates Blackboarder automatically through its extension store.';
    if (statusPill) statusPill.textContent = 'Managed by the store';
    if (statusDesc) statusDesc.textContent = 'Installed version: v' + BUILD_INFO.version + '. New versions arrive on their own, usually within a day of being published.';
    [btnCheckManual, btnReloadSettings, btnDownloadSettings, btnOpenGithub, btnApplyUpdateSettings].forEach(b => {
      const holder = b?.closest('div[style*="display: flex; flex-direction: column"]');
      if (holder) holder.remove();
    });
    return;
  }
  if (localCommitEl) localCommitEl.textContent = BUILD_INFO.shortCommit;
  if (localDateEl) {
    const d = new Date(BUILD_INFO.timestamp);
    localDateEl.textContent = isNaN(d.getTime()) ? 'latest build' : d.toLocaleDateString();
  }

  try { chrome.runtime.connect({ name: POPUP_PORT_NAME }); } catch {}

  const DISMISSED_KEY = 'bbs_dismissed_update_build';
  const ENABLE_HINT = ENABLE_UPDATES_HINT;
  let shownStatus: AutoUpdateStatus | null = null;

  const openUrl = (url: string) => {
    try { if (chrome.tabs?.create) { chrome.tabs.create({ url }); return; } } catch {}
    window.open(url, '_blank');
  };
  const downloadUpdatePackage = () => openUrl(GITHUB_ZIP_URL);
  const setLabel = (btn: HTMLElement | null, text: string) => {
    const span = btn?.querySelector('span');
    if (span) span.textContent = text;
  };
  const setPill = (text: string, color: 'green' | 'blue' | 'orange' | 'gray') => {
    if (!statusPill) return;
    statusPill.textContent = text;
    statusPill.className = `settings-pill pill-${color}`;
  };
  const showBanner = (title: string, desc: string, primary: 'download' | 'restart' | 'update' | 'none', dismissible = true) => {
    if (!updateBanner) return;
    updateBanner.style.display = 'flex';
    if (commitBadge) commitBadge.textContent = shownStatus?.remoteShortCommit || shownStatus?.remoteBuild || 'new';
    if (bannerTitle) bannerTitle.textContent = title;
    if (bannerDesc) bannerDesc.textContent = desc;
    if (btnApplyUpdateBanner) btnApplyUpdateBanner.style.display = primary === 'update' ? '' : 'none';
    if (btnDownloadBanner) btnDownloadBanner.style.display = primary === 'download' ? '' : 'none';
    if (btnReloadBanner) {
      btnReloadBanner.style.display = (primary === 'none' || primary === 'update') ? 'none' : '';
      btnReloadBanner.className = primary === 'restart' ? 'btn-eub-primary' : 'btn-eub-secondary';
    }
    setLabel(btnReloadBanner, primary === 'restart' ? 'Restart now' : 'Reload');
    if (btnLater) btnLater.style.display = dismissible ? '' : 'none';
    if (btnDismiss) btnDismiss.style.display = dismissible ? '' : 'none';
  };
  const hideBanner = () => { if (updateBanner) updateBanner.style.display = 'none'; };

  const render = (status: AutoUpdateStatus | null, manual: boolean) => {
    shownStatus = status;
    const installed = `build ${BUILD_INFO.build || 'dev'} (${BUILD_INFO.shortCommit})`;
    if (!status) { setPill('Checking...', 'blue'); return; }
    const remoteNote = status.remoteMessage ? ` - "${status.remoteMessage}"` : '';
    const dismissedBuild = (() => { try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; } })();
    const banner = describeUpdateBanner(status, manual ? null : dismissedBuild);
    if (banner) showBanner(banner.title, banner.desc, banner.primary, banner.dismissible);
    else hideBanner();

    if (btnApplyUpdateSettings) btnApplyUpdateSettings.style.display = 'none';
    switch (status.state) {
      case 'updated':
        setPill('Restart pending', 'blue');
        if (statusDesc) statusDesc.textContent = `A new version${remoteNote} was installed. Blackboarder restarts into it when you close this window. Your data stays intact.`;
        break;
      case 'update-available':
        setPill('Update Available', 'orange');
        if (btnApplyUpdateSettings) btnApplyUpdateSettings.style.display = status.helperInstalled ? '' : 'none';
        if (statusDesc) {
          statusDesc.textContent = status.helperInstalled
            ? `A new version${remoteNote} is on GitHub. Click Update Now to download and install. Your data stays intact.`
            : `A new version${remoteNote} is on GitHub. To install it and every future update automatically, ${ENABLE_HINT}.`;
        }
        break;
      case 'dev-checkout':
        setPill('Update waiting', 'orange');
        if (statusDesc) statusDesc.textContent = `Git clone: a new version${remoteNote} is on GitHub but was not pulled automatically. ${status.error || 'Run git pull.'}`;
        break;
      case 'offline':
        setPill('Offline', 'gray');
        if (statusDesc) statusDesc.textContent = `Could not reach GitHub. Installed ${installed}; Blackboarder checks again in 15 minutes.`;
        break;
      case 'error':
        setPill('Update failed', 'orange');
        if (statusDesc) statusDesc.textContent = `The automatic update failed (${status.error || 'unknown error'}). It retries every 15 minutes, or ${ENABLE_HINT} to update by hand.`;
        break;
      default:
        setPill('Up to Date', 'green');
        if (statusDesc) {
          statusDesc.textContent = status.helperInstalled
            ? `Automatic updates are on. You have the latest version (${installed}).`
            : `You have the latest version (${installed}). Automatic updates are off: ${ENABLE_HINT} to turn them on.`;
        }
    }
  };

  const askBackground = (type: 'RUN_AUTO_UPDATE' | 'GET_AUTO_UPDATE_STATUS'): Promise<AutoUpdateStatus | null> =>
    new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type }, res => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res?.ok ? (res.status as AutoUpdateStatus) || null : null);
        });
      } catch {
        resolve(null);
      }
    });

  const applyUpdateNow = async (btn: HTMLElement | null) => {
    if (btn) {
      btn.setAttribute('disabled', 'true');
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Updating...';
    }
    popupActions.showToast('Updating Blackboarder... Please wait');
    const res = await new Promise<{ ok: boolean; status?: AutoUpdateStatus; error?: string }>(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'APPLY_UPDATE' }, r => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(r || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
    if (btn) {
      btn.removeAttribute('disabled');
      const span = btn.querySelector('span');
      if (span) {
        if (btn.id === 'btn-check-ext-update') span.textContent = 'Check for Updates';
        else if (btn.id === 'btn-ext-apply-update') span.textContent = 'Update now';
        else span.textContent = 'Update Now';
      }
    }
    if (res?.ok && res.status) {
      render(res.status, true);
      if (res.status.state === 'updated') popupActions.showToast('Update installed! Click Restart now to finish.');
    } else {
      popupActions.showToast(res?.error || 'Update failed. Check Settings or update manually.');
    }
  };

  const performCheck = async (manual: boolean) => {
    if (manual) {
      setPill('Checking...', 'blue');
      if (statusDesc) statusDesc.textContent = 'Checking GitHub for a newer version...';
    }
    const status = await askBackground('RUN_AUTO_UPDATE');
    if (status) {
      render(status, manual);
      if (manual) {
        switch (status.state) {
          case 'update-available':
            if (status.helperInstalled) applyUpdateNow(btnCheckManual);
            else popupActions.showToast('New version available! Run update.bat or download ZIP.');
            break;
          case 'updated': popupActions.showToast('Update installed. It applies when you close this window.'); break;
          case 'dev-checkout': popupActions.showToast('New version on GitHub. Run git pull to update.'); break;
          case 'offline': popupActions.showToast('Could not reach GitHub right now.'); break;
          case 'error': popupActions.showToast('Update check failed. See Settings for details.'); break;
          default: popupActions.showToast(BUILD_INFO.build ? `Blackboarder is up to date (${BUILD_INFO.build})!` : 'Blackboarder is up to date!'); break;
        }
      }
    } else if (manual) {
      popupActions.showToast('Could not check for updates right now.');
    }
  };

  const restart = () => chrome.runtime.reload();
  btnApplyUpdateBanner?.addEventListener('click', () => applyUpdateNow(btnApplyUpdateBanner));
  btnApplyUpdateSettings?.addEventListener('click', () => applyUpdateNow(btnApplyUpdateSettings));
  btnDownloadBanner?.addEventListener('click', downloadUpdatePackage);
  btnDownloadSettings?.addEventListener('click', downloadUpdatePackage);
  btnOpenGithub?.addEventListener('click', () => openUrl(GITHUB_REPO_URL));
  btnReloadBanner?.addEventListener('click', restart);
  btnReloadSettings?.addEventListener('click', restart);
  btnCheckManual?.addEventListener('click', () => performCheck(true));

  const dismissCurrentBanner = () => {
    hideBanner();
    if (shownStatus?.remoteBuild) {
      try { localStorage.setItem(DISMISSED_KEY, shownStatus.remoteBuild); } catch {}
    }
  };
  btnDismiss?.addEventListener('click', dismissCurrentBanner);
  btnLater?.addEventListener('click', dismissCurrentBanner);

  setTimeout(async () => {
    const saved = await askBackground('GET_AUTO_UPDATE_STATUS');
    if (saved && saved.installedBuild === BUILD_INFO.build) render(saved, false);
    if (!isUpdateStatusFresh(saved, BUILD_INFO.build)) performCheck(false);
  }, 350);

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes[AUTO_UPDATE_STATUS_KEY]) return;
      const next = changes[AUTO_UPDATE_STATUS_KEY].newValue as AutoUpdateStatus | undefined;
      if (next && next.installedBuild === BUILD_INFO.build) render(next, false);
    });
  } catch {}
}
