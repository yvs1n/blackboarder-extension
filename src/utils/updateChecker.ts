import { BUILD_INFO, BuildInfo } from '../buildInfo';

/** The version.json that scripts/build.js writes next to the built extension (dist/version.json). */
export interface RemoteVersionInfo {
  version?: string;
  build: string;
  commit?: string;
  shortCommit?: string;
  timestamp?: string;
  message?: string;
}

export const GITHUB_REPO_URL = 'https://github.com/yvs1n/blackboarder-extension';
export const GITHUB_ZIP_URL = 'https://github.com/yvs1n/blackboarder-extension/archive/refs/heads/main.zip';
const RAW_BASE_URL = 'https://raw.githubusercontent.com/yvs1n/blackboarder-extension/main/';
// dist/version.json describes the extension; the root copy is the same file for older layouts
const REMOTE_VERSION_PATHS = ['dist/version.json', 'version.json'];

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Reads the extension's version.json from the main branch on GitHub. */
export async function fetchRemoteVersion(): Promise<RemoteVersionInfo | null> {
  for (const path of REMOTE_VERSION_PATHS) {
    // The query string skips GitHub's few-minute CDN cache
    const data = await fetchJson(`${RAW_BASE_URL}${path}?t=${Date.now()}`);
    if (data && typeof data.build === 'string' && data.build) return data as RemoteVersionInfo;
  }
  return null;
}

/**
 * True when GitHub has a different build that is not older than the installed one. The build id
 * is a hash of the extension's source, so pushes that only touch the web app never count.
 */
export function isRemoteNewer(remote: RemoteVersionInfo | null | undefined, local: Pick<BuildInfo, 'build' | 'timestamp'> = BUILD_INFO): boolean {
  if (!remote?.build || !local?.build) return false;
  if (remote.build === local.build) return false;
  const remoteTime = Date.parse(remote.timestamp || '') || 0;
  const localTime = Date.parse(local.timestamp || '') || 0;
  // A stale cached copy of an older build is not an update
  return !(remoteTime && localTime && remoteTime < localTime);
}
