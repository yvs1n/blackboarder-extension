import { BUILD_INFO } from '../buildInfo';
import { fetchRemoteVersion, isRemoteNewer } from '../utils/updateChecker';

/*
 * Automatic updates for the unpacked extension, standing in for the Chrome Web Store.
 *
 * An unpacked extension cannot change its own files, so a small helper does it: update.bat /
 * update.sh registers updater/ as a native messaging host once. After that the extension checks
 * GitHub every 15 minutes (and whenever the popup opens); when the main branch has a newer build it asks the helper to download it into
 * the extension folder, then reloads itself as soon as no popup or side panel is open. In a git
 * clone the helper runs git pull --ff-only instead, and skips it when that could lose work.
 */

export const NATIVE_HOST_NAME = 'com.blackboarder.updater';
export const POPUP_PORT_NAME = 'bbs-popup';
const CHECK_ALARM = 'bbs-auto-update';
const RELOAD_ALARM = 'bbs-auto-update-reload';
// GitHub's raw files are cheap to read, so check often enough that a new build is offered quickly
const CHECK_PERIOD_MINUTES = 15;
export const AUTO_UPDATE_STATUS_KEY = 'bbs_auto_update_status';
const STATUS_KEY = AUTO_UPDATE_STATUS_KEY;

export type AutoUpdateState =
  | 'up-to-date'
  | 'updated' // new files are on disk; the extension reloads when idle
  | 'update-available' // newer build on GitHub, but the helper is not set up
  | 'dev-checkout' // loaded from a git clone: git pull + npm run build
  | 'offline'
  | 'error';

export interface AutoUpdateStatus {
  state: AutoUpdateState;
  /** Whether the update helper answered */
  helperInstalled: boolean;
  installedBuild: string;
  remoteBuild?: string;
  remoteShortCommit?: string;
  remoteMessage?: string;
  checkedAt: string;
  error?: string;
}

interface HelperReply {
  ok: boolean;
  changed?: boolean;
  build?: string;
  code?: string;
  error?: string;
  devCheckout?: boolean;
}

function sendToHelper(message: { type: 'ping' | 'update'; build?: string }): Promise<HelperReply | null> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, reply => {
        // lastError means the helper is not registered for this extension
        if (chrome.runtime.lastError || !reply) resolve(null);
        else resolve(reply as HelperReply);
      });
    } catch {
      resolve(null);
    }
  });
}

/** The build whose files are in the extension folder right now (may be newer than the running code). */
async function readBuildOnDisk(): Promise<string | null> {
  try {
    const res = await fetch(chrome.runtime.getURL('version.json'), { cache: 'no-store' });
    const data = res.ok ? await res.json() : null;
    return typeof data?.build === 'string' ? data.build : null;
  } catch {
    return null;
  }
}

async function hasNewFilesOnDisk(): Promise<boolean> {
  const onDisk = await readBuildOnDisk();
  return Boolean(onDisk && BUILD_INFO.build && onDisk !== BUILD_INFO.build);
}

/** True while a popup, side panel or extension tab is open, so a reload would close it under the user. */
async function isExtensionUiOpen(): Promise<boolean> {
  try {
    const getContexts = (chrome.runtime as any).getContexts;
    if (typeof getContexts !== 'function') return false;
    const contexts = await getContexts({ contextTypes: ['POPUP', 'SIDE_PANEL', 'TAB'] });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
}

/** Restarts into the new files now, or retries every minute until the extension's UI is closed. */
async function reloadWhenIdle(): Promise<void> {
  if (!(await hasNewFilesOnDisk())) return;
  if (await isExtensionUiOpen()) {
    chrome.alarms.create(RELOAD_ALARM, { delayInMinutes: 1 });
    return;
  }
  chrome.runtime.reload();
}

async function saveStatus(status: AutoUpdateStatus): Promise<AutoUpdateStatus> {
  try {
    await chrome.storage.local.set({ [STATUS_KEY]: status });
  } catch {}
  return status;
}

let runningCheck: Promise<AutoUpdateStatus> | null = null;

/** Checks GitHub and installs a newer build through the helper when it is set up. */
export function runAutoUpdate(): Promise<AutoUpdateStatus> {
  if (!runningCheck) {
    runningCheck = checkAndInstall().finally(() => {
      runningCheck = null;
    });
  }
  return runningCheck;
}

async function checkAndInstall(): Promise<AutoUpdateStatus> {
  const base = { installedBuild: BUILD_INFO.build, checkedAt: new Date().toISOString() };

  // Files already updated (by the helper or by running update.bat by hand): just restart into them
  if (await hasNewFilesOnDisk()) {
    reloadWhenIdle();
    return saveStatus({ ...base, state: 'updated', helperInstalled: Boolean(await sendToHelper({ type: 'ping' })) });
  }

  const remote = await fetchRemoteVersion();
  const ping = await sendToHelper({ type: 'ping' });
  const helperInstalled = Boolean(ping?.ok);
  const remoteFields = remote
    ? { remoteBuild: remote.build, remoteShortCommit: remote.shortCommit, remoteMessage: remote.message }
    : {};

  if (!remote) return saveStatus({ ...base, state: 'offline', helperInstalled });
  if (!isRemoteNewer(remote)) return saveStatus({ ...base, ...remoteFields, state: 'up-to-date', helperInstalled });
  if (!helperInstalled) return saveStatus({ ...base, ...remoteFields, state: 'update-available', helperInstalled });

  const reply = await sendToHelper({ type: 'update', build: remote.build });
  if (!reply?.ok) {
    const state: AutoUpdateState = reply?.code === 'dev-checkout' ? 'dev-checkout' : 'error';
    return saveStatus({ ...base, ...remoteFields, state, helperInstalled, error: reply?.error || 'The update helper did not answer.' });
  }
  if (await hasNewFilesOnDisk()) {
    reloadWhenIdle();
    return saveStatus({ ...base, ...remoteFields, state: 'updated', helperInstalled });
  }
  // GitHub's download can lag a few minutes behind version.json; the next check picks it up
  return saveStatus({ ...base, ...remoteFields, state: 'update-available', helperInstalled });
}

export async function getAutoUpdateStatus(): Promise<AutoUpdateStatus | null> {
  try {
    const res = await chrome.storage.local.get(STATUS_KEY);
    return (res?.[STATUS_KEY] as AutoUpdateStatus) || null;
  } catch {
    return null;
  }
}

async function ensureCheckAlarm(): Promise<void> {
  // Re-creating an alarm restarts its timer, and the service worker wakes often, so only create it once
  const existing = await chrome.alarms.get(CHECK_ALARM);
  // Older installs created this alarm with a 60-minute period; replace it
  if (!existing || existing.periodInMinutes !== CHECK_PERIOD_MINUTES) chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_PERIOD_MINUTES });
}

/** Wires the update check into the background service worker. Call once at top level. */
export function initAutoUpdate(): void {
  ensureCheckAlarm().catch(() => {});

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === CHECK_ALARM) runAutoUpdate().catch(() => {});
    else if (alarm.name === RELOAD_ALARM) reloadWhenIdle().catch(() => {});
  });

  chrome.runtime.onStartup?.addListener(() => {
    runAutoUpdate().catch(() => {});
  });

  // The popup holds a port open; when it closes, apply an update that was waiting for it
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== POPUP_PORT_NAME) return;
    port.onDisconnect.addListener(() => {
      setTimeout(() => reloadWhenIdle().catch(() => {}), 500);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'RUN_AUTO_UPDATE') {
      runAutoUpdate()
        .then(status => sendResponse({ ok: true, status }))
        .catch(err => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message?.type === 'GET_AUTO_UPDATE_STATUS') {
      getAutoUpdateStatus()
        .then(status => sendResponse({ ok: true, status }))
        .catch(err => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    return false;
  });
}
