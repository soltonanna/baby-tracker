import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's standard library (decision D17).
 *
 * OWASP names Argon2id its first choice and lists scrypt as an acceptable
 * alternative where Argon2id is unavailable, with N=2^16, r=8, p=2 rated equal
 * in security to N=2^17, r=8, p=1. Node ships scrypt, so this costs no
 * dependency and no native build step.
 *
 * The parameters are stored inside the hash string, so the cost can be raised
 * later and existing hashes upgraded on next login instead of being stranded.
 *
 *   scrypt$<N>$<r>$<p>$<base64 salt>$<base64 derived key>
 */
export const SCRYPT_PARAMETERS = {
  N: 65_536, // 2^16 — about 64 MiB
  r: 8,
  p: 2,
} as const;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

/** Node refuses when roughly 128 * N * r exceeds maxmem, whose default is 32 MiB. */
const maxmemFor = (n: number, r: number): number => 256 * n * r;

export interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  derivedKey: Buffer;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMETERS;
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });

  return [PREFIX, N, r, p, salt.toString('base64'), derivedKey.toString('base64')].join('$');
}

/** Throws on anything that is not a well-formed hash string. */
export function parsePasswordHash(stored: string): ParsedPasswordHash {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    throw new Error('Malformed password hash');
  }

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new Error('Malformed password hash');
  }

  return {
    N,
    r,
    p,
    salt: Buffer.from(rawSalt, 'base64'),
    derivedKey: Buffer.from(rawKey, 'base64'),
  };
}

/**
 * Constant-time verification. A malformed stored hash returns false rather than
 * throwing, so a single corrupt row cannot turn a login into a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let parsed: ParsedPasswordHash;
  try {
    parsed = parsePasswordHash(stored);
  } catch {
    return false;
  }

  const candidate = await scryptAsync(password, parsed.salt, parsed.derivedKey.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmemFor(parsed.N, parsed.r),
  });

  if (candidate.length !== parsed.derivedKey.length) {
    return false;
  }
  return timingSafeEqual(candidate, parsed.derivedKey);
}

/** True when a stored hash was written with weaker parameters than we use now. */
export function needsRehash(stored: string): boolean {
  try {
    const { N, r, p } = parsePasswordHash(stored);
    return N < SCRYPT_PARAMETERS.N || r < SCRYPT_PARAMETERS.r || p < SCRYPT_PARAMETERS.p;
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a real verification against a throwaway hash and always fails.
 *
 * Login calls this when the email is unknown, so that the response takes the
 * same time as a genuine wrong-password attempt and cannot be used to discover
 * which addresses have accounts.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}
