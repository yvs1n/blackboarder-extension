import { DeadlineTask, UserSettings, DEFAULT_SETTINGS, QuickLink, UserCourseConfig } from '../types';

export interface SyncResponse {
  success: boolean;
  message: string;
  count?: number;
  lastSync?: string;
  mobileUrl?: string;
  feedUrl?: string;
  webcalUrl?: string;
  quickLinks?: QuickLink[];
  /** True when no sync server is set, so nothing was sent */
  skipped?: boolean;
}

/** True for a hosted Cloudflare Pages dashboard (which syncs through Firebase directly). */
function isPagesDevUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'pages.dev' || host.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

export interface SyncExtras {
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  tombstones?: Record<string, string>;
}

const NO_SERVER: SyncResponse = { success: false, skipped: true, message: 'No sync server set; syncing through Firebase only' };

/** '' when no server is set (the normal case: everything syncs through Firebase). */
export function normalizeSyncUrl(rawUrl?: string): string {
  let url = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  // Any remote domain (not localhost or private IPv4) MUST use HTTPS to prevent Cloudflare/Vercel/Netlify HTTP->HTTPS 301 redirects from breaking CORS
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(?::\d+)?/i.test(url);
  if (!isLocal) {
    url = url.replace(/^http:\/\//i, 'https://');
  }
  return url;
}

/**
 * Pushes the current tasks array to the Sync Server endpoint.
 */
export async function pushTasksToSyncServer(
  tasks: DeadlineTask[],
  settings?: UserSettings,
  quickLinks?: QuickLink[],
  extras?: SyncExtras
): Promise<SyncResponse> {
  const currentSettings = settings || DEFAULT_SETTINGS;
  const baseUrl = normalizeSyncUrl(currentSettings.syncServerUrl);
  if (!baseUrl) return NO_SERVER;

  // Cloudflare Pages hosts the static web dashboard which syncs directly via Firebase Cloud
  if (isPagesDevUrl(baseUrl)) {
    return {
      success: true,
      message: 'Synchronized via Firebase Cloud for Cloudflare Pages dashboard',
      count: tasks.length,
      lastSync: new Date().toISOString()
    };
  }

  try {
    // The sync key scopes the data on the server; without it everything lands in one shared bucket
    const syncKey = (currentSettings.syncKey || '').trim();
    const syncUrl = `${baseUrl}/api/sync${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`;
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSettings.syncSecretKey ? { 'x-sync-secret': currentSettings.syncSecretKey } : {})
      },
      body: JSON.stringify({
        tasks,
        device: 'Chrome Extension',
        timestamp: new Date().toISOString(),
        syncKey: syncKey || undefined,
        quickLinks: quickLinks || undefined,
        courses: extras?.courses,
        coursesUpdatedAt: extras?.coursesUpdatedAt,
        tombstones: extras?.tombstones
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        success: false,
        message: `Sync Server returned status ${res.status}: ${errText}`
      };
    }

    const data = await res.json();
    return {
      success: true,
      message: 'Deadlines synchronized successfully',
      count: data.count || tasks.length,
      lastSync: data.lastSync
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Could not connect to sync server at ${baseUrl}. Ensure server is running.`
    };
  }
}

/**
 * Checks server status and retrieves mobile URLs.
 */
export async function getSyncServerStatus(settings?: UserSettings): Promise<SyncResponse> {
  const currentSettings = settings || DEFAULT_SETTINGS;
  const baseUrl = normalizeSyncUrl(currentSettings.syncServerUrl);
  if (!baseUrl) return NO_SERVER;

  if (isPagesDevUrl(baseUrl)) {
    return {
      success: true,
      message: 'Cloudflare Pages & Firebase Cloud Online',
      mobileUrl: baseUrl,
      feedUrl: `${baseUrl}/feed.ics`,
      webcalUrl: baseUrl.replace(/^https?/, 'webcal') + '/feed.ics'
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/status`);
    if (!res.ok) {
      return { success: false, message: `Server error: ${res.status}` };
    }
    const data = await res.json();
    return {
      success: true,
      message: 'Server online',
      count: data.totalTasks,
      lastSync: data.lastSync,
      mobileUrl: data.mobileUrl,
      feedUrl: data.feedUrl,
      webcalUrl: data.webcalUrl
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Cannot reach sync server at ${baseUrl}`
    };
  }
}
