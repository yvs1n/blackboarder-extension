import {
  AUTO_UPDATE_ENABLED_KEY,
  AUTO_UPDATE_STATUS_KEY,
  JUST_UPDATED_KEY,
  POPUP_PORT_NAME,
  SHOW_CHANGELOG_KEY,
  type AutoUpdateStatus
} from '../../background/autoUpdate';
import { BUILD_INFO } from '../../buildInfo';
import { createStateMachine } from '../../core/stateMachine';
import { IS_STORE_BUILD } from '../../utils/storeBuild';
import { describeUpdateBanner, ENABLE_UPDATES_HINT, isUpdateStatusFresh } from '../../utils/updateBanner';
import {
  EDGE_ADDONS_URL,
  CHROME_WEB_STORE_URL,
  FEEDBACK_URL,
  GITHUB_REPO_URL,
  GITHUB_ZIP_URL,
  PRIVACY_POLICY_URL,
  storeForBrowser,
  TERMS_OF_SERVICE_URL
} from '../../utils/updateChecker';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { popupActions } from './state';

const LAST_SEEN_BUILD_KEY = 'bbs_last_seen_build';

export type UpdateActionState = 'idle' | 'checking' | 'applying' | 'restarting';
export type UpdateActionEvent = 'CHECK' | 'APPLY' | 'RESTART' | 'FINISH';

export const updateActionMachine = createStateMachine<UpdateActionState, UpdateActionEvent>({
  initial: 'idle',
  transitions: {
    idle: { CHECK: 'checking', APPLY: 'applying', RESTART: 'restarting' },
    checking: { APPLY: 'applying', FINISH: 'idle' },
    applying: { RESTART: 'restarting', FINISH: 'idle' },
    restarting: { FINISH: 'idle' }
  }
});

export function resetUpdateActionState(): void {
  updateActionMachine.reset();
}

function getChangelogEntries(): string[] {
  const entries = (BUILD_INFO as { changelog?: readonly string[] }).changelog;
  if (Array.isArray(entries) && entries.length > 0) return [...entries];
  return BUILD_INFO.message ? [BUILD_INFO.message] : ['Bug fixes and performance improvements.'];
}

function populateChangelogList(listEl: HTMLElement | null, entries: string[]): void {
  if (!listEl) return;
  listEl.replaceChildren(
    ...entries.map(item => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    })
  );
}

function initChangelogUiAndModal(): void {
  const entries = getChangelogEntries();
  const versionLabel = `v${BUILD_INFO.version}`;

  const settingsVer = document.getElementById('ext-changelog-version');
  const settingsCommit = document.getElementById('ext-changelog-commit-summary');
  const settingsList = document.getElementById('ext-settings-changelog-list');
  if (settingsVer) settingsVer.textContent = versionLabel;
  if (settingsCommit) settingsCommit.textContent = BUILD_INFO.message || 'Latest release';
  populateChangelogList(settingsList, entries);

  const modalVer = document.getElementById('changelog-modal-version');
  const modalSub = document.getElementById('changelog-modal-subtitle');
  const modalCommit = document.getElementById('changelog-modal-commit');
  const modalList = document.getElementById('changelog-modal-list');
  if (modalVer) modalVer.textContent = versionLabel;
  if (modalSub) modalSub.textContent = `Build ${BUILD_INFO.build || 'local'}${BUILD_INFO.shortCommit ? ` • ${BUILD_INFO.shortCommit}` : ''}`;
  if (modalCommit) modalCommit.textContent = BUILD_INFO.message || 'Latest release';
  populateChangelogList(modalList, entries);

  const changelogModal = document.getElementById('modal-changelog');
  const closeChangelog = () => closeModalEl('modal-changelog', changelogModal);
  if (changelogModal) {
    registerOverlayCloseHandler('modal-changelog', closeChangelog);
    document.getElementById('btn-close-changelog-modal')?.addEventListener('click', closeChangelog);
    document.getElementById('btn-dismiss-changelog-modal')?.addEventListener('click', closeChangelog);
    changelogModal.addEventListener('click', e => {
      if (e.target === changelogModal) closeChangelog();
    });
  }

  const showChangelogInput = document.getElementById('setting-show-changelog') as HTMLInputElement | null;
  let localShowPref = true;
  try { localShowPref = localStorage.getItem(SHOW_CHANGELOG_KEY) !== 'false'; } catch {}
  if (showChangelogInput) {
    showChangelogInput.checked = localShowPref;
    try {
      chrome.storage?.local?.get([SHOW_CHANGELOG_KEY], res => {
        if (typeof res?.[SHOW_CHANGELOG_KEY] === 'boolean') {
          showChangelogInput.checked = res[SHOW_CHANGELOG_KEY];
          try { localStorage.setItem(SHOW_CHANGELOG_KEY, String(res[SHOW_CHANGELOG_KEY])); } catch {}
        }
      });
    } catch {}
    showChangelogInput.addEventListener('change', () => {
      const checked = showChangelogInput.checked;
      try { localStorage.setItem(SHOW_CHANGELOG_KEY, String(checked)); } catch {}
      try { chrome.storage?.local?.set({ [SHOW_CHANGELOG_KEY]: checked }); } catch {}
    });
  }

  const checkPostUpdateChangelog = async () => {
    if (!changelogModal || !BUILD_INFO.build) return;
    let prevSeenBuild: string | null = null;
    let walkthroughSeen = false;
    try {
      prevSeenBuild = localStorage.getItem(LAST_SEEN_BUILD_KEY);
      walkthroughSeen = Boolean(localStorage.getItem('bbs_walkthrough_seen'));
      localStorage.setItem(LAST_SEEN_BUILD_KEY, BUILD_INFO.build);
    } catch {}

    let justUpdated: unknown = null;
    let storageShowPref: unknown = undefined;
    try {
      const res = await new Promise<Record<string, any>>(resolve => {
        if (!chrome.storage?.local?.get) { resolve({}); return; }
        chrome.storage.local.get([JUST_UPDATED_KEY, SHOW_CHANGELOG_KEY], r => resolve(r || {}));
      });
      justUpdated = res[JUST_UPDATED_KEY];
      storageShowPref = res[SHOW_CHANGELOG_KEY];
      if (justUpdated) chrome.storage.local.remove(JUST_UPDATED_KEY);
    } catch {}

    const showEnabled = typeof storageShowPref === 'boolean' ? storageShowPref : localShowPref;
    const buildChanged = Boolean(prevSeenBuild && prevSeenBuild !== BUILD_INFO.build);
    if ((Boolean(justUpdated) || buildChanged) && showEnabled && walkthroughSeen) {
      openModalEl('modal-changelog', changelogModal);
    }
  };
  void checkPostUpdateChangelog();
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
  const autoUpdateInput = document.getElementById('setting-auto-update') as HTMLInputElement | null;
  const migrationBanner = document.getElementById('cws-migration-banner');
  const migrationCard = document.getElementById('card-cws-migration');

  const openUrl = (url: string) => {
    try { if (chrome.tabs?.create) { chrome.tabs.create({ url }); return; } } catch {}
    window.open(url, '_blank');
  };

  document.getElementById('btn-open-feedback')?.addEventListener('click', () => openUrl(FEEDBACK_URL));
  document.getElementById('btn-open-privacy')?.addEventListener('click', () => openUrl(PRIVACY_POLICY_URL));
  document.getElementById('btn-open-terms')?.addEventListener('click', () => openUrl(TERMS_OF_SERVICE_URL));

  if (versionBadge) versionBadge.textContent = 'v' + BUILD_INFO.version;
  initChangelogUiAndModal();
  if (IS_STORE_BUILD) {
    const store = storeForBrowser();
    const card = document.getElementById('card-extension-updates');
    const subtitle = card?.querySelector('.settings-card-subtitle');
    if (subtitle) subtitle.textContent = `Updates install automatically via ${store.name}.`;
    if (statusPill) {
      statusPill.textContent = store.shortName;
      statusPill.className = 'settings-pill pill-green';
    }
    if (statusDesc) statusDesc.textContent = 'Installed version: v' + BUILD_INFO.version + '. Updates are delivered automatically by Chrome Web Store, Edge Add-ons, or Firefox Add-ons.';
    autoUpdateInput?.closest('.toggle-control-row')?.remove();
    migrationBanner?.remove();
    migrationCard?.remove();
    updateBanner?.remove();
    [btnCheckManual, btnReloadSettings, btnDownloadSettings, btnOpenGithub, btnApplyUpdateSettings].forEach(b => {
      const holder = b?.closest('div[style*="display: flex; flex-direction: column"]');
      if (holder) holder.remove();
    });
    return;
  }

  // Unpacked GitHub build: guide existing users to migrate smoothly to their browser's store without data loss
  const store = storeForBrowser();
  const MIGRATION_DISMISSED_KEY = 'bbs_dismissed_cws_migration';
  if (migrationCard) migrationCard.style.display = 'block';
  const triggerBackup = () => document.getElementById('btn-backup-json')?.click();
  document.getElementById('btn-cws-migration-backup')?.addEventListener('click', triggerBackup);
  document.getElementById('btn-cws-banner-backup')?.addEventListener('click', triggerBackup);
  const storeUrl = store.url || CHROME_WEB_STORE_URL || EDGE_ADDONS_URL;
  document.getElementById('btn-cws-migration-store')?.addEventListener('click', () => openUrl(storeUrl));
  document.getElementById('btn-cws-banner-store')?.addEventListener('click', () => openUrl(storeUrl));
  const dismissMigrationBanner = () => {
    if (migrationBanner) migrationBanner.style.display = 'none';
    try { localStorage.setItem(MIGRATION_DISMISSED_KEY, BUILD_INFO.version || '1.8.35'); } catch {}
  };
  document.getElementById('btn-cws-banner-dismiss')?.addEventListener('click', dismissMigrationBanner);
  document.getElementById('btn-cws-banner-later')?.addEventListener('click', dismissMigrationBanner);
  try {
    if (migrationBanner && localStorage.getItem(MIGRATION_DISMISSED_KEY) !== (BUILD_INFO.version || '1.8.35')) {
      migrationBanner.style.display = 'flex';
    }
  } catch {}
  if (localCommitEl) localCommitEl.textContent = BUILD_INFO.shortCommit;
  if (localDateEl) {
    const d = new Date(BUILD_INFO.timestamp);
    localDateEl.textContent = isNaN(d.getTime()) ? 'latest build' : d.toLocaleDateString();
  }

  try { chrome.runtime.connect({ name: POPUP_PORT_NAME }); } catch {}

  const DISMISSED_KEY = 'bbs_dismissed_update_build';
  const ENABLE_HINT = ENABLE_UPDATES_HINT;
  let shownStatus: AutoUpdateStatus | null = null;
  let autoUpdatePref = true;
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
            ? (autoUpdatePref
              ? `Automatic updates are on. You have the latest version (${installed}).`
              : `Automatic updates are paused. You have the latest version (${installed}).`)
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
    if (!updateActionMachine.send('APPLY')) return;
    if (btn) {
      btn.setAttribute('disabled', 'true');
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Updating...';
    }
    popupActions.showToast('Updating Blackboarder... Please wait');
    try {
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
        if (res.status.state === 'updated') {
          updateActionMachine.send('RESTART');
          if (btn) {
            btn.setAttribute('disabled', 'true');
            const span = btn.querySelector('span');
            if (span) span.textContent = 'Restarting...';
          }
          popupActions.showToast('Update installed! Restarting Blackboarder...');
          setTimeout(() => {
            try {
              chrome.runtime.reload();
            } catch {
              /* ignore if background worker already initiated reload */
            }
          }, 120);
          return;
        } else if (res.status.state === 'up-to-date') {
          popupActions.showToast('Blackboarder is already up to date!');
        } else if (res.status.state === 'error' || res.status.state === 'dev-checkout') {
          popupActions.showToast(res.status.error || 'Update failed. Check Settings > Updates.');
        } else if (res.status.state === 'update-available' && !res.status.helperInstalled) {
          popupActions.showToast('Auto-updater is not connected. Run update.bat in your Blackboarder folder.');
        }
      } else if (res?.error && /message port closed/i.test(res.error)) {
        updateActionMachine.send('RESTART');
        popupActions.showToast('Update installed! Restarting Blackboarder...');
        return;
      } else {
        popupActions.showToast(res?.error || 'Update failed. Check Settings or update manually.');
      }
    } finally {
      if (updateActionMachine.state() !== 'restarting') {
        updateActionMachine.send('FINISH');
      }
    }
  };

  const performCheck = async (manual: boolean) => {
    if (manual && !updateActionMachine.send('CHECK')) return;
    if (manual) {
      setPill('Checking...', 'blue');
      if (statusDesc) statusDesc.textContent = 'Checking GitHub for a newer version...';
    }
    try {
      const status = await askBackground('RUN_AUTO_UPDATE');
      if (status) {
        render(status, manual);
        if (manual) {
          switch (status.state) {
            case 'update-available':
              if (status.helperInstalled) {
                await applyUpdateNow(btnCheckManual);
                return;
              }
              popupActions.showToast('New version available! Open Settings > Updates or download ZIP.');
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
    } finally {
      if (manual && updateActionMachine.state() === 'checking') {
        updateActionMachine.send('FINISH');
      }
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

  if (autoUpdateInput) {
    try {
      chrome.storage?.local?.get([AUTO_UPDATE_ENABLED_KEY], res => {
        autoUpdatePref = res?.[AUTO_UPDATE_ENABLED_KEY] !== false;
        autoUpdateInput.checked = autoUpdatePref;
        if (shownStatus) render(shownStatus, false);
      });
    } catch {}
    autoUpdateInput.addEventListener('change', () => {
      autoUpdatePref = autoUpdateInput.checked;
      try { chrome.storage?.local?.set({ [AUTO_UPDATE_ENABLED_KEY]: autoUpdatePref }); } catch {}
      if (autoUpdatePref && shownStatus?.state === 'update-available' && shownStatus.helperInstalled) {
        void applyUpdateNow(btnApplyUpdateSettings);
      } else if (shownStatus) {
        render(shownStatus, false);
      }
    });
  }

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
