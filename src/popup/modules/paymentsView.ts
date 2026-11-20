import type { DeadlineTask, PaymentCategory, PaymentItem } from '../../types';
import {
  buildPresetPaymentsForTerm,
  formatPaymentAmount,
  paymentCategoryLabel,
  paymentsAsDeadlineTasks,
  sortPayments,
  summarizePayments,
  universityPaymentGuide
} from '../../core/payments';
import { getCachedSettingsSync, getSettings, saveSettings, saveStoredPayments } from '../../utils/storage';
import { recordLocalTombstone, removeLocalTombstone } from '../../utils/tombstones';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import { getCachedProfile } from '../universitySettings';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import { popupActions, popupState } from './state';

/** Returns academic tasks plus unpaid payment deadlines when Show in Calendar & Deadlines is enabled. */
export function getCombinedCalendarTasks(): DeadlineTask[] {
  const showPayments = getCachedSettingsSync().showPaymentsInCalendar !== false;
  if (!showPayments || !popupState.currentPayments.length) return popupState.currentTasks;
  return [...popupState.currentTasks, ...paymentsAsDeadlineTasks(popupState.currentPayments)];
}

/** Updates the header notification dot & count on the Payments button. */
export function updatePaymentsHeaderBadge(): void {
  const badge = document.getElementById('payments-header-badge');
  const summary = summarizePayments(popupState.currentPayments);
  if (badge) {
    badge.textContent = summary.pendingCount > 0 ? String(summary.pendingCount) : '';
    badge.hidden = summary.pendingCount <= 0;
    badge.classList.toggle('is-overdue', summary.overdueCount > 0);
  }

  const strip = document.getElementById('deadlines-payments-strip');
  if (strip) {
    if (summary.pendingCount > 0 && summary.nextDue) {
      const dueStr = new Date(summary.nextDue.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const amtStr = formatPaymentAmount(summary.nextDue.amount, summary.nextDue.currency);
      strip.hidden = false;
      strip.classList.toggle('is-overdue', summary.overdueCount > 0);
      strip.innerHTML = `
        <span class="payments-strip-text">
          ${getSvgIcon('credit-card', 'mr-1')}
          <strong>${summary.pendingCount} unpaid fee${summary.pendingCount > 1 ? 's' : ''}</strong>
          · Next: ${escapeHtml(summary.nextDue.title)} (${dueStr}${amtStr ? ` · ${escapeHtml(amtStr)}` : ''})
        </span>
        <button type="button" class="btn-secondary payments-strip-btn" id="btn-strip-open-payments">Payments</button>
      `;
    } else {
      strip.hidden = true;
      strip.classList.remove('is-overdue');
      strip.innerHTML = '';
    }
  }
}

async function persistAndSyncPayments(next: PaymentItem[], reason: string): Promise<void> {
  const saved = await saveStoredPayments(next);
  popupState.currentPayments = saved.payments;
  updatePaymentsHeaderBadge();
  renderPaymentsView();
  popupActions.refreshAllViews();
  popupActions.syncTasksToCloud(popupState.currentTasks, reason, true);
}

/** Toggles a payment item between paid and pending with an Undo toast. */
export async function togglePaymentPaid(paymentId: string): Promise<void> {
  const current = popupState.currentPayments;
  const target = current.find(p => p.id === paymentId);
  if (!target) return;
  const nowIso = new Date().toISOString();
  const nextStatus = target.status === 'paid' ? 'pending' : 'paid';
  const next = current.map(p => (
    p.id === paymentId
      ? { ...p, status: nextStatus as 'pending' | 'paid', paidAt: nextStatus === 'paid' ? nowIso : undefined, updatedAt: nowIso }
      : p
  ));
  await persistAndSyncPayments(next, nextStatus === 'paid' ? 'Marked Payment Paid' : 'Reopened Payment');
  popupActions.showToast(
    nextStatus === 'paid' ? `Marked "${target.title}" as paid` : `Reopened "${target.title}"`,
    'Undo',
    () => { void persistAndSyncPayments(current, 'Undo Payment Status'); }
  );
}

/** Deletes a payment item and records a tombstone so cloud sync does not resurrect it. */
export async function deletePaymentItem(paymentId: string): Promise<void> {
  const current = popupState.currentPayments;
  const target = current.find(p => p.id === paymentId);
  if (!target) return;
  const nowIso = new Date().toISOString();
  await recordLocalTombstone(paymentId, nowIso);
  const next = current.filter(p => p.id !== paymentId);
  await persistAndSyncPayments(next, 'Deleted Payment');
  popupActions.showToast(
    `Deleted "${target.title}"`,
    'Undo',
    async () => {
      await removeLocalTombstone(paymentId);
      const restored = sortPayments([...popupState.currentPayments.filter(p => p.id !== paymentId), { ...target, updatedAt: new Date().toISOString() }]);
      await persistAndSyncPayments(restored, 'Restored Payment');
    }
  );
}

function setPaymentModalVisible(visible: boolean): void {
  const modal = document.getElementById('modal-payment');
  if (!modal) return;
  if (visible) openModalEl('modal-payment', modal);
  else closeModalEl('modal-payment', modal);
}

/** Opens the Add/Edit Payment dialog pre-populated for creating or editing a fee deadline. */
export function openPaymentModal(existing?: PaymentItem): void {
  const form = document.getElementById('form-payment') as HTMLFormElement | null;
  if (!form) return;
  const titleHeading = document.getElementById('modal-payment-title');
  const idInput = document.getElementById('payment-id') as HTMLInputElement;
  const titleInput = document.getElementById('payment-title') as HTMLInputElement;
  const catSelect = document.getElementById('payment-category') as HTMLSelectElement;
  const amountInput = document.getElementById('payment-amount') as HTMLInputElement;
  const currencyInput = document.getElementById('payment-currency') as HTMLInputElement;
  const dateInput = document.getElementById('payment-due-date') as HTMLInputElement;
  const termInput = document.getElementById('payment-term') as HTMLInputElement;
  const methodInput = document.getElementById('payment-method-note') as HTMLInputElement;
  const portalInput = document.getElementById('payment-portal-url') as HTMLInputElement;
  const paidCheck = document.getElementById('payment-paid-check') as HTMLInputElement;

  const profile = getCachedProfile();
  const guide = universityPaymentGuide(profile?.universityId);
  const d = existing ? new Date(existing.dueDate) : new Date(Date.now() + 7 * 86400000);
  if (!existing) d.setHours(23, 59, 0, 0);
  const dateStr = !isNaN(d.getTime())
    ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';

  if (titleHeading) titleHeading.textContent = existing ? 'Edit Financial Deadline' : 'Add Payment / Fee Deadline';
  idInput.value = existing?.id || '';
  titleInput.value = existing?.title || '';
  catSelect.value = existing?.category || 'installment';
  amountInput.value = typeof existing?.amount === 'number' ? String(existing.amount) : '';
  currencyInput.value = existing?.currency || guide.defaultCurrency || 'AED';
  dateInput.value = dateStr;
  termInput.value = existing?.termName || '';
  methodInput.value = existing?.methodNote || '';
  portalInput.value = existing?.portalUrl || (guide.portals[0]?.url || '');
  paidCheck.checked = existing?.status === 'paid';

  setPaymentModalVisible(true);
  setTimeout(() => titleInput.focus(), 40);
}

/** Renders the Payments Summary, Installments list, and University Guide inside `#view-payments`. */
export function renderPaymentsView(): void {
  const summaryEl = document.getElementById('payments-summary-card');
  const listEl = document.getElementById('payments-list');
  const guideEl = document.getElementById('payments-guide-card');
  const toggleShow = document.getElementById('toggle-show-payments-calendar') as HTMLInputElement | null;
  if (!summaryEl || !listEl || !guideEl) return;

  if (toggleShow) toggleShow.checked = getCachedSettingsSync().showPaymentsInCalendar !== false;

  const profile = getCachedProfile();
  const guide = universityPaymentGuide(profile?.universityId);
  const summary = summarizePayments(popupState.currentPayments);

  const overviewPill = document.getElementById('payments-overview-pill');
  if (overviewPill) {
    overviewPill.textContent = summary.overdueCount > 0
      ? `${summary.overdueCount} Overdue`
      : (summary.pendingCount > 0 ? `${summary.pendingCount} Pending` : 'All Settled');
    overviewPill.className = `settings-pill ${summary.overdueCount > 0 ? 'pill-orange' : (summary.pendingCount > 0 ? 'pill-blue' : 'pill-green')}`;
  }
  const countPill = document.getElementById('payments-count-pill');
  if (countPill) {
    const count = popupState.currentPayments.length;
    countPill.textContent = `${count} Tracked`;
  }

  const totalsStr = summary.totalsByCurrency.length > 0
    ? summary.totalsByCurrency.map(t => formatPaymentAmount(t.amount, t.currency)).join(' + ')
    : 'Amount optional';
  const nextLabel = summary.nextDue
    ? (summary.nextDueDays !== undefined && summary.nextDueDays < 0
      ? `Overdue by ${Math.abs(summary.nextDueDays)}d`
      : summary.nextDueDays === 0
        ? 'Due today'
        : `Due in ${summary.nextDueDays}d`)
    : 'All settled';

  summaryEl.innerHTML = `
    <div class="payments-stats-grid">
      <div class="payments-stat-box">
        <strong class="payments-stat-val">${summary.pendingCount}</strong>
        <span class="payments-stat-label">Pending</span>
      </div>
      <div class="payments-stat-box">
        <strong class="payments-stat-val">${escapeHtml(totalsStr)}</strong>
        <span class="payments-stat-label">Balance Listed</span>
      </div>
      <div class="payments-stat-box">
        <strong class="payments-stat-val ${summary.overdueCount > 0 ? 'is-overdue' : ''}">${escapeHtml(nextLabel)}</strong>
        <span class="payments-stat-label">Next Status</span>
      </div>
    </div>
  `;

  if (popupState.currentPayments.length === 0) {
    listEl.innerHTML = `
      <div class="payments-empty">
        <strong>No payment deadlines added yet</strong>
        <span>Add an installment with <b>Add Fee</b> or load your published term dates below.</span>
      </div>
    `;
  } else {
    listEl.innerHTML = popupState.currentPayments.map(p => {
      const isPaid = p.status === 'paid';
      const amtStr = formatPaymentAmount(p.amount, p.currency);
      const dueStr = new Date(p.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const overdue = !isPaid && Date.parse(p.dueDate) < Date.now();
      return `
        <div class="payment-row ${isPaid ? 'is-paid' : ''}" data-payment-id="${escapeHtml(p.id)}">
          <button type="button" class="payment-check-btn ${isPaid ? 'checked' : ''}" data-action="toggle-paid" data-payment-id="${escapeHtml(p.id)}" aria-label="Mark ${escapeHtml(p.title)} as ${isPaid ? 'pending' : 'paid'}">
            ${isPaid ? getSvgIcon('check') : ''}
          </button>
          <div class="payment-row-main">
            <div class="payment-row-top">
              <span class="payment-row-title">${escapeHtml(p.title)}</span>
              ${amtStr ? `<span class="payment-amt-badge">${escapeHtml(amtStr)}</span>` : ''}
            </div>
            <div class="payment-row-meta">
              <span class="payment-cat-tag">${escapeHtml(paymentCategoryLabel(p.category))}</span>
              <span class="${overdue ? 'payment-overdue-text' : ''}">${overdue ? 'Overdue · ' : 'Due '}${escapeHtml(dueStr)}</span>
              ${p.termName ? `<span>· ${escapeHtml(p.termName)}</span>` : ''}
            </div>
            ${p.methodNote ? `<div class="payment-row-note">${escapeHtml(p.methodNote)}</div>` : ''}
          </div>
          <div class="payment-row-actions">
            ${p.portalUrl ? `<button type="button" class="btn-icon-tiny" data-action="open-portal" data-url="${escapeHtml(p.portalUrl)}" title="Open payment portal" aria-label="Open payment portal">${getSvgIcon('external-link')}</button>` : ''}
            <button type="button" class="btn-icon-tiny" data-action="edit" data-payment-id="${escapeHtml(p.id)}" title="Edit payment" aria-label="Edit ${escapeHtml(p.title)}">${getSvgIcon('pencil')}</button>
            <button type="button" class="btn-icon-tiny btn-icon-danger" data-action="delete" data-payment-id="${escapeHtml(p.id)}" title="Delete payment" aria-label="Delete ${escapeHtml(p.title)}">${getSvgIcon('trash')}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  guideEl.innerHTML = `
    <div class="settings-card-header">
      <div class="settings-icon-title">
        <span class="card-icon">${getSvgIcon('book')}</span>
        <div>
          <h3 class="settings-card-title">${escapeHtml(guide.headline)}</h3>
          <p class="settings-card-subtitle">Verified portals, payment channels, and term dates</p>
        </div>
      </div>
    </div>
    ${guide.portals.length > 0 ? `
      <div class="payments-portal-links">
        ${guide.portals.map(pt => `
          <button type="button" class="btn-outline-action payments-portal-btn" data-url="${escapeHtml(pt.url)}">
            <span class="payments-portal-head">${escapeHtml(pt.title)} ${getSvgIcon('external-link')}</span>
            <span class="payments-portal-sub">${escapeHtml(pt.description)}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    ${guide.presetTerms.length > 0 ? `
      <div class="payments-presets-bar">
        <span class="payments-sublabel">Quick-Load Published Dates</span>
        <div class="payments-presets-btns">
          ${guide.presetTerms.map(t => `<button type="button" class="btn-secondary payments-preset-btn" data-term-id="${escapeHtml(t.id)}">+ ${escapeHtml(t.label)}</button>`).join('')}
        </div>
      </div>
    ` : ''}
    <div class="payments-guide-section">
      <span class="payments-sublabel">Where To Check &amp; Pay</span>
      <ol class="payments-steps-list">
        ${guide.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>
    </div>
    <div class="payments-guide-section">
      <span class="payments-sublabel">Accepted Channels &amp; Tips</span>
      <ul class="payments-methods-list">
        ${guide.methods.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/** Wires button handlers, modal submit, preset import, and Calendar toggle for Payments. */
export function initPaymentsView(): void {
  registerOverlayCloseHandler('modal-payment', () => setPaymentModalVisible(false));
  document.getElementById('btn-payments-toggle')?.addEventListener('click', () => popupActions.switchView('payments'));
  document.getElementById('btn-payments-back')?.addEventListener('click', () => popupActions.switchView('calendar'));
  document.getElementById('btn-add-payment')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('deadlines-payments-strip')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#btn-strip-open-payments')) popupActions.switchView('payments');
  });

  document.getElementById('toggle-show-payments-calendar')?.addEventListener('change', async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const settings = await getSettings();
    await saveSettings({ ...settings, showPaymentsInCalendar: checked });
    popupActions.refreshAllViews();
  });

  document.getElementById('payments-list')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.paymentId || '';
    if (action === 'toggle-paid' && id) void togglePaymentPaid(id);
    else if (action === 'edit' && id) {
      const item = popupState.currentPayments.find(p => p.id === id);
      if (item) openPaymentModal(item);
    } else if (action === 'delete' && id) void deletePaymentItem(id);
    else if (action === 'open-portal' && btn.dataset.url) popupActions.openQuickLinkUrl(btn.dataset.url);
  });

  document.getElementById('payments-guide-card')?.addEventListener('click', async (e) => {
    const portalBtn = (e.target as HTMLElement).closest('.payments-portal-btn') as HTMLElement | null;
    if (portalBtn?.dataset.url) {
      popupActions.openQuickLinkUrl(portalBtn.dataset.url);
      return;
    }
    const presetBtn = (e.target as HTMLElement).closest('.payments-preset-btn') as HTMLElement | null;
    if (presetBtn?.dataset.termId) {
      const uniId = getCachedProfile()?.universityId || 'uos';
      const { added, items } = buildPresetPaymentsForTerm(uniId, presetBtn.dataset.termId, popupState.currentPayments);
      if (added === 0) {
        popupActions.showToast('All deadlines from this term are already listed.');
        return;
      }
      await persistAndSyncPayments(items, 'Imported Payment Schedule');
      popupActions.showToast(`Added ${added} payment milestone${added > 1 ? 's' : ''}`);
    }
  });

  document.getElementById('btn-close-payment-modal')?.addEventListener('click', () => setPaymentModalVisible(false));
  document.getElementById('btn-cancel-payment')?.addEventListener('click', () => setPaymentModalVisible(false));
  document.getElementById('modal-payment')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) setPaymentModalVisible(false);
  });

  document.getElementById('form-payment')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = (document.getElementById('payment-id') as HTMLInputElement).value.trim();
    const title = (document.getElementById('payment-title') as HTMLInputElement).value.trim();
    const category = ((document.getElementById('payment-category') as HTMLSelectElement).value || 'other') as PaymentCategory;
    const amtRaw = (document.getElementById('payment-amount') as HTMLInputElement).value.trim();
    const amount = amtRaw !== '' && Number.isFinite(Number(amtRaw)) ? Number(amtRaw) : undefined;
    const currency = ((document.getElementById('payment-currency') as HTMLInputElement).value.trim() || 'AED').toUpperCase();
    const dateVal = (document.getElementById('payment-due-date') as HTMLInputElement).value.trim();
    const termName = (document.getElementById('payment-term') as HTMLInputElement).value.trim() || undefined;
    const methodNote = (document.getElementById('payment-method-note') as HTMLInputElement).value.trim() || undefined;
    const rawPortalUrl = (document.getElementById('payment-portal-url') as HTMLInputElement).value.trim();
    const portalUrl = rawPortalUrl
      ? (/^https?:\/\//i.test(rawPortalUrl) ? rawPortalUrl : `https://${rawPortalUrl}`)
      : undefined;
    const isPaid = (document.getElementById('payment-paid-check') as HTMLInputElement).checked;
    if (!title || !dateVal) {
      popupActions.showToast('Please enter a title and due date.');
      return;
    }

    const parsedDue = new Date(dateVal.includes('T') ? dateVal : `${dateVal}T23:59:00`);
    if (isNaN(parsedDue.getTime())) {
      popupActions.showToast('Please select a valid due date.');
      return;
    }

    const nowIso = new Date().toISOString();
    const dueIso = parsedDue.toISOString();
    const existing = idVal ? popupState.currentPayments.find(p => p.id === idVal) : undefined;
    const nextItem: PaymentItem = {
      id: existing?.id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      category,
      amount,
      currency,
      dueDate: dueIso,
      status: isPaid ? 'paid' : 'pending',
      paidAt: isPaid ? (existing?.paidAt || nowIso) : undefined,
      termName,
      methodNote,
      portalUrl,
      source: existing?.source || 'manual',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso
    };

    const next = existing
      ? popupState.currentPayments.map(p => (p.id === existing.id ? nextItem : p))
      : [...popupState.currentPayments, nextItem];
    setPaymentModalVisible(false);
    await persistAndSyncPayments(next, existing ? 'Updated Payment' : 'Added Payment');
    popupActions.showToast(existing ? 'Payment updated' : 'Payment added');
  });
}
