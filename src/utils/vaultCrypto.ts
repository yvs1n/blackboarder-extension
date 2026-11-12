/**
 * Blackboarder - Client-Side Zero-Knowledge Cloud Vault Cryptography
 *
 * Encrypts and decrypts all synced student records (tasks, grades, courses,
 * syllabi, profile, and quick links) before storage in Firebase Realtime Database.
 *
 * Algorithm: AES-256-GCM with fresh 12-byte IV per encryption (AEAD authenticated).
 * Key Derivation: RFC 5869 HKDF-SHA256 derived from the student's 20-character secret sync key.
 * Envelope Format: "v1:<b64url(iv)>:<b64url(ciphertext)>"
 */

const VAULT_SALT = 'blackboarder_vault_salt_v1';
const VAULT_INFO = 'blackboarder_vault_encryption';

const vaultKeyCache = new Map<string, CryptoKey>();

/**
 * Clears the in-memory cache of derived CryptoKeys (useful for testing or unpairing).
 */
export function clearVaultKeyCache(): void {
  vaultKeyCache.clear();
}

function getCryptoSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle is not available in this environment');
  }
  return subtle;
}

/**
 * Converts bytes to Base64URL without argument-length stack limits on large payloads.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts Base64URL string back to bytes.
 */
export function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from the secret sync key using HKDF-SHA256.
 * Caches derived keys in-memory so subsequent calls within a session avoid redundant HKDF computations.
 */
export async function deriveVaultCryptoKey(syncKey: string): Promise<CryptoKey> {
  const cleanKey = (syncKey || '').trim();
  if (!cleanKey) {
    throw new Error('Cannot derive vault key: syncKey is empty');
  }
  const cached = vaultKeyCache.get(cleanKey);
  if (cached) {
    return cached;
  }
  const subtle = getCryptoSubtle();
  const enc = new TextEncoder();
  const rawKey = await subtle.importKey(
    'raw',
    enc.encode(cleanKey),
    'HKDF',
    false,
    ['deriveKey']
  );
  const derivedKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(VAULT_SALT),
      info: enc.encode(VAULT_INFO)
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  vaultKeyCache.set(cleanKey, derivedKey);
  return derivedKey;
}

/**
 * Checks whether a value matches the encrypted vault envelope format.
 */
export function isVaultEnvelope(val: unknown): val is string {
  return typeof val === 'string' && val.startsWith('v1:') && val.split(':').length === 3;
}

/**
 * Encrypts an arbitrary JSON-serializable payload into a versioned ciphertext string.
 */
export async function encryptVaultPayload(data: unknown, syncKey: string): Promise<string> {
  const cleanKey = (syncKey || '').trim();
  if (!cleanKey) throw new Error('syncKey is required for vault encryption');
  const subtle = getCryptoSubtle();
  const key = await deriveVaultCryptoKey(cleanKey);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);
  return `v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(ciphertext)}`;
}

/**
 * Decrypts a versioned vault envelope using the sync key.
 * Throws if the envelope is invalid, the key is wrong, or the ciphertext was tampered with.
 */
export async function decryptVaultPayload<T = any>(vaultStr: string, syncKey: string): Promise<T> {
  const cleanKey = (syncKey || '').trim();
  if (!cleanKey) throw new Error('syncKey is required for vault decryption');
  if (!isVaultEnvelope(vaultStr)) {
    throw new Error('Invalid vault envelope format (expected v1:iv:ciphertext)');
  }
  const parts = vaultStr.split(':');
  const iv = base64UrlToBytes(parts[1]);
  const ciphertext = base64UrlToBytes(parts[2]);
  if (iv.length !== 12) {
    throw new Error('Invalid IV length in vault envelope');
  }
  const subtle = getCryptoSubtle();
  const key = await deriveVaultCryptoKey(cleanKey);
  const decryptedBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource
  );
  const plaintext = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(plaintext) as T;
}

export interface CloudVaultDocument {
  vault: string;
  lastSync: string;
  device?: string;
  scanRequest?: any;
}

/**
 * Wraps a full sync payload (tasks, courses, profile, etc.) into an encrypted cloud document.
 * Keeps `lastSync`, `device`, and `scanRequest` outside so background polling and RTDB rules
 * work seamlessly without exposing private academic data.
 */
export async function wrapCloudVault(payload: Record<string, any>, syncKey: string): Promise<CloudVaultDocument> {
  const cleanKey = (syncKey || '').trim();
  const lastSync = typeof payload.lastSync === 'string' && payload.lastSync ? payload.lastSync : new Date().toISOString();
  const device = typeof payload.device === 'string' ? payload.device : undefined;
  const scanRequest = payload.scanRequest;

  // The inner bundle contains all sensitive academic and personal records
  const innerData: Record<string, any> = {
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    courses: Array.isArray(payload.courses) ? payload.courses : undefined,
    coursesUpdatedAt: payload.coursesUpdatedAt,
    quickLinks: Array.isArray(payload.quickLinks) ? payload.quickLinks : undefined,
    quickLinksUpdatedAt: payload.quickLinksUpdatedAt,
    tombstones: payload.tombstones && typeof payload.tombstones === 'object' ? payload.tombstones : undefined,
    profile: payload.profile,
    semesters: Array.isArray(payload.semesters) ? payload.semesters : undefined,
    semestersUpdatedAt: payload.semestersUpdatedAt,
    count: typeof payload.count === 'number' ? payload.count : (payload.tasks ? payload.tasks.length : 0),
    device,
    lastSync,
    syncKey: cleanKey || undefined
  };

  const vault = await encryptVaultPayload(innerData, cleanKey);
  const doc: CloudVaultDocument = {
    vault,
    lastSync
  };
  if (device) doc.device = device;
  if (scanRequest) doc.scanRequest = scanRequest;
  return doc;
}

/**
 * Unwraps a cloud document read from Firebase or KV:
 * If it contains a `vault` envelope, decrypts it using the sync key.
 * If it does not contain a `vault` (legacy unencrypted cloud data), returns it as-is.
 */
export async function unwrapCloudVault(cloudData: any, syncKey: string): Promise<any> {
  if (!cloudData || typeof cloudData !== 'object') return cloudData;
  if (cloudData.deleted === true) return cloudData;

  // If encrypted with vault envelope, decrypt
  if (isVaultEnvelope(cloudData.vault)) {
    const cleanKey = (syncKey || '').trim();
    if (!cleanKey) {
      throw new Error('Cannot unwrap cloud vault: syncKey is missing');
    }
    const decrypted = await decryptVaultPayload<Record<string, any>>(cloudData.vault, cleanKey);
    return {
      ...decrypted,
      // Preserve top-level metadata if missing inside
      lastSync: cloudData.lastSync || decrypted.lastSync,
      device: cloudData.device || decrypted.device,
      scanRequest: cloudData.scanRequest || decrypted.scanRequest
    };
  }

  // Legacy unencrypted document
  return cloudData;
}
