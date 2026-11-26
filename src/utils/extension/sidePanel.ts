import { getSettings } from '../storage/index';

type SidePanelApi = {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
  open?: (options: { windowId: number }) => Promise<void>;
};

function getSidePanelApi(): SidePanelApi | null {
  if (typeof chrome === 'undefined') return null;
  const api = (chrome as unknown as { sidePanel?: SidePanelApi }).sidePanel;
  return api && typeof api.setPanelBehavior === 'function' ? api : null;
}

/** True when running on a Chromium-family browser supporting `chrome.sidePanel.setPanelBehavior`. */
export function isSidePanelBehaviorSupported(): boolean {
  return getSidePanelApi() !== null;
}

/** Updates whether clicking the toolbar extension icon opens the browser sidebar instead of the popup. */
export async function applySidePanelBehavior(openInSidePanel: boolean): Promise<boolean> {
  const api = getSidePanelApi();
  if (!api?.setPanelBehavior) return false;
  try {
    await api.setPanelBehavior({ openPanelOnActionClick: Boolean(openInSidePanel) });
    return true;
  } catch {
    return false;
  }
}

/** Reads saved preference and syncs toolbar click behavior on startup/install/change. */
export async function syncSidePanelBehaviorFromSettings(): Promise<boolean> {
  if (!isSidePanelBehaviorSupported()) return false;
  try {
    const settings = await getSettings();
    return await applySidePanelBehavior(Boolean(settings.openInSidePanel));
  } catch {
    return false;
  }
}

/** Opens the browser side panel for the active window when triggered from a user gesture. */
export async function openCurrentWindowSidePanel(): Promise<boolean> {
  const api = getSidePanelApi();
  if (!api?.open || typeof chrome === 'undefined' || !chrome.windows?.getCurrent) return false;
  try {
    const win = await chrome.windows.getCurrent();
    if (typeof win?.id !== 'number') return false;
    await api.open({ windowId: win.id });
    return true;
  } catch {
    return false;
  }
}
