// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyFields, collectFields, DRAFT_KEY, isDraftFresh, loadDraft, saveDraft } from '../src/popup/popupDraft';

describe('Popup Draft Persistence for Financial Deadlines (Add & Edit Modal)', () => {
  let store: Record<string, any> = {};

  beforeEach(() => {
    store = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (obj: Record<string, any>) => { Object.assign(store, obj); }),
          remove: vi.fn(async (key: string) => { delete store[key]; })
        }
      }
    };
  });

  it('recognizes payments drafts with paymentModalMode add/edit as fresh drafts', async () => {
    saveDraft({
      view: 'payments',
      paymentModalMode: 'add',
      fields: {
        'payment-title': 'Fall Installment 2',
        'payment-amount': '8500',
        'payment-currency': 'AED',
        'payment-paid-check': false
      }
    });

    const loaded = await loadDraft();
    expect(isDraftFresh(loaded)).toBe(true);
    expect(loaded?.view).toBe('payments');
    expect(loaded?.paymentModalMode).toBe('add');
    expect(loaded?.fields?.['payment-title']).toBe('Fall Installment 2');
    expect(store[DRAFT_KEY].paymentModalMode).toBe('add');
  });

  it('collects and restores payment modal fields including edit id and paid checkbox state', () => {
    document.body.innerHTML = `
      <form id="form-payment">
        <input type="hidden" id="payment-id" value="">
        <input type="text" id="payment-title" value="">
        <select id="payment-category"><option value="tuition">Tuition</option><option value="housing">Housing</option></select>
        <input type="number" id="payment-amount" value="">
        <input type="checkbox" id="payment-paid-check">
      </form>
    `;

    const form = document.getElementById('form-payment') as HTMLFormElement;
    (document.getElementById('payment-id') as HTMLInputElement).value = 'pay_99';
    (document.getElementById('payment-title') as HTMLInputElement).value = 'Dorm Renewal Fee';
    (document.getElementById('payment-category') as HTMLSelectElement).value = 'housing';
    (document.getElementById('payment-amount') as HTMLInputElement).value = '4200';
    (document.getElementById('payment-paid-check') as HTMLInputElement).checked = true;

    const snapshot = collectFields(form);
    expect(snapshot['payment-id']).toBe('pay_99');
    expect(snapshot['payment-paid-check']).toBe(true);

    // Simulate clean popup reopen before applyFields runs
    (document.getElementById('payment-id') as HTMLInputElement).value = '';
    (document.getElementById('payment-title') as HTMLInputElement).value = '';
    (document.getElementById('payment-category') as HTMLSelectElement).value = 'tuition';
    (document.getElementById('payment-amount') as HTMLInputElement).value = '';
    (document.getElementById('payment-paid-check') as HTMLInputElement).checked = false;

    applyFields(snapshot);

    expect((document.getElementById('payment-id') as HTMLInputElement).value).toBe('pay_99');
    expect((document.getElementById('payment-title') as HTMLInputElement).value).toBe('Dorm Renewal Fee');
    expect((document.getElementById('payment-category') as HTMLSelectElement).value).toBe('housing');
    expect((document.getElementById('payment-amount') as HTMLInputElement).value).toBe('4200');
    expect((document.getElementById('payment-paid-check') as HTMLInputElement).checked).toBe(true);
  });

  it('recognizes add modal drafts layered over Deadlines or Settings tabs', async () => {
    saveDraft({
      view: 'add',
      returnView: 'details',
      fields: {
        'add-title': 'Midterm Review Quiz',
        'add-course': 'PHYS101',
      }
    });

    const loaded = await loadDraft();
    expect(isDraftFresh(loaded)).toBe(true);
    expect(loaded?.view).toBe('add');
    expect(loaded?.returnView).toBe('details');
    expect(loaded?.fields?.['add-title']).toBe('Midterm Review Quiz');

    saveDraft({
      view: 'add',
      returnView: 'settings',
      settingsPage: 'calendar',
      fields: { 'add-title': 'Lab Report 3' }
    });
    const settingsLoaded = await loadDraft();
    expect(isDraftFresh(settingsLoaded)).toBe(true);
    expect(settingsLoaded?.view).toBe('add');
    expect(settingsLoaded?.returnView).toBe('settings');
    expect(settingsLoaded?.settingsPage).toBe('calendar');
  });
});
