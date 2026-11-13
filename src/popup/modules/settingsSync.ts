import { DeadlineTask, UserSettings } from '../../types';
import { BUILD_INFO } from '../../buildInfo';
import { calendarFeedUrl, cleanCalendarFeedShow } from '../../core/calendarLink';
import { filterCleanUserCourses } from '../../core/courseFilter';
import { detectUserDevice } from '../../core/deviceDetection';
import { createArmedAction } from '../../core/stateMachine';
import { ensureAiPass, pairingLink } from '../../utils/aiKeyLock';
import { compareTasksByTime } from '../../utils/calendar';
import { sanitizeCloudCourses, sanitizeCloudQuickLinks, sanitizeCloudTasks } from '../../utils/cloudSanitize';
import { deleteSyncDataFromFirebase, fetchTasksFromFirebase, pushTasksToFirebase } from '../../utils/firebaseSync';
import { getProfile, saveProfile } from '../../utils/profile';
import { qrSvg } from '../../utils/qrCode';
import {
  generateUniqueSyncKey,
  getCoursesUpdatedAt,
  getQuickLinks,
  getQuickLinksUpdatedAt,
  getSettings,
  getTasks,
  getUserCourses,
  safeSetLocalStorage,
  saveQuickLinks,
  saveSettings,
  saveTasks,
  saveUserCourses,
} from '../../utils/storage';
import { getLocalTombstones } from '../../utils/tombstones';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { popupActions, popupState } from './state';
import { refreshAiKeyLock } from './settingsView';

export const SITE_URL = 'https://blackboarder.pages.dev';
export const COMPANION_URL = `${SITE_URL}/companion/`;

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

export function loadSyncStatus(settings: UserSettings): void {
  const settingSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  if (settingSyncKey) settingSyncKey.value = (settings.syncKey || '').toUpperCase();

  const fbBadge = document.getElementById('firebase-status-badge');
  if (!fbBadge) return;

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

async function activateNewSyncKey(newKey: string, pushReason: string): Promise<void> {
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
      tasks, pushReason, newKey, popupState.currentQuickLinks,
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
}

function setupWidgetPlatformCards(): void {
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
}

export function setupSyncSettingsEvents(): void {
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
  const closeRegenModal = () => closeModalEl('modal-regen-key-confirm', regenModal);
  registerOverlayCloseHandler('modal-regen-key-confirm', closeRegenModal);
  document.getElementById('btn-regen-sync-key')?.addEventListener('click', () => {
    openModalEl('modal-regen-key-confirm', regenModal);
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
    const oldSettings = await getSettings();
    const oldKey = (oldSettings.syncKey || '').trim();
    const newKey = generateUniqueSyncKey();

    btnConfirmRegenKey.setAttribute('disabled', 'true');
    popupActions.showToast('Regenerating sync key & self-destructing old cloud data...');

    if (oldKey && oldKey !== newKey && /^[A-Za-z0-9_-]{8,64}$/.test(oldKey)) {
      try { await deleteSyncDataFromFirebase(oldKey); } catch (err) { console.warn('[Sync] Failed to delete old key from Firebase:', err); }
    }

    await activateNewSyncKey(newKey, 'Chrome Extension (Key Reset)');

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
  const deleteCloudAction = btnDeleteCloud ? createArmedAction({
    timeoutMs: 6000,
    idleLabel: 'Delete My Online Data',
    armedLabel: 'Click again to confirm',
    runningLabel: 'Deleting...',
    onStateChange(armState, labelText) {
      btnDeleteCloud.dataset.armState = armState;
      btnDeleteCloud.disabled = armState === 'running';
      const label = btnDeleteCloud.querySelector('span');
      if (label) label.textContent = labelText;
    },
    async onExecute() {
      const settings = await getSettings();
      const oldKey = (settings.syncKey || '').trim();
      const result = await deleteSyncDataFromFirebase(oldKey);
      if (result.success) {
        const newKey = generateUniqueSyncKey();
        await activateNewSyncKey(newKey, 'Chrome Extension (Reset Data)');
        popupActions.showToast('Online data deleted. You have a new sync key.');
      }
      if (deleteCloudStatus) {
        deleteCloudStatus.style.display = 'block';
        deleteCloudStatus.textContent = result.success
          ? 'Done. Everything stored online under your old key is gone. Pair your phone again from the Sync page.'
          : result.message;
      }
    }
  }) : null;
  if (btnDeleteCloud) btnDeleteCloud.dataset.armState = 'idle';
  btnDeleteCloud?.addEventListener('click', () => { void deleteCloudAction?.trigger(); });

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

  setupWidgetPlatformCards();

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
