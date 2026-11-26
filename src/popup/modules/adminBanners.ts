import { BUILD_INFO } from '../../buildInfo';
import {
  filterVisibleAnnouncements,
  isVersionBelowSafeMin,
  localizeAdminAnnouncement,
  localizeServiceStatus,
  sanitizeAdminHttpsUrl,
  type PublicAdminSnapshot
} from '../../core/adminBroadcasts';
import { profileUniversity } from '../../core/studentProfile';
import {
  dismissAdminAnnouncement,
  getCachedAdminState,
  getDismissedAdminIds,
  syncAdminState
} from '../../utils/adminSync';
import { getProfile } from '../../utils/profile';
import { popupState } from './state';

let lastRenderedSnapshot: PublicAdminSnapshot | null = null;
let lastDismissed: string[] = [];
let lastUniversityId = '';

function createTextEl(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

export function renderAdminBanners(): void {
  const root = document.getElementById('admin-banners-root');
  if (!root) return;
  root.innerHTML = '';

  const snap = lastRenderedSnapshot;
  if (!snap) return;

  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const statusMsg = localizeServiceStatus(snap.serviceStatus, lang);
  if (statusMsg && snap.serviceStatus?.enabled) {
    const bar = document.createElement('div');
    bar.className = `admin-banner is-status is-${snap.serviceStatus.level || 'info'}`;
    bar.setAttribute('role', 'status');
    const row = document.createElement('div');
    row.className = 'admin-banner-head';
    row.appendChild(createTextEl('span', 'admin-banner-kicker', isAr ? 'حالة الخدمة' : 'SERVICE STATUS'));
    bar.appendChild(row);
    bar.appendChild(createTextEl('p', 'admin-banner-body', statusMsg));
    root.appendChild(bar);
  }

  if (isVersionBelowSafeMin(BUILD_INFO.version, snap.remoteConfig)) {
    const upd = document.createElement('div');
    upd.className = 'admin-banner is-warning';
    upd.setAttribute('role', 'alert');
    const row = document.createElement('div');
    row.className = 'admin-banner-head';
    row.appendChild(createTextEl('span', 'admin-banner-kicker', isAr ? 'تحديث مطلوب' : 'UPDATE RECOMMENDED'));
    upd.appendChild(row);
    upd.appendChild(
      createTextEl(
        'p',
        'admin-banner-body',
        isAr
          ? `الإصدار الحالي (${BUILD_INFO.version}) أقدم من الحد الموصى به (${snap.remoteConfig?.minSafeExtensionVersion}). يُرجى التحديث للحصول على أحدث الإصلاحات.`
          : `Your version (v${BUILD_INFO.version}) is behind v${snap.remoteConfig?.minSafeExtensionVersion}. Update to get the latest fixes.`
      )
    );
    root.appendChild(upd);
  }

  const visible = filterVisibleAnnouncements(
    snap,
    {
      surface: 'extension',
      version: BUILD_INFO.version,
      universityId: lastUniversityId
    },
    lastDismissed
  );

  for (const item of visible) {
    const copy = localizeAdminAnnouncement(item, lang);
    const card = document.createElement('aside');
    card.className = `admin-banner is-${item.priority || 'info'}`;
    card.setAttribute('role', item.priority === 'critical' ? 'alert' : 'status');

    const head = document.createElement('div');
    head.className = 'admin-banner-head';
    const kicker = createTextEl(
      'span',
      'admin-banner-kicker',
      item.priority === 'critical'
        ? (isAr ? 'تنبيه هام' : 'IMPORTANT')
        : item.priority === 'warning'
          ? (isAr ? 'تنبيه' : 'NOTICE')
          : (isAr ? 'إعلان' : 'ANNOUNCEMENT')
    );
    head.appendChild(kicker);

    if (item.dismissible !== false) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'admin-banner-close';
      closeBtn.setAttribute('aria-label', isAr ? 'إغلاق' : 'Dismiss announcement');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        dismissAdminAnnouncement(item.id).then(next => {
          lastDismissed = next;
          renderAdminBanners();
        });
      });
      head.appendChild(closeBtn);
    }

    card.appendChild(head);
    card.appendChild(createTextEl('strong', 'admin-banner-title', copy.title));
    card.appendChild(createTextEl('p', 'admin-banner-body', copy.body));

    const safeHref = sanitizeAdminHttpsUrl(copy.actionUrl);
    if (safeHref) {
      const link = document.createElement('a');
      link.className = 'admin-banner-link';
      link.href = safeHref;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = copy.actionLabel;
      card.appendChild(link);
    }
    root.appendChild(card);
  }
}

export async function initAdminBanners(): Promise<void> {
  try {
    const [cached, dismissed, profile] = await Promise.all([
      getCachedAdminState(),
      getDismissedAdminIds(),
      getProfile().catch(() => null)
    ]);
    lastDismissed = dismissed;
    lastUniversityId = profile ? profileUniversity(profile).id : '';
    if (cached?.snapshot) {
      lastRenderedSnapshot = cached.snapshot;
      renderAdminBanners();
    }
    const fresh = await syncAdminState(false);
    if (fresh) {
      lastRenderedSnapshot = fresh;
      renderAdminBanners();
    }
  } catch {}
}
