import { getScanStatus, setScanStatus, SCAN_STALE_MS, type ScanStatus } from '../../utils/storage';
import { getSvgIcon } from '../../utils/uiCommon';
import { dom, popupActions, popupState } from './state';

let scanBannerTimer: ReturnType<typeof setTimeout> | null = null;
let scanButtonResetTimer: ReturnType<typeof setTimeout> | null = null;

export function showScanBanner(
  text: string,
  type: 'active' | 'success' | 'info' | 'warning' = 'active',
  autoHideMs?: number
) {
  const headerScanBanner = dom.headerScanBanner();
  const hsbText = dom.hsbText();
  const hsbIcon = dom.hsbIcon();
  if (!headerScanBanner || !hsbText) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }

  const closeBtn = document.getElementById('hsb-close');
  if (closeBtn) {
    closeBtn.title = type === 'active' ? 'Cancel scan' : 'Dismiss';
    closeBtn.setAttribute('aria-label', type === 'active' ? 'Cancel scan' : 'Dismiss notification');
  }

  hsbText.textContent = text;
  headerScanBanner.className = `header-scan-banner is-active is-${type}`;

  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  if (hsbIcon) {
    if (type === 'active') {
      spinner?.classList.add('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    } else if (type === 'success') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-check"></use>`;
    } else if (type === 'warning') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-urgent"></use>`;
    } else {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    }
  }

  if (autoHideMs && autoHideMs > 0) {
    scanBannerTimer = setTimeout(() => {
      hideScanBanner();
    }, autoHideMs);
  }
}

export function hideScanBanner() {
  const headerScanBanner = dom.headerScanBanner();
  if (!headerScanBanner) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }
  headerScanBanner.classList.remove('is-active');
  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  spinner?.classList.remove('is-spinning');
}

export function resetScanButton() {
  const btnScanTab = dom.btnScanTab();
  btnScanTab.disabled = false;
  btnScanTab.style.background = '';
  btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
}

export function stopActiveScan() {
  popupState.scanCancelledByUser = true;
  hideScanBanner();
  resetScanButton();
  if (scanButtonResetTimer) {
    clearTimeout(scanButtonResetTimer);
    scanButtonResetTimer = null;
  }
  try {
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'ABORT_SCAN' }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch {}
  setScanStatus({ state: 'done', message: 'Scan cancelled.', newCount: 0 }).catch(() => {});
}

export function renderScanStatus(status: ScanStatus | null) {
  const btnScanTab = dom.btnScanTab();
  if (!status || popupState.scanCancelledByUser || status.message === 'Scan cancelled.') {
    hideScanBanner();
    resetScanButton();
    return;
  }
  const age = Date.now() - new Date(status.updatedAt).getTime();
  if (scanButtonResetTimer) {
    clearTimeout(scanButtonResetTimer);
    scanButtonResetTimer = null;
  }

  if (status.state === 'running') {
    if (age > SCAN_STALE_MS) {
      hideScanBanner();
      resetScanButton();
      return;
    }
    btnScanTab.disabled = true;
    const label = status.total ? 'Parse...' : 'Scan...';
    btnScanTab.innerHTML = `${getSvgIcon(status.total ? 'sparkles' : 'refresh', 'mr-1 is-spinning')}<span>${label}</span>`;
    showScanBanner(status.message, 'active');
    return;
  }

  if (age > 15 * 1000) {
    hideScanBanner();
    resetScanButton();
    return;
  }

  if (status.state === 'done') {
    const added = status.newCount || 0;
    btnScanTab.disabled = false;
    btnScanTab.style.background = '';
    btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>${added > 0 ? `+${added}` : 'Synced'}</span>`;
    const doneMsg = status.message || (added > 0 ? `Scan complete · ${added} new deadline${added > 1 ? 's' : ''} added` : 'Scan complete · All deadlines up to date');
    showScanBanner(doneMsg, 'success', 3500);
    if (added > 0) {
      popupActions.switchView('calendar');
    }
    scanButtonResetTimer = setTimeout(resetScanButton, 2200);
  } else if (status.state === 'error') {
    btnScanTab.disabled = false;
    btnScanTab.style.background = '';
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Failed</span>`;
    showScanBanner(status.message || 'Scan could not complete. Try again.', 'warning', 4000);
    scanButtonResetTimer = setTimeout(resetScanButton, 3000);
  } else {
    hideScanBanner();
    resetScanButton();
  }
}

export async function scanActiveTab(fullRescan: boolean = false, refreshDataInBackground: () => Promise<void>) {
  const btnScanTab = dom.btnScanTab();
  popupState.scanCancelledByUser = false;
  if (scanButtonResetTimer) {
    clearTimeout(scanButtonResetTimer);
    scanButtonResetTimer = null;
  }
  btnScanTab.disabled = true;
  btnScanTab.style.background = '';
  btnScanTab.innerHTML = `${getSvgIcon('refresh', 'mr-1 is-spinning')}<span>Scan...</span>`;
  showScanBanner(
    fullRescan ? 'Full re-scanning Blackboard stream & courses...' : 'Scanning Blackboard page for deadlines...',
    'active'
  );

  const fail = (message: string) => {
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Error</span>`;
    showScanBanner(message, 'warning', 4500);
    setTimeout(resetScanButton, 3500);
  };

  if (!chrome.runtime?.sendMessage) {
    fail('Background scanner unavailable.');
    return;
  }

  const startedAt = Date.now();

  const runNormalHttpScan = () => {
    chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', fullRescan }, async res => {
      void chrome.runtime.lastError;
      if (popupState.scanCancelledByUser || res?.message === 'Scan cancelled.') {
        resetScanButton();
        hideScanBanner();
        return;
      }
      if (res && !res.ok && res.message) {
        fail(res.message);
        return;
      }
      const status = await getScanStatus().catch(() => null);
      if (status && new Date(status.updatedAt).getTime() >= startedAt) {
        renderScanStatus(status);
      } else {
        resetScanButton();
        hideScanBanner();
      }
      await refreshDataInBackground();
    });
  };

  try {
    const tabs = await chrome.tabs?.query?.({ active: true, currentWindow: true }).catch(() => []) || [];
    const activeTab = tabs[0];
    const isExamTab = Boolean(activeTab?.url && (
      /studentexampage|examschedule|banner.*exam|bannerextensibility|\bexam\b|\bfinal\b/i.test(activeTab.url)
    ));

    if (isExamTab && activeTab?.id) {
      showScanBanner('Reading exam schedule from this page...', 'active');
      const sendTabScan = () => {
        chrome.tabs.sendMessage(activeTab.id!, { type: 'RUN_TAB_SCAN', fullRescan, interactive: true }, async res => {
          void chrome.runtime.lastError;
          if (popupState.scanCancelledByUser || res?.message === 'Scan cancelled.') {
            resetScanButton();
            hideScanBanner();
            return;
          }
          const status = await getScanStatus().catch(() => null);
          if (status && new Date(status.updatedAt).getTime() >= startedAt) {
            renderScanStatus(status);
          } else if (res?.ok) {
            btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>Done</span>`;
            showScanBanner(res.message || 'Exam schedule scanned.', 'success', 4000);
            setTimeout(resetScanButton, 3500);
          } else {
            resetScanButton();
            hideScanBanner();
          }
          await refreshDataInBackground();
        });
      };

      chrome.tabs.sendMessage(activeTab.id, { type: 'PING_SCANNER' }, async pingRes => {
        if (chrome.runtime.lastError || !pingRes?.ok) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id!, allFrames: true },
              files: ['content.js']
            });
            setTimeout(sendTabScan, 300);
          } catch {
            runNormalHttpScan();
          }
        } else {
          sendTabScan();
        }
      });
      watchScanEnd(startedAt, refreshDataInBackground);
      return;
    }
  } catch {}

  runNormalHttpScan();
  watchScanEnd(startedAt, refreshDataInBackground);
}

export function watchScanEnd(startedAt: number, refreshDataInBackground: () => Promise<void>) {
  const btnScanTab = dom.btnScanTab();
  const check = () => {
    if (popupState.scanCancelledByUser || !btnScanTab.disabled || scanButtonResetTimer) return;
    chrome.runtime.sendMessage({ type: 'PING_HTTP_SCANNER' }, async res => {
      if (popupState.scanCancelledByUser) return;
      const lost = Boolean(chrome.runtime.lastError) || !res?.ok;
      if (!lost && res.scanning) {
        setTimeout(check, 1500);
        return;
      }
      const status = await getScanStatus().catch(() => null);
      if (popupState.scanCancelledByUser || !btnScanTab.disabled || scanButtonResetTimer) return;
      if (status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt) {
        renderScanStatus(status);
        await refreshDataInBackground();
        return;
      }
      resetScanButton();
      hideScanBanner();
      if (lost) {
        await refreshDataInBackground();
      }
    });
  };
  setTimeout(check, 1500);
}
