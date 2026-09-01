import { describe, expect, it } from 'vitest';
import {
  SCRYPT_PARAMETERS,
  hashPassword,
  needsRehash,
  parsePasswordHash,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password.js';

const PASSWORD = 'a-perfectly-ordinary-passphrase';

describe('hashPassword / verifyPassword', () => {
  it('verifies the password it hashed', async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword('not-the-password', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(first).not.toBe(second);
    await expect(verifyPassword(PASSWORD, first)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  it('never stores the password itself', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
  });
});

describe('hash format', () => {
  it('carries its own parameters so the cost can be raised later', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.startsWith('scrypt$')).toBe(true);

    const parsed = parsePasswordHash(stored);
    expect(parsed.N).toBe(SCRYPT_PARAMETERS.N);
    expect(parsed.r).toBe(SCRYPT_PARAMETERS.r);
    expect(parsed.p).toBe(SCRYPT_PARAMETERS.p);
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.derivedKey).toHaveLength(64);
  });

  it('rejects a malformed hash rather than throwing during login', async () => {
    expect(() => parsePasswordHash('not-a-hash')).toThrow(/Malformed/);
    expect(() => parsePasswordHash('scrypt$a$b$c$d$e')).toThrow(/Malformed/);
    await expect(verifyPassword(PASSWORD, 'not-a-hash')).resolves.toBe(false);
  });
});

describe('needsRehash', () => {
  it('is false for a hash written with the current parameters', async () => {
    expect(needsRehash(await hashPassword(PASSWORD))).toBe(false);
  });

  it('is true for weaker parameters and for anything unreadable', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$a2V5')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('verifyAgainstDummyHash', () => {
  it('always fails, but does the same work as a real verification', async () => {
    await expect(verifyAgainstDummyHash(PASSWORD)).resolves.toBe(false);
    await expect(verifyAgainstDummyHash('anything at all')).resolves.toBe(false);
  });
});
