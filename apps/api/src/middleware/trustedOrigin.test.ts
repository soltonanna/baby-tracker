import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../lib/httpError.js';
import { createTrustedOriginGuard } from './trustedOrigin.js';

const ALLOWED = 'https://soltonanna.github.io';
const guard = createTrustedOriginGuard(ALLOWED);

function run(headers: Record<string, string>): unknown {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
  const next = vi.fn<NextFunction>();
  guard(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]?.[0];
}

function expectForbidden(result: unknown): void {
  expect(result).toBeInstanceOf(HttpError);
  expect((result as HttpError).status).toBe(403);
  expect((result as HttpError).code).toBe('FORBIDDEN_ORIGIN');
}

describe('trusted origin guard', () => {
  it('allows the web app origin', () => {
    expect(run({ Origin: ALLOWED })).toBeUndefined();
  });

  it('rejects any other origin', () => {
    expectForbidden(run({ Origin: 'https://evil.example' }));
  });

  it('compares the whole origin, not a prefix', () => {
    expectForbidden(run({ Origin: `${ALLOWED}.evil.example` }));
    expectForbidden(run({ Origin: 'http://soltonanna.github.io' }));
  });

  it('rejects the literal "null" origin of sandboxed frames', () => {
    expectForbidden(run({ Origin: 'null' }));
  });

  it('rejects a cross-site fetch that carries no Origin', () => {
    expectForbidden(run({ 'Sec-Fetch-Site': 'cross-site' }));
  });

  it('allows requests that are not from a browser page', () => {
    expect(run({})).toBeUndefined();
  });

  it('lets a matching Origin win over Sec-Fetch-Site', () => {
    expect(run({ Origin: ALLOWED, 'Sec-Fetch-Site': 'cross-site' })).toBeUndefined();
  });
});
