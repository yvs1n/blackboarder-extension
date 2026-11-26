// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  buildPresetPaymentsForTerm,
  formatPaymentAmount,
  mergeCloudPayments,
  paymentsAsDeadlineTasks,
  safePaymentUrl,
  sanitizePayments,
  sortPayments,
  summarizePayments,
  universityPaymentGuide,
} from '../../src/core/payments';
import { isFinancePortalPage, parseFinancePageFromHtml } from '../../src/core/financePageParser';
import { initPaymentsView, openPaymentModal } from '../../src/popup/modules/paymentsView';
import { popupState } from '../../src/popup/modules/state';
import { mergeForCloudWrite, readCloudSide } from '../../src/utils/sync/syncMerge';
import { unwrapCloudVault, wrapCloudVault } from '../../src/utils/sync/vaultCrypto';
import type { PaymentItem } from '../../src/types';

describe('payments core helpers', () => {
  it('sanitizes, formats amounts, validates portal URLs, and sorts pending before paid', () => {
    expect(formatPaymentAmount(12500, 'AED')).toBe('AED 12,500');
    expect(formatPaymentAmount(undefined, 'AED')).toBe('');
    expect(safePaymentUrl('https://banner.sharjah.ac.ae/pay')).toBe('https://banner.sharjah.ac.ae/pay');
    expect(safePaymentUrl('javascript:alert(1)')).toBeUndefined();

    const clean = sanitizePayments([
      null,
      { id: '', title: 'bad', dueDate: '2026-10-01' },
      {
        id: 'p_paid',
        title: 'Fall 50% Initial Payment',
        category: 'tuition',
        amount: 15000,
        currency: 'aed',
        dueDate: '2026-09-03T20:00:00.000Z',
        status: 'paid',
        portalUrl: 'javascript:evil()',
      },
      {
        id: 'p_due',
        title: 'Fall Installment 2 (25%)',
        category: 'installment',
        amount: 7500,
        currency: 'AED',
        dueDate: '2026-10-01T20:00:00.000Z',
        status: 'pending',
      },
    ]);

    expect(clean).toHaveLength(2);
    expect(clean[0].currency).toBe('AED');
    expect(clean[0].portalUrl).toBeUndefined();
    const sorted = sortPayments(clean);
    expect(sorted.map(p => p.id)).toEqual(['p_due', 'p_paid']);
  });

  it('merges cloud & local payments by newest timestamp and respects tombstones', () => {
    const local: PaymentItem[] = [
      {
        id: 'pay_1',
        title: 'Installment 1',
        category: 'installment',
        amount: 5000,
        currency: 'AED',
        dueDate: '2026-09-03T19:59:00.000Z',
        status: 'paid',
        source: 'manual',
        updatedAt: '2026-09-03T10:00:00.000Z',
      },
      {
        id: 'pay_local_only',
        title: 'Parking Permit',
        category: 'other',
        currency: 'AED',
        dueDate: '2026-09-10T19:59:00.000Z',
        status: 'pending',
        source: 'manual',
        updatedAt: '2026-09-02T10:00:00.000Z',
      },
    ];
    const cloud: PaymentItem[] = [
      {
        id: 'pay_1',
        title: 'Installment 1',
        category: 'installment',
        amount: 5000,
        currency: 'AED',
        dueDate: '2026-09-03T19:59:00.000Z',
        status: 'pending',
        source: 'manual',
        updatedAt: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 'pay_deleted',
        title: 'Old Dorm Deposit',
        category: 'housing',
        currency: 'AED',
        dueDate: '2026-08-25T19:59:00.000Z',
        status: 'pending',
        source: 'manual',
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    ];
    const merged = mergeCloudPayments(local, cloud, { pay_deleted: '2026-08-22T00:00:00.000Z' });
    expect(merged.map(p => p.id)).toEqual(['pay_local_only', 'pay_1']);
    expect(merged.find(p => p.id === 'pay_1')?.status).toBe('paid');
  });

  it('summarizes totals by currency and projects only unpaid items into calendar tasks', () => {
    const now = new Date('2026-09-20T12:00:00Z').getTime();
    const items: PaymentItem[] = [
      {
        id: 'pay_overdue',
        title: 'Registration Fee',
        category: 'registration',
        amount: 1000,
        currency: 'AED',
        dueDate: '2026-09-15T19:59:00.000Z',
        status: 'pending',
        source: 'manual',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'pay_next',
        title: 'Installment 2',
        category: 'installment',
        amount: 6500,
        currency: 'AED',
        dueDate: '2026-10-01T19:59:00.000Z',
        status: 'pending',
        source: 'manual',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'pay_done',
        title: 'Installment 1',
        category: 'installment',
        amount: 13000,
        currency: 'AED',
        dueDate: '2026-09-03T19:59:00.000Z',
        status: 'paid',
        source: 'manual',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
    ];
    const summary = summarizePayments(items, now);
    expect(summary.pendingCount).toBe(2);
    expect(summary.paidCount).toBe(1);
    expect(summary.overdueCount).toBe(1);
    expect(summary.nextDue?.id).toBe('pay_overdue');
    expect(summary.totalsByCurrency).toEqual([{ currency: 'AED', amount: 7500 }]);

    const projected = paymentsAsDeadlineTasks(items);
    expect(projected).toHaveLength(2);
    expect(projected.every(t => t.isPayment && t.courseCode === 'FINANCE')).toBe(true);
    expect(projected[0].paymentAmountText).toBe('AED 1,000');
  });

  it('provides verified UOS portal guide and preset installment dates plus generic fallback', () => {
    const uos = universityPaymentGuide('uos');
    expect(uos.portals.some(p => p.url.includes('banner.sharjah.ac.ae'))).toBe(true);
    expect(uos.presetTerms.length).toBeGreaterThanOrEqual(2);
    const fall = buildPresetPaymentsForTerm('uos', uos.presetTerms[0].id, []);
    expect(fall.items.length).toBeGreaterThanOrEqual(3);

    const generic = universityPaymentGuide('other');
    expect(generic.steps.length).toBeGreaterThan(0);
    expect(buildPresetPaymentsForTerm('other', 'anything', []).items).toEqual([]);
  });
});

describe('finance page parser and vault integration', () => {
  it('parses Banner student account installment rows safely without scraping unverified endpoints', () => {
    expect(isFinancePortalPage({ hostname: 'banner.sharjah.ac.ae', pathname: '/StudentAccountSummary' })).toBe(true);
    const html = `
      <table>
        <thead><tr><th>Installment Description</th><th>Due Date</th><th>Amount Due</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Fall 2026 Installment 2 (25%)</td><td>01-Oct-2026</td><td>6,250.00 AED</td><td>Pending</td></tr>
          <tr><td>Fall 2026 Initial Deposit (50%)</td><td>03-Sep-2026</td><td>12,500.00 AED</td><td>Paid</td></tr>
        </tbody>
      </table>
    `;
    const parsed = parseFinancePageFromHtml(html, 'https://banner.sharjah.ac.ae/StudentAccountSummary');
    expect(parsed).toHaveLength(2);
    const pendingRow = parsed.find(p => p.title.includes('Installment 2'));
    const paidRow = parsed.find(p => p.title.includes('Initial Deposit'));
    expect(pendingRow?.amount).toBe(6250);
    expect(pendingRow?.currency).toBe('AED');
    expect(pendingRow?.status).toBe('pending');
    expect(paidRow?.amount).toBe(12500);
    expect(paidRow?.status).toBe('paid');
  });

  it('preserves payments across mergeForCloudWrite and encrypted vault wrap/unwrap', async () => {
    const payment: PaymentItem = {
      id: 'pay_oct',
      title: 'Fall Installment 2 (25%)',
      category: 'installment',
      amount: 6250,
      currency: 'AED',
      dueDate: '2026-10-01T19:59:00.000Z',
      status: 'pending',
      methodNote: 'Tahseel / Banner',
      source: 'manual',
      updatedAt: '2026-09-20T12:00:00.000Z',
    };
    const paidPayment: PaymentItem = {
      id: 'pay_sep',
      title: 'Fall Initial Payment',
      category: 'tuition',
      amount: 12500,
      currency: 'AED',
      dueDate: '2026-09-03T19:59:00.000Z',
      status: 'paid',
      source: 'manual',
      updatedAt: '2026-09-03T12:00:00.000Z',
    };

    const merged = mergeForCloudWrite(
      { tasks: [], tombstones: {}, payments: [payment], paymentsUpdatedAt: payment.updatedAt },
      readCloudSide({ payments: [paidPayment], paymentsUpdatedAt: paidPayment.updatedAt })
    );
    expect(merged.payments?.map(p => p.id).sort()).toEqual(['pay_oct', 'pay_sep']);

    const vault = await wrapCloudVault({ tasks: [], payments: merged.payments, paymentsUpdatedAt: merged.paymentsUpdatedAt }, 'test-sync-key-123');
    const unwrapped = await unwrapCloudVault(vault, 'test-sync-key-123');
    expect(unwrapped.payments).toHaveLength(2);
  });

  it('opens #modal-payment with a valid datetime-local value and adds a payment on submit', async () => {
    popupState.currentPayments = [];
    document.body.innerHTML = `
      <div id="payments-summary-card"></div>
      <div id="payments-list"></div>
      <div id="payments-guide-card"></div>
      <div id="modal-payment" class="modal-backdrop hidden" style="display: none;">
        <h3 id="modal-payment-title"></h3>
        <form id="form-payment">
          <input type="hidden" id="payment-id" />
          <input type="text" id="payment-title" />
          <select id="payment-category"><option value="installment">Installment</option></select>
          <input type="datetime-local" id="payment-due-date" />
          <input type="number" id="payment-amount" />
          <input type="text" id="payment-currency" value="AED" />
          <input type="text" id="payment-term" />
          <input type="text" id="payment-method-note" />
          <input type="text" id="payment-portal-url" />
          <input type="checkbox" id="payment-paid-check" />
          <button type="submit">Save Payment</button>
        </form>
      </div>
    `;
    initPaymentsView();
    openPaymentModal();

    const dateInput = document.getElementById('payment-due-date') as HTMLInputElement;
    // datetime-local requires YYYY-MM-DDTHH:mm (16 chars)
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    (document.getElementById('payment-title') as HTMLInputElement).value = 'Spring Tuition Installment 1';
    (document.getElementById('payment-amount') as HTMLInputElement).value = '9500';
    (document.getElementById('payment-portal-url') as HTMLInputElement).value = 'banner.sharjah.ac.ae';
    dateInput.value = '2026-11-27T23:59';

    const form = document.getElementById('form-payment') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 25));

    expect(popupState.currentPayments).toHaveLength(1);
    expect(popupState.currentPayments[0].title).toBe('Spring Tuition Installment 1');
    expect(popupState.currentPayments[0].amount).toBe(9500);
    expect(popupState.currentPayments[0].portalUrl).toBe('https://banner.sharjah.ac.ae/');
    expect(document.getElementById('payments-list')?.textContent).toContain('Spring Tuition Installment 1');
  });
});
