import { isExtensionContextValid, setScanStatus } from '../utils/storage';

const CONTENT_INSTANCE_ID = Math.random().toString(36).slice(2);
let toastDismissTimer: any = null;

const BOLT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';
const SPARKLE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="animation: hsb-spin 1.8s linear infinite;"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"></path></svg>';

/** Marks an orphaned floating button when the extension was updated/reloaded. */
export function teardownOrphanedContentScript(): void {
  const floatingRoot = document.getElementById('bbs-floating-root');
  if (floatingRoot && floatingRoot.dataset.instance === CONTENT_INSTANCE_ID) {
    floatingRoot.style.opacity = '0.7';
    floatingRoot.style.cursor = 'pointer';
    const label = floatingRoot.querySelector('.bbs-pill-label') as HTMLElement | null;
    if (label) {
      label.textContent = 'Extension updated - reload tab (F5)';
      label.hidden = false;
    }
    floatingRoot.title = 'Extension reloaded. Please refresh the page (F5) to reconnect.';
  }
}

/** Displays a toast prompting user to refresh tab when extension was reloaded. */
export function showExtensionReloadToast(): void {
  showSidekickToast(
    'Extension Updated',
    'Blackboarder was reloaded or updated. Please refresh this page (press F5 or Reload) to reconnect.',
    0
  );
}

/** Shows a toast message on the top-right of the page with an animated progress bar. */
export function showSidekickToast(
  title: string,
  message: string,
  taskCount: number = 0,
  inProgress: boolean = false,
  onAbort?: () => void
): void {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  let toast = document.getElementById('bbs-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bbs-toast';
    toast.className = 'bbs-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div class="bbs-toast-header">
      <span class="bbs-toast-title">
        ${inProgress ? SPARKLE_SVG : BOLT_SVG}
        <span>${title}</span>
      </span>
      <button type="button" style="background:none;border:none;color:inherit;cursor:pointer;opacity:0.65;font-size:13px;padding:2px 4px;" id="bbs-toast-close" aria-label="Dismiss notification" title="Dismiss">✕</button>
    </div>
    <div class="bbs-toast-body">${message}</div>
    ${taskCount > 0 ? `
      <div class="bbs-toast-actions">
        <button type="button" class="bbs-toast-btn-primary" id="bbs-toast-view">Open Blackboarder</button>
      </div>
    ` : ''}
    <div class="bbs-toast-progress">
      <div class="bbs-toast-progress-fill ${inProgress ? 'is-loading' : 'is-done'}"></div>
    </div>
  `;

  toast.classList.add('bbs-toast-visible');

  document.getElementById('bbs-toast-close')?.addEventListener('click', () => {
    toast?.classList.remove('bbs-toast-visible');
    if (inProgress) {
      if (isExtensionContextValid()) {
        chrome.runtime.sendMessage({ type: 'ABORT_SCAN' }).catch(() => {});
      }
      onAbort?.();
      setScanStatus({ state: 'done', message: 'Scan cancelled.', newCount: 0 }).catch(() => {});
    }
  });

  document.getElementById('bbs-toast-view')?.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, () => {
        if (chrome.runtime?.lastError) {
          // ignore if popup could not be opened
        }
      });
    } catch {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
    }
    toast?.classList.remove('bbs-toast-visible');
  });

  if (!inProgress) {
    toastDismissTimer = setTimeout(() => {
      toast?.classList.remove('bbs-toast-visible');
    }, 4500);
  }
}

/** Injects the floating quick-scan bolt button onto Blackboard pages. */
export function injectFloatingButton(onScanClick: () => void): void {
  const existing = document.getElementById('bbs-floating-root');
  if (existing?.dataset.instance === CONTENT_INSTANCE_ID) return;
  existing?.remove();

  const root = document.createElement('div');
  root.id = 'bbs-floating-root';
  root.dataset.instance = CONTENT_INSTANCE_ID;

  const btn = document.createElement('div');
  btn.className = 'bbs-pill-btn';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', 'Scan Blackboard');
  btn.title = 'Scan Blackboard';
  btn.innerHTML = `
    <span class="bbs-pill-icon">${BOLT_SVG}</span>
    <span class="bbs-pill-label" hidden></span>
    <span class="bbs-pill-badge" id="bbs-floating-badge" style="display:none">0</span>
  `;
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });

  btn.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    onScanClick();
  });

  try {
    const tipSeen = localStorage.getItem('bbs_first_visit_note_seen') === 'true';
    if (!tipSeen) {
      const callout = document.createElement('div');
      callout.className = 'bbs-first-visit-callout';
      callout.innerHTML = `
        <div class="bbs-callout-header">
          <span style="font-weight: 700; font-size: 11.5px;">Blackboarder Ready</span>
          <button type="button" class="bbs-callout-close" aria-label="Dismiss">✕</button>
        </div>
        <div style="font-size: 11px; margin: 4px 0 8px; line-height: 1.4; color: inherit; opacity: 0.85;">
          Click <strong>Scan Blackboard</strong> to find deadlines and marks. Configure or turn off features anytime (Alt+B).
        </div>
      `;
      const dismiss = () => {
        try { localStorage.setItem('bbs_first_visit_note_seen', 'true'); } catch {}
        callout.remove();
      };
      callout.querySelector('.bbs-callout-close')?.addEventListener('click', e => {
        e.stopPropagation();
        dismiss();
      });
      btn.addEventListener('click', dismiss, { once: true });
      root.appendChild(callout);
    }
  } catch {}

  root.appendChild(btn);
  document.body.appendChild(root);
}
