import type { PaymentItem } from '../types';
import { sanitizePayments, mergeCloudPayments } from '../core/payments';
import { TombstoneMap } from './taskMerge';

export const PAYMENTS_STORAGE_KEY = 'bbs_payments';
export const PAYMENTS_UPDATED_AT_KEY = 'bbs_payments_updated_at';

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

function readLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, val: unknown): void {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch {}
}

/** Synchronous cached read for instant initial render. */
export function getCachedPaymentsSync(): PaymentItem[] {
  return sanitizePayments(readLocalStorage<PaymentItem[]>(PAYMENTS_STORAGE_KEY));
}

/** Reads stored payment deadlines from extension storage or localStorage. */
export async function getStoredPayments(): Promise<PaymentItem[]> {
  if (hasChromeStorage()) {
    try {
      const res = await chrome.storage.local.get([PAYMENTS_STORAGE_KEY]);
      if (Array.isArray(res?.[PAYMENTS_STORAGE_KEY])) {
        const clean = sanitizePayments(res[PAYMENTS_STORAGE_KEY]);
        writeLocalStorage(PAYMENTS_STORAGE_KEY, clean);
        return clean;
      }
    } catch {}
  }
  return sanitizePayments(readLocalStorage<PaymentItem[]>(PAYMENTS_STORAGE_KEY));
}

/** Reads the last update timestamp for payment deadlines. */
export async function getStoredPaymentsUpdatedAt(): Promise<string | null> {
  if (hasChromeStorage()) {
    try {
      const res = await chrome.storage.local.get([PAYMENTS_UPDATED_AT_KEY]);
      if (typeof res?.[PAYMENTS_UPDATED_AT_KEY] === 'string') {
        return res[PAYMENTS_UPDATED_AT_KEY];
      }
    } catch {}
  }
  try {
    return localStorage.getItem(PAYMENTS_UPDATED_AT_KEY);
  } catch {
    return null;
  }
}

/** Saves payment deadlines across chrome.storage.local and localStorage. */
export async function saveStoredPayments(
  payments: PaymentItem[],
  updatedAt?: string
): Promise<{ payments: PaymentItem[]; updatedAt: string }> {
  const clean = sanitizePayments(payments);
  const stamp = updatedAt || new Date().toISOString();

  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({
        [PAYMENTS_STORAGE_KEY]: clean,
        [PAYMENTS_UPDATED_AT_KEY]: stamp
      });
    } catch {}
  }

  writeLocalStorage(PAYMENTS_STORAGE_KEY, clean);
  writeLocalStorage(PAYMENTS_UPDATED_AT_KEY, stamp);
  return { payments: clean, updatedAt: stamp };
}

/** Merges incoming cloud payments into local storage respecting tombstones. */
export async function mergeCloudPaymentsStorage(
  cloudPayments?: PaymentItem[] | null,
  cloudUpdatedAt?: string,
  tombstones: TombstoneMap = {}
): Promise<boolean> {
  const cleanCloud = sanitizePayments(cloudPayments);
  const currentLocal = await getStoredPayments();
  const currentStamp = await getStoredPaymentsUpdatedAt();

  const merged = mergeCloudPayments(currentLocal, cleanCloud, tombstones);
  const timeLocal = currentStamp ? Date.parse(currentStamp) || 0 : 0;
  const timeCloud = cloudUpdatedAt ? Date.parse(cloudUpdatedAt) || 0 : 0;

  const changed = JSON.stringify(merged) !== JSON.stringify(currentLocal);
  if (changed || timeCloud > timeLocal) {
    const finalStamp = timeCloud > timeLocal && cloudUpdatedAt ? cloudUpdatedAt : new Date().toISOString();
    await saveStoredPayments(merged, finalStamp);
    return true;
  }
  return false;
}
