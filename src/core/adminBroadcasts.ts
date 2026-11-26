import type { UiLanguage } from '../types';

export type AdminTarget = 'both' | 'extension' | 'companion';
export type AdminPriority = 'info' | 'warning' | 'critical';
export type AdminStatusLevel = 'info' | 'warning' | 'degraded' | 'maintenance';

export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  titleAr?: string;
  bodyAr?: string;
  target: AdminTarget;
  priority: AdminPriority;
  university?: string;
  minVersion?: string;
  maxVersion?: string;
  actionLabel?: string;
  actionUrl?: string;
  dismissible?: boolean;
  sendPush?: boolean;
  createdAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface AdminServiceStatus {
  enabled: boolean;
  level: AdminStatusLevel;
  message: string;
  messageAr?: string;
  affectedSystems?: string[];
  updatedAt?: string;
}

export interface AdminRemoteConfig {
  maintenanceMode?: boolean;
  disableAutoScanHosts?: string[];
  disableExamRefresh?: boolean;
  disableAiProxy?: boolean;
  minSafeExtensionVersion?: string;
  universityUrlOverrides?: Record<string, { blackboardUrl?: string; examSchedulePage?: string }>;
  updatedAt?: string;
}

export interface PublicAdminSnapshot {
  v?: number;
  generatedAt?: string;
  announcements: AdminAnnouncement[];
  serviceStatus?: AdminServiceStatus;
  remoteConfig?: AdminRemoteConfig;
  signature?: string;
  sigAlg?: string;
}

export interface AdminClientContext {
  surface: 'extension' | 'companion';
  version?: string;
  universityId?: string;
  nowMs?: number;
}

export function sanitizeAdminHttpsUrl(raw?: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

export function compareSemver(a?: string, b?: string): number {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export function isVersionInRange(version?: string, minVersion?: string, maxVersion?: string): boolean {
  const cleanVer = String(version || '').trim();
  const min = String(minVersion || '').trim();
  const max = String(maxVersion || '').trim();
  if (!cleanVer) return !min && !max;
  if (min && compareSemver(cleanVer, min) < 0) return false;
  if (max && compareSemver(cleanVer, max) > 0) return false;
  return true;
}

export function matchesAdminTarget(item: AdminAnnouncement, ctx: AdminClientContext): boolean {
  if (!item || !item.id || item.revokedAt) return false;
  const now = ctx.nowMs ?? Date.now();
  if (item.expiresAt) {
    const exp = Date.parse(item.expiresAt);
    if (!isNaN(exp) && exp <= now) return false;
  }
  if (item.target !== 'both' && item.target !== ctx.surface) return false;
  const uni = String(item.university || 'all').trim().toLowerCase();
  if (uni && uni !== 'all') {
    const userUni = String(ctx.universityId || '').trim().toLowerCase();
    if (!userUni || userUni !== uni) return false;
  }
  if (!isVersionInRange(ctx.version, item.minVersion, item.maxVersion)) return false;
  return true;
}

const PRIORITY_RANK: Record<AdminPriority, number> = { critical: 0, warning: 1, info: 2 };

export function filterVisibleAnnouncements(
  snapshot: PublicAdminSnapshot | null | undefined,
  ctx: AdminClientContext,
  dismissedIds: ReadonlySet<string> | string[] = []
): AdminAnnouncement[] {
  if (!snapshot || !Array.isArray(snapshot.announcements)) return [];
  const dismissed = Array.isArray(dismissedIds) ? new Set(dismissedIds) : dismissedIds;
  return snapshot.announcements
    .filter(item => matchesAdminTarget(item, ctx) && (!dismissed.has(item.id) || item.dismissible === false))
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 2;
      const pb = PRIORITY_RANK[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

export function localizeAdminAnnouncement(item: AdminAnnouncement, lang: UiLanguage = 'en') {
  const isAr = lang === 'ar';
  return {
    title: (isAr && item.titleAr?.trim()) ? item.titleAr.trim() : item.title,
    body: (isAr && item.bodyAr?.trim()) ? item.bodyAr.trim() : item.body,
    actionUrl: sanitizeAdminHttpsUrl(item.actionUrl),
    actionLabel: String(item.actionLabel || (isAr ? 'عرض التفاصيل' : 'Open Link')).trim()
  };
}

export function localizeServiceStatus(status: AdminServiceStatus | undefined, lang: UiLanguage = 'en'): string {
  if (!status || !status.enabled) return '';
  if (lang === 'ar' && status.messageAr?.trim()) return status.messageAr.trim();
  return String(status.message || '').trim();
}

export function isHostAutoScanDisabled(hostname: string, config?: AdminRemoteConfig): boolean {
  if (!config) return false;
  if (config.maintenanceMode) return true;
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || !Array.isArray(config.disableAutoScanHosts)) return false;
  return config.disableAutoScanHosts.some(pattern => {
    const p = String(pattern || '').trim().toLowerCase();
    return Boolean(p) && (host === p || host.endsWith(`.${p}`));
  });
}

export function isVersionBelowSafeMin(version: string, config?: AdminRemoteConfig): boolean {
  const min = String(config?.minSafeExtensionVersion || '').trim();
  if (!min || !version) return false;
  return compareSemver(version, min) < 0;
}

function decodeB64Url(str: string): Uint8Array {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Optional client-side ECDSA P-256 verification when an admin public signing key is configured.
 * If no publicKeyBase64Url is pinned on the client, returns true (TLS origin trust).
 */
export async function verifyAdminSnapshotSignature(
  snapshot: PublicAdminSnapshot,
  publicKeyBase64Url?: string
): Promise<boolean> {
  const pubStr = String(publicKeyBase64Url || '').trim();
  if (!pubStr) return true;
  if (!snapshot?.signature || typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    const rawPub = decodeB64Url(pubStr);
    const keyBytes = rawPub.buffer.slice(rawPub.byteOffset, rawPub.byteOffset + rawPub.byteLength) as ArrayBuffer;
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const msgBytes = new TextEncoder().encode(
      JSON.stringify({
        announcements: snapshot.announcements,
        serviceStatus: snapshot.serviceStatus,
        remoteConfig: snapshot.remoteConfig
      })
    );
    const sigRaw = decodeB64Url(snapshot.signature);
    const sigBytes = sigRaw.buffer.slice(sigRaw.byteOffset, sigRaw.byteOffset + sigRaw.byteLength) as ArrayBuffer;
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, msgBytes);
  } catch {
    return false;
  }
}
