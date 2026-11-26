import type { DeadlineTask, PaymentCategory, PaymentItem } from '../types';
import type { TombstoneMap } from '../utils/tasks/taskMerge';

const SAFE_PAYMENT_ID = /^[^\u0000-\u001f\u007f<>"`\\]{1,160}$/;
const VALID_CATEGORIES: PaymentCategory[] = ['tuition', 'installment', 'registration', 'housing', 'late_fee', 'other'];

export const PAYMENT_CATEGORY_LABELS: Record<PaymentCategory, string> = {
  tuition: 'Tuition Fee',
  installment: 'Installment',
  registration: 'Registration / Deposit',
  housing: 'Housing / Dorms',
  late_fee: 'Cutoff / Late Fine',
  other: 'University Fee'
};

export interface PaymentGuidePortal {
  title: string;
  url: string;
  description: string;
}

export interface PaymentPresetTerm {
  id: string;
  label: string;
  items: Array<{
    id: string;
    title: string;
    category: PaymentCategory;
    dueDate: string;
    amount?: number;
    currency: string;
    termName: string;
    methodNote: string;
    portalUrl?: string;
  }>;
}

export interface UniversityPaymentGuide {
  universityId: string;
  headline: string;
  defaultCurrency: string;
  steps: string[];
  methods: string[];
  portals: PaymentGuidePortal[];
  presetTerms: PaymentPresetTerm[];
}

export function paymentCategoryLabel(cat?: PaymentCategory): string {
  return (cat && PAYMENT_CATEGORY_LABELS[cat]) || PAYMENT_CATEGORY_LABELS.other;
}

export function formatPaymentAmount(amount?: number, currency = 'AED'): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return '';
  const rounded = Math.round(amount * 100) / 100;
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${(currency || 'AED').toUpperCase()} ${formatted}`;
}

export function safePaymentUrl(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
  } catch {}
  return undefined;
}

export function sanitizePayments(raw: unknown): PaymentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, any>;
    if (typeof p.id !== 'string' || !SAFE_PAYMENT_ID.test(p.id) || seen.has(p.id)) continue;
    const title = typeof p.title === 'string' ? p.title.trim().slice(0, 160) : '';
    const dueMs = typeof p.dueDate === 'string' ? Date.parse(p.dueDate) : NaN;
    if (!title || isNaN(dueMs)) continue;
    seen.add(p.id);
    const amountRaw = typeof p.amount === 'number' ? p.amount : (typeof p.amount === 'string' && p.amount.trim() ? Number(p.amount) : NaN);
    const amount = Number.isFinite(amountRaw) && amountRaw >= 0 ? Math.round(amountRaw * 100) / 100 : undefined;
    const status = p.status === 'paid' ? 'paid' : 'pending';
    const currency = typeof p.currency === 'string' && /^[A-Za-z]{2,5}$/.test(p.currency.trim())
      ? p.currency.trim().toUpperCase()
      : 'AED';
    const updatedAt = typeof p.updatedAt === 'string' && !isNaN(Date.parse(p.updatedAt))
      ? p.updatedAt
      : new Date().toISOString();

    out.push({
      id: p.id,
      title,
      category: VALID_CATEGORIES.includes(p.category) ? p.category : 'other',
      ...(amount !== undefined ? { amount } : {}),
      currency,
      dueDate: new Date(dueMs).toISOString(),
      status,
      ...(status === 'paid' && typeof p.paidAt === 'string' && !isNaN(Date.parse(p.paidAt)) ? { paidAt: p.paidAt } : {}),
      ...(typeof p.termName === 'string' && p.termName.trim() ? { termName: p.termName.trim().slice(0, 80) } : {}),
      ...(typeof p.methodNote === 'string' && p.methodNote.trim() ? { methodNote: p.methodNote.trim().slice(0, 320) } : {}),
      ...(safePaymentUrl(p.portalUrl) ? { portalUrl: safePaymentUrl(p.portalUrl) } : {}),
      source: p.source === 'preset' || p.source === 'portal' ? p.source : 'manual',
      ...(typeof p.createdAt === 'string' && !isNaN(Date.parse(p.createdAt)) ? { createdAt: p.createdAt } : {}),
      updatedAt
    });
  }
  return sortPayments(out);
}

/** Pending payments soonest-first (overdue first), then paid items newest-paid first. */
export function sortPayments(items: PaymentItem[]): PaymentItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    const ta = Date.parse(a.dueDate) || 0;
    const tb = Date.parse(b.dueDate) || 0;
    if (a.status === 'pending') return ta - tb;
    return tb - ta;
  });
}

function paymentTime(p: PaymentItem): number {
  const t = Date.parse(p.updatedAt || p.createdAt || '');
  return isNaN(t) ? 0 : t;
}

/** Merges local and cloud payment deadlines per item id using newest `updatedAt` + deletion tombstones. */
export function mergeCloudPayments(
  localItems: PaymentItem[] = [],
  cloudItems: PaymentItem[] = [],
  tombstones: TombstoneMap = {}
): PaymentItem[] {
  const map = new Map<string, PaymentItem>();
  const cleanLocal = sanitizePayments(localItems);
  const cleanCloud = sanitizePayments(cloudItems);

  const isDeleted = (item: PaymentItem) => {
    const tomb = tombstones[item.id];
    if (!tomb) return false;
    const tombMs = Date.parse(tomb);
    return !isNaN(tombMs) && tombMs >= paymentTime(item);
  };

  for (const item of cleanLocal) {
    if (!isDeleted(item)) map.set(item.id, item);
  }
  for (const cloud of cleanCloud) {
    if (isDeleted(cloud)) continue;
    const local = map.get(cloud.id);
    if (!local) {
      map.set(cloud.id, cloud);
      continue;
    }
    const lt = paymentTime(local);
    const ct = paymentTime(cloud);
    if (ct > lt) {
      map.set(cloud.id, {
        ...local,
        ...cloud,
        amount: cloud.amount !== undefined ? cloud.amount : local.amount,
        methodNote: cloud.methodNote || local.methodNote,
        portalUrl: cloud.portalUrl || local.portalUrl,
        termName: cloud.termName || local.termName
      });
    } else if (lt > ct) {
      map.set(cloud.id, {
        ...cloud,
        ...local,
        amount: local.amount !== undefined ? local.amount : cloud.amount,
        methodNote: local.methodNote || cloud.methodNote,
        portalUrl: local.portalUrl || cloud.portalUrl,
        termName: local.termName || cloud.termName
      });
    } else {
      map.set(cloud.id, cloud.status === 'paid' ? cloud : local);
    }
  }
  return sortPayments(Array.from(map.values()));
}

export interface PaymentsSummary {
  pendingCount: number;
  overdueCount: number;
  dueSoonCount: number;
  paidCount: number;
  totalsByCurrency: Array<{ currency: string; amount: number }>;
  nextDue?: PaymentItem;
  nextDueDays?: number;
}

export function summarizePayments(items: PaymentItem[], nowMs = Date.now()): PaymentsSummary {
  const clean = sortPayments(sanitizePayments(items));
  const pending = clean.filter(p => p.status === 'pending');
  const paid = clean.filter(p => p.status === 'paid');
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const startMs = todayStart.getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  let overdueCount = 0;
  let dueSoonCount = 0;
  const currencyTotals = new Map<string, number>();

  for (const p of pending) {
    const dueMs = Date.parse(p.dueDate);
    if (dueMs < nowMs) overdueCount++;
    if (dueMs <= nowMs + sevenDaysMs) dueSoonCount++;
    if (typeof p.amount === 'number' && Number.isFinite(p.amount)) {
      currencyTotals.set(p.currency, (currencyTotals.get(p.currency) || 0) + p.amount);
    }
  }

  const nextDue = pending[0];
  let nextDueDays: number | undefined;
  if (nextDue) {
    const dueDay = new Date(nextDue.dueDate);
    dueDay.setHours(0, 0, 0, 0);
    nextDueDays = Math.round((dueDay.getTime() - startMs) / (24 * 60 * 60 * 1000));
  }

  const totalsByCurrency = Array.from(currencyTotals.entries()).map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100
  }));

  return {
    pendingCount: pending.length,
    overdueCount,
    dueSoonCount,
    paidCount: paid.length,
    totalsByCurrency,
    nextDue,
    nextDueDays
  };
}

/** Converts a pending payment item into a virtual calendar/deadline object (never stored in academic tasks or GPA). */
export function paymentToDeadlineTask(p: PaymentItem): DeadlineTask {
  const amtText = formatPaymentAmount(p.amount, p.currency);
  const details = [
    amtText ? `Amount Due: ${amtText}` : '',
    p.termName ? `Term: ${p.termName}` : '',
    p.methodNote || '',
    p.portalUrl ? `Portal: ${p.portalUrl}` : ''
  ].filter(Boolean).join('\n');

  return {
    id: `pay_${p.id}`,
    courseCode: 'FINANCE',
    courseName: p.termName ? `Payments · ${p.termName}` : 'Payments & Fees',
    title: p.title,
    description: details,
    dueDate: p.dueDate,
    hasSpecificTime: false,
    type: 'other',
    priority: 'high',
    status: p.status === 'paid' ? 'completed' : 'pending',
    sourceSnippet: details || paymentCategoryLabel(p.category),
    confidence: 1,
    extractedBy: 'manual',
    notes: p.methodNote,
    isPayment: true,
    paymentId: p.id,
    paymentAmountText: amtText || undefined,
    paymentCategory: p.category,
    createdAt: p.createdAt || p.updatedAt,
    updatedAt: p.updatedAt
  };
}

/** Projects only unpaid pending payments onto Calendar, Deadlines, and Reminders. */
export function paymentsAsDeadlineTasks(items: PaymentItem[]): DeadlineTask[] {
  return sortPayments(sanitizePayments(items))
    .filter(p => p.status === 'pending')
    .map(paymentToDeadlineTask);
}

/** Returns guided instructions, verified portal links, and term installment presets per university. */
export function universityPaymentGuide(universityId?: string): UniversityPaymentGuide {
  const id = (universityId || 'uos').toLowerCase();
  if (id === 'uos') {
    return {
      universityId: 'uos',
      headline: 'University of Sharjah (UOS) Student Finance Guide',
      defaultCurrency: 'AED',
      steps: [
        'Sign in to MyUoS Portal and open Banner Self-Service (MyUDC).',
        'Go to E-Services -> Student -> Student Account -> Account Summary to view exact tuition balances and due dates.',
        'Open Credit Card Payment inside Student Account to settle in full, pay the 50% initial installment, or split via Tabby / Tamara.',
        'When paying by Post-Dated Cheques (PDCs), submit cheques to UOS Finance before the initial semester due date to avoid the AED 500 late fee.'
      ],
      methods: [
        'Online Card & Wallets: Visa, MasterCard, Apple Pay, Google Pay, Samsung Pay (Tahseel gateway)',
        'Installments: Tabby & Tamara options inside the Banner online payment portal',
        'Sharjah Islamic Bank (SIB): Deposit directly at SIB ATMs or tellers using your UOS Student ID',
        'Post-Dated Cheques (PDCs): 50% upfront + 25% & 25% scheduled monthly cheques submitted on campus'
      ],
      portals: [
        {
          title: 'Banner Student Account (MyUDC)',
          url: 'https://banner.sharjah.ac.ae',
          description: 'View Account Summary, holds, and pay online'
        },
        {
          title: 'University of Sharjah Official Site',
          url: 'https://www.sharjah.ac.ae',
          description: 'Academic calendar and published fee policies'
        }
      ],
      presetTerms: [
        {
          id: 'uos-fall-2026',
          label: 'Fall 2026/27 Dates',
          items: [
            {
              id: 'uos_fall26_initial',
              title: 'Fall Initial Tuition (50% / PDC Cutoff)',
              category: 'tuition',
              dueDate: '2026-09-03T19:59:00.000Z',
              currency: 'AED',
              termName: 'Fall 2026/27',
              methodNote: 'Pay full or minimum 50% initial installment (or submit PDCs). Late fine of AED 500 applies after this deadline.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            },
            {
              id: 'uos_fall26_census',
              title: 'Fall Add/Drop & Refund Cutoff',
              category: 'registration',
              dueDate: '2026-09-13T19:59:00.000Z',
              currency: 'AED',
              termName: 'Fall 2026/27',
              methodNote: 'Last day to drop/withdraw with tuition adjustment; full semester fees apply afterward.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            },
            {
              id: 'uos_fall26_inst2',
              title: 'Fall 2nd Installment (25%)',
              category: 'installment',
              dueDate: '2026-10-01T19:59:00.000Z',
              currency: 'AED',
              termName: 'Fall 2026/27',
              methodNote: 'Second 25% installment or scheduled PDC clearance via Student Account / SIB.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            },
            {
              id: 'uos_fall26_inst3',
              title: 'Fall 3rd Installment (Final 25%)',
              category: 'installment',
              dueDate: '2026-11-01T19:59:00.000Z',
              currency: 'AED',
              termName: 'Fall 2026/27',
              methodNote: 'Final 25% semester balance due via Student Account, Tahseel, Tabby/Tamara, or PDC.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            }
          ]
        },
        {
          id: 'uos-spring-2027',
          label: 'Spring 2026/27 Dates',
          items: [
            {
              id: 'uos_spring27_initial',
              title: 'Spring Initial Tuition (50% / PDC Cutoff)',
              category: 'tuition',
              dueDate: '2027-01-21T19:59:00.000Z',
              currency: 'AED',
              termName: 'Spring 2026/27',
              methodNote: 'Minimum 50% upfront payment or Post-Dated Cheques required before deadline to avoid late fee.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            },
            {
              id: 'uos_spring27_inst2',
              title: 'Spring 2nd Installment (25%)',
              category: 'installment',
              dueDate: '2027-03-01T19:59:00.000Z',
              currency: 'AED',
              termName: 'Spring 2026/27',
              methodNote: 'Second 25% tuition installment via Banner Student Account, SIB, or PDC.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            },
            {
              id: 'uos_spring27_inst3',
              title: 'Spring 3rd Installment (Final 25%)',
              category: 'installment',
              dueDate: '2027-04-01T19:59:00.000Z',
              currency: 'AED',
              termName: 'Spring 2026/27',
              methodNote: 'Final 25% Spring tuition balance due.',
              portalUrl: 'https://banner.sharjah.ac.ae'
            }
          ]
        }
      ]
    };
  }

  return {
    universityId: id,
    headline: 'Student Finance & Installment Guide',
    defaultCurrency: 'AED',
    steps: [
      'Open your university Student Information System (Banner / PeopleSoft / Self-Service) and go to Student Account -> Account Summary.',
      'Check total term balance, installment split due dates, and registration hold cutoffs.',
      'Add each installment or deposit due date here so Blackboarder alerts you before late fees or registration blocks trigger.'
    ],
    methods: [
      'Add tuition, housing, registration deposit, or installment due dates manually via + Add Payment.',
      'Include your exact currency (AED, USD, EUR, SAR) and receipt notes for every installment.'
    ],
    portals: [],
    presetTerms: []
  };
}

/** Appends a term's preset payment milestones without duplicating existing or tombstoned ids. */
export function buildPresetPaymentsForTerm(
  universityId: string,
  termId: string,
  existing: PaymentItem[],
  tombstones: TombstoneMap = {},
  nowIso = new Date().toISOString()
): { added: number; items: PaymentItem[] } {
  const guide = universityPaymentGuide(universityId);
  const term = guide.presetTerms.find(t => t.id === termId);
  if (!term) return { added: 0, items: sanitizePayments(existing) };

  const clean = sanitizePayments(existing);
  const existingIds = new Set(clean.map(p => p.id));
  const nowMs = Date.now();
  const additions: PaymentItem[] = [];

  for (const p of term.items) {
    if (existingIds.has(p.id) || tombstones[p.id]) continue;
    const dueMs = Date.parse(p.dueDate);
    additions.push({
      id: p.id,
      title: p.title,
      category: p.category,
      currency: p.currency,
      dueDate: p.dueDate,
      status: !isNaN(dueMs) && dueMs < nowMs - 60 * 24 * 60 * 60 * 1000 ? 'paid' : 'pending',
      termName: p.termName,
      methodNote: p.methodNote,
      portalUrl: p.portalUrl,
      source: 'preset',
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  return {
    added: additions.length,
    items: sortPayments([...clean, ...additions])
  };
}
