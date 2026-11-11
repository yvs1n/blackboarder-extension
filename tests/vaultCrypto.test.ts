import { describe, it, expect } from 'vitest';
import {
  deriveVaultCryptoKey,
  encryptVaultPayload,
  decryptVaultPayload,
  isVaultEnvelope,
  wrapCloudVault,
  unwrapCloudVault,
  bytesToBase64Url,
  base64UrlToBytes
} from '../src/utils/vaultCrypto';

describe('Vault Cryptography (Client-Side Zero-Knowledge)', () => {
  const sampleSyncKey = 'aB9xK2mP7qR4tV1wY8z0';
  const samplePayload = {
    tasks: [
      {
        id: 'task-1',
        courseCode: '1440131',
        courseName: 'Physics I',
        title: 'Lab Quiz 1',
        dueDate: '2026-11-20T10:00:00.000Z',
        weight: 15,
        status: 'pending'
      }
    ],
    courses: [
      {
        courseCode: '1440131',
        courseName: 'Physics I',
        colorHex: '#ef4444'
      }
    ],
    profile: {
      name: 'John Doe',
      studentId: 'U12345678',
      email: 'john@sharjah.ac.ae',
      university: 'uos'
    },
    lastSync: '2026-11-11T20:00:00.000Z'
  };

  it('derives a non-extractable AES-GCM crypto key via HKDF', async () => {
    const key = await deriveVaultCryptoKey(sampleSyncKey);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('correctly detects vault envelopes', () => {
    expect(isVaultEnvelope('v1:abcd:efgh')).toBe(true);
    expect(isVaultEnvelope('v2:abcd:efgh')).toBe(false);
    expect(isVaultEnvelope('v1:abcd')).toBe(false);
    expect(isVaultEnvelope(null)).toBe(false);
    expect(isVaultEnvelope({ vault: 'v1:a:b' })).toBe(false);
  });

  it('performs chunked base64url roundtrip on small and large data', () => {
    const small = new Uint8Array([1, 2, 3, 255, 0, 128]);
    expect(base64UrlToBytes(bytesToBase64Url(small))).toEqual(small);

    const large = new Uint8Array(100000);
    for (let i = 0; i < large.length; i++) large[i] = i % 256;
    const roundtrip = base64UrlToBytes(bytesToBase64Url(large));
    expect(roundtrip.length).toBe(large.length);
    expect(roundtrip[50000]).toBe(50000 % 256);
  });

  it('encrypts and decrypts payload with identical sync key', async () => {
    const ciphertext = await encryptVaultPayload(samplePayload, sampleSyncKey);
    expect(isVaultEnvelope(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain('Physics I');
    expect(ciphertext).not.toContain('John Doe');
    expect(ciphertext).not.toContain('U12345678');

    const decrypted = await decryptVaultPayload(ciphertext, sampleSyncKey);
    expect(decrypted).toEqual(samplePayload);
  });

  it('fails decryption when provided an incorrect sync key', async () => {
    const ciphertext = await encryptVaultPayload(samplePayload, sampleSyncKey);
    await expect(decryptVaultPayload(ciphertext, 'wrongKey_different123')).rejects.toThrow();
  });

  it('fails decryption if ciphertext is tampered with', async () => {
    const ciphertext = await encryptVaultPayload(samplePayload, sampleSyncKey);
    const parts = ciphertext.split(':');
    // Alter 1 character in the ciphertext
    const tamperedCipher = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a') + parts[2].slice(-1);
    const tampered = `v1:${parts[1]}:${tamperedCipher}`;

    await expect(decryptVaultPayload(tampered, sampleSyncKey)).rejects.toThrow();
  });

  it('wrapCloudVault encrypts inner records while preserving sync metadata', async () => {
    const doc = await wrapCloudVault(samplePayload, sampleSyncKey);
    expect(typeof doc.vault).toBe('string');
    expect(isVaultEnvelope(doc.vault)).toBe(true);
    expect(doc.lastSync).toBe(samplePayload.lastSync);
    // Sensitive records should NOT exist on the outer document
    expect((doc as any).tasks).toBeUndefined();
    expect((doc as any).courses).toBeUndefined();
    expect((doc as any).profile).toBeUndefined();
  });

  it('unwrapCloudVault decrypts encrypted vault document', async () => {
    const doc = await wrapCloudVault(samplePayload, sampleSyncKey);
    const unwrapped = await unwrapCloudVault(doc, sampleSyncKey);

    expect(unwrapped.tasks.length).toBe(1);
    expect(unwrapped.tasks[0].title).toBe('Lab Quiz 1');
    expect(unwrapped.profile.name).toBe('John Doe');
    expect(unwrapped.lastSync).toBe(samplePayload.lastSync);
  });

  it('unwrapCloudVault transparently handles legacy unencrypted cloud data', async () => {
    const legacyDoc = {
      tasks: samplePayload.tasks,
      courses: samplePayload.courses,
      profile: samplePayload.profile,
      lastSync: '2026-10-01T00:00:00.000Z'
    };

    const unwrapped = await unwrapCloudVault(legacyDoc, sampleSyncKey);
    expect(unwrapped).toEqual(legacyDoc);
  });
});
