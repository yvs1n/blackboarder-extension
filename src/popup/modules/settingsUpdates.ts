import { AUTO_UPDATE_STATUS_KEY, POPUP_PORT_NAME, type AutoUpdateStatus } from '../../background/autoUpdate';
import { BUILD_INFO } from '../../buildInfo';
import { IS_STORE_BUILD } from '../../utils/storeBuild';
import { describeUpdateBanner, ENABLE_UPDATES_HINT, isUpdateStatusFresh } from '../../utils/updateBanner';
import { GITHUB_REPO_URL, GITHUB_ZIP_URL } from '../../utils/updateChecker';
import { popupActions } from './state';

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
