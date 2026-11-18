import type { PaymentCategory, PaymentItem } from '../types';
import { sanitizePayments } from './payments';

/** True when the current location/DOM appears to be a university Student Account / Finance portal page. */
export function isFinancePortalPage(
  loc: { hostname?: string; pathname?: string; href?: string },
  root?: Document | Element | null
): boolean {
  const path = (loc?.pathname || '').toLowerCase();
  const href = (loc?.href || '').toLowerCase();
  const host = (loc?.hostname || '').toLowerCase();
  if (
    /studentaccount|accountsummary|bwskogri|bwskf|tuition|installment|paymentplan|touchnet|tahseel/i.test(path) ||
    /studentaccount|accountsummary|bwskogri|paymentplan|touchnet/i.test(href)
  ) {
    return true;
  }
  if (host.includes('banner.') && root) {
    const titleText = (root.textContent || '').slice(0, 2000);
    if (/account\s+summary|installment\s+plan|amount\s+due|tuition\s+fees?|student\s+account/i.test(titleText)) {
      return true;
    }
  }
  return false;
}

function parseCurrencyAmount(raw: string): { amount: number; currency: string } | null {
  const clean = (raw || '').replace(/,/g, '').trim();
  if (!clean) return null;
  const match = clean.match(/\b(AED|USD|EUR|SAR|GBP|DHS)?\s*([+-]?\d+(?:\.\d{1,2})?)\s*(AED|USD|EUR|SAR|GBP|DHS)?\b/i);
  if (!match) return null;
  const amount = parseFloat(match[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const curRaw = (match[1] || match[3] || 'AED').toUpperCase();
  const currency = curRaw === 'DHS' ? 'AED' : curRaw;
  return { amount: Math.round(amount * 100) / 100, currency };
}

function parseFinanceDate(raw: string): string | null {
  const clean = (raw || '').trim();
  if (!clean || clean.length < 6) return null;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = new Date(clean);
  if (isNaN(parsed.getTime())) return null;
  parsed.setHours(23, 59, 0, 0);
  return parsed.toISOString();
}

function guessPaymentCategory(title: string): PaymentCategory {
  const low = title.toLowerCase();
  if (/installment|pdc|cheque|split|tabby|tamara/i.test(low)) return 'installment';
  if (/tuition|course\s*fee/i.test(low)) return 'tuition';
  if (/housing|dorm|hostel|residence/i.test(low)) return 'housing';
  if (/late\s*fee|fine|penalty/i.test(low)) return 'late_fee';
  if (/registration|deposit|admission|seat/i.test(low)) return 'registration';
  return 'other';
}

function stableId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return `portal_${(h >>> 0).toString(36)}`;
}

/**
 * Extracts payment due rows from a Banner Self-Service Student Account / Account Summary DOM.
 * Only rows carrying both a readable positive due amount and a valid due date are kept.
 */
export function parseFinancePageFromDoc(
  root: Document | Element,
  portalUrl = 'https://banner.sharjah.ac.ae',
  nowIso = new Date().toISOString()
): PaymentItem[] {
  const items: PaymentItem[] = [];
  const tables = Array.from(root.querySelectorAll('table'));

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) continue;

    let descIdx = -1;
    let dateIdx = -1;
    let amtIdx = -1;
    let termIdx = -1;
    let statusIdx = -1;

    const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(c => (c.textContent || '').trim().toLowerCase());
    headerCells.forEach((h, idx) => {
      if (/(?:description|detail|fee|item|installment|charge)/i.test(h) && descIdx === -1) descIdx = idx;
      if (/(?:due\s*date|payment\s*date|\bdate\b)/i.test(h) && dateIdx === -1) dateIdx = idx;
      if (/(?:balance|amount\s*due|\bdue\b|\bamount\b)/i.test(h)) amtIdx = idx;
      if (/(?:term|semester)/i.test(h) && termIdx === -1) termIdx = idx;
      if (/(?:status|state)/i.test(h) && statusIdx === -1) statusIdx = idx;
    });

    if (dateIdx === -1 || amtIdx === -1) continue;

    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll('th, td')).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length <= Math.max(dateIdx, amtIdx)) continue;

      const dueDate = parseFinanceDate(cells[dateIdx]);
      const amt = parseCurrencyAmount(cells[amtIdx]);
      if (!dueDate || !amt) continue;

      const rawDesc = descIdx !== -1 ? cells[descIdx] : `Scheduled Payment ${items.length + 1}`;
      const title = (rawDesc || 'University Fee').slice(0, 120);
      if (/total\s+(?:paid|credits?)/i.test(title)) continue;

      const termName = termIdx !== -1 && cells[termIdx] ? cells[termIdx] : undefined;
      const statusText = statusIdx !== -1 ? (cells[statusIdx] || '') : '';
      const isPaidRow = /\b(?:paid|settled|cleared)\b/i.test(statusText);
      items.push({
        id: stableId(`${title}|${dueDate.slice(0, 10)}|${termName || ''}`),
        title,
        category: guessPaymentCategory(title),
        amount: amt.amount,
        currency: amt.currency,
        dueDate,
        status: isPaidRow ? 'paid' : 'pending',
        termName,
        methodNote: 'Scanned from Student Finance Portal',
        portalUrl,
        source: 'portal',
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }
  }

  return sanitizePayments(items);
}

/** Convenience HTML string wrapper for background/off-DOM parsing. */
export function parseFinancePageFromHtml(
  html: string,
  portalUrl = 'https://banner.sharjah.ac.ae',
  nowIso = new Date().toISOString()
): PaymentItem[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseFinancePageFromDoc(doc, portalUrl, nowIso);
}
