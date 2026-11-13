import { profileUniversity } from '../../core/studentProfile';
import { describeSessionBanner, SESSION_STATUS_KEY, type SessionStatus } from '../../utils/sessionStatus';
import { getSettings } from '../../utils/storage';
import { getCachedProfile } from '../universitySettings';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { popupActions } from './state';

export async function initWalkthroughModal() {
  const modal = document.getElementById('modal-walkthrough');
  if (!modal) return;
  const btnClose = document.getElementById('btn-close-walkthrough');
  const btnNext = document.getElementById('btn-walkthrough-next');
  const btnBack = document.getElementById('btn-walkthrough-back');
  const btnSkip = document.getElementById('btn-walkthrough-skip');
  const btnReplay = document.getElementById('btn-replay-walkthrough');
  const keyDisplay = document.getElementById('wt-key-display');
  const btnCopyKey = document.getElementById('btn-wt-copy-key');
  const stepButtons = modal.querySelectorAll<HTMLButtonElement>('.walkthrough-step-btn');
  const panes = modal.querySelectorAll<HTMLDivElement>('.walkthrough-pane');

  let currentStep = 1;
  const totalSteps = 2;

  document.getElementById('btn-wt-open-bb')?.addEventListener('click', () => {
    closeModal(true);
    const cached = getCachedProfile();
    const uni = profileUniversity(cached);
    const bbUrl = uni.blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
    try { chrome.tabs.create({ url: bbUrl }); } catch { window.open(bbUrl, '_blank', 'noopener'); }
  });

  const settings = await getSettings();
  if (keyDisplay && settings.syncKey) keyDisplay.textContent = settings.syncKey;

  function setStep(step: number) {
    currentStep = Math.max(1, Math.min(totalSteps, step));
    stepButtons.forEach(btn => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      btn.classList.toggle('active', s === currentStep);
    });
    panes.forEach(pane => pane.classList.remove('active'));
    document.getElementById(`walkthrough-pane-${currentStep}`)?.classList.add('active');
    if (btnBack) btnBack.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
    if (btnNext) btnNext.textContent = currentStep === totalSteps ? 'Get Started' : 'Next Step →';
  }

  function openModal() {
    if (!modal) return;
    getSettings().then(s => {
      if (keyDisplay && s.syncKey) keyDisplay.textContent = s.syncKey;
    }).catch(() => {});
    setStep(1);
    registerOverlayCloseHandler('modal-walkthrough', () => closeModal(true));
    openModalEl('modal-walkthrough', modal);
  }

  function closeModal(markSeen = true) {
    closeModalEl('modal-walkthrough', modal);
    if (markSeen) {
      try { localStorage.setItem('bbs_walkthrough_seen', 'true'); } catch {}
    }
  }

  btnNext?.addEventListener('click', () => {
    if (currentStep < totalSteps) setStep(currentStep + 1);
    else {
      closeModal(true);
      popupActions.showToast('Welcome to Blackboarder! Ready to scan your courses.');
    }
  });
  btnBack?.addEventListener('click', () => { if (currentStep > 1) setStep(currentStep - 1); });
  btnSkip?.addEventListener('click', () => closeModal(true));
  btnClose?.addEventListener('click', () => closeModal(true));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(true); });
  stepButtons.forEach(btn => btn.addEventListener('click', () => setStep(parseInt(btn.getAttribute('data-step') || '1', 10))));
  btnCopyKey?.addEventListener('click', async () => {
    const s = await getSettings();
    if (s.syncKey) {
      try { await navigator.clipboard.writeText(s.syncKey); popupActions.showToast(`Copied Sync Key: ${s.syncKey}`); } catch { popupActions.showToast(`Sync Key: ${s.syncKey}`); }
    }
  });
  document.getElementById('btn-wt-copy-pairing-link')?.addEventListener('click', () => document.getElementById('btn-copy-pairing-link')?.click());
  btnReplay?.addEventListener('click', openModal);

  if (!localStorage.getItem('bbs_walkthrough_seen')) openModal();
}

export function initSessionBanner() {
  const banner = document.getElementById('session-banner');
  const title = document.getElementById('session-banner-title');
  const text = document.getElementById('session-banner-text');
  const open = document.getElementById('btn-session-open-bb');
  if (!banner) return;
  const render = (status: SessionStatus | null | undefined) => {
    const info = describeSessionBanner(status);
    banner.style.display = info ? 'flex' : 'none';
    if (info) {
      if (title) title.textContent = info.title;
      if (text) text.textContent = info.text;
    }
  };
  try {
    chrome.storage.local.get(SESSION_STATUS_KEY, res => render(res?.[SESSION_STATUS_KEY] as SessionStatus | undefined));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SESSION_STATUS_KEY]) render(changes[SESSION_STATUS_KEY].newValue as SessionStatus | undefined);
    });
  } catch {}
  open?.addEventListener('click', () => {
    const bbUrl = profileUniversity(getCachedProfile()).blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
    try { chrome.tabs.create({ url: bbUrl }); } catch { window.open(bbUrl, '_blank', 'noopener'); }
  });
}
