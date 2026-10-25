import type { AutoUpdateStatus } from '../background/autoUpdate';

/** How old a saved update check may be before the popup asks for a new one. */
export const UPDATE_STATUS_FRESH_MS = 2 * 60 * 1000;

export const ENABLE_UPDATES_HINT = 'run update.bat (Windows) or update.sh (Mac/Linux) in your Blackboarder folder once';

export interface UpdateBanner {
  title: string;
  desc: string;
  /** restart: the new files are on disk; download: get the ZIP; none: nothing to click yet */
  primary: 'restart' | 'download' | 'none';
  /** Whether "Later" hides this banner for this build */
  dismissible: boolean;
}

/** True when the saved check was made by this build within the last couple of minutes. */
export function isUpdateStatusFresh(status: AutoUpdateStatus | null | undefined, installedBuild: string, now = Date.now()): boolean {
  if (!status || status.installedBuild !== installedBuild) return false;
  const checked = Date.parse(status.checkedAt);
  return Number.isFinite(checked) && now - checked < UPDATE_STATUS_FRESH_MS;
}

/** The banner the popup shows for an update status, or null when there is nothing to say. */
export function describeUpdateBanner(status: AutoUpdateStatus | null | undefined, dismissedBuild: string | null = null): UpdateBanner | null {
  if (!status) return null;
  const isDismissed = Boolean(status.remoteBuild) && dismissedBuild === status.remoteBuild;
  switch (status.state) {
    case 'updated':
      // Never hidden: the new version is already on disk and only needs a restart
      return {
        title: 'Update ready - restart to finish',
        desc: 'A new version is installed. Restart now to use it, or it applies by itself when you close this window. Your tasks, courses and Sync Key stay intact.',
        primary: 'restart',
        dismissible: false
      };
    case 'update-available':
      if (isDismissed) return null;
      return status.helperInstalled
        ? { title: 'New version on GitHub', desc: 'It is downloading and will ask you to restart in a few minutes.', primary: 'none', dismissible: true }
        : { title: 'New version on GitHub', desc: `To update now and turn on automatic updates, ${ENABLE_UPDATES_HINT}. Your data stays intact.`, primary: 'download', dismissible: true };
    case 'dev-checkout':
      if (isDismissed) return null;
      return {
        title: 'New version on GitHub - not pulled',
        desc: `${status.error || 'Your Blackboarder folder is a git clone that could not be updated automatically.'} After pulling, restart Blackboarder.`,
        primary: 'none',
        dismissible: true
      };
    default:
      return null;
  }
}
