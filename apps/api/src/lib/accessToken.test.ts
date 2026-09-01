import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { signAccessToken, verifyAccessToken } from './accessToken.js';
import { HttpError } from './httpError.js';

const USER_ID = '66f0a1b2c3d4e5f607182930';
const secretFor = (value: string): Uint8Array => new TextEncoder().encode(value);
const REAL_SECRET = secretFor(process.env.JWT_SECRET ?? '');

async function expectRejection(token: string, code: string): Promise<void> {
  await expect(verifyAccessToken(token)).rejects.toSatisfy(
    (error: unknown) => error instanceof HttpError && error.code === code && error.status === 401,
  );
}

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips the user id', async () => {
    const token = await signAccessToken(USER_ID);
    await expect(verifyAccessToken(token)).resolves.toEqual({ userId: USER_ID });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secretFor('a-completely-different-secret-of-32-chars'));

    await expectRejection(token, 'UNAUTHORIZED');
  });

  it('reports an expired token distinctly, so the client knows to refresh', async () => {
    const token = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(REAL_SECRET);

    await expectRejection(token, 'TOKEN_EXPIRED');
  });

  it('rejects a correctly signed token that is not an access token', async () => {
    const token = await new SignJWT({ tokenType: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(REAL_SECRET);

    await expectRejection(token, 'UNAUTHORIZED');
  });

  it('rejects a token whose subject is not an object id', async () => {
    const token = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-an-object-id')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(REAL_SECRET);

    await expectRejection(token, 'UNAUTHORIZED');
  });

  it('rejects a tampered payload and outright garbage', async () => {
    const token = await signAccessToken(USER_ID);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: '66f0a1b2c3d4e5f607182999', tokenType: 'access' }),
    ).toString('base64url');

    await expectRejection(`${header}.${forgedPayload}.${signature}`, 'UNAUTHORIZED');
    await expectRejection('not.a.token', 'UNAUTHORIZED');
    await expectRejection('', 'UNAUTHORIZED');
  });
});
