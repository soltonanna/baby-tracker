import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { API_PREFIX, createApp } from '../app.js';
import { User } from '../models/User.js';
import { REFRESH_COOKIE_NAME } from '../lib/cookies.js';
import { resetAuthRateLimits } from './rateLimit.js';

const app = createApp();
const url = (path: string): string => `${API_PREFIX}/auth${path}`;

const REGISTRATION = {
  email: 'anahit@example.com',
  password: 'a-perfectly-ordinary-passphrase',
  displayName: 'Anahit',
};

interface Registered {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

async function register(): Promise<Registered> {
  const response = await request(app).post(url('/register')).send(REGISTRATION);
  expect(response.status).toBe(201);

  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [header ?? ''];
  const pair = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';

  return {
    accessToken: response.body.accessToken as string,
    refreshToken: pair.split(';')[0]?.split('=').slice(1).join('=') ?? '',
    userId: response.body.user.id as string,
  };
}

const bearer = (token: string) =>
  request(app).get(url('/me')).set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  resetAuthRateLimits();
});

describe('GET /auth/me', () => {
  it('returns the authenticated user', async () => {
    const { accessToken, userId } = await register();

    const response = await bearer(accessToken);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(userId);
    expect(response.body.user.email).toBe('anahit@example.com');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('scrypt$');
  });

  it('still works with the access token minted by a refresh', async () => {
    const { refreshToken } = await register();

    const refreshed = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`);
    expect(refreshed.status).toBe(200);

    const response = await bearer(refreshed.body.accessToken as string);
    expect(response.status).toBe(200);
  });

  it('rejects a request for a user that no longer exists', async () => {
    const { accessToken } = await register();
    await User.deleteMany({});

    const response = await bearer(accessToken);
    expect(response.status).toBe(401);
  });
});

describe('the authenticate middleware', () => {
  it('rejects a missing or malformed Authorization header', async () => {
    await register();

    const noHeader = await request(app).get(url('/me'));
    expect(noHeader.status).toBe(401);
    expect(noHeader.body.error.code).toBe('UNAUTHORIZED');

    for (const header of ['', 'Bearer', 'Bearer    ', 'Basic abc123', 'Token abc123']) {
      const response = await request(app).get(url('/me')).set('Authorization', header);
      expect(response.status, `header: "${header}"`).toBe(401);
    }
  });

  it('accepts the scheme case-insensitively, as the spec requires', async () => {
    const { accessToken } = await register();

    const response = await request(app)
      .get(url('/me'))
      .set('Authorization', `bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('rejects garbage and tokens signed with another secret', async () => {
    const foreign = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('66f0a1b2c3d4e5f607182930')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('a-completely-different-secret-of-32-chars'));

    expect((await bearer('not-a-token')).status).toBe(401);
    expect((await bearer('a.b.c')).status).toBe(401);
    expect((await bearer(foreign)).status).toBe(401);
  });

  it('reports an expired access token distinctly, so the client refreshes', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
    const nowSeconds = Math.floor(Date.now() / 1000);

    const expired = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('66f0a1b2c3d4e5f607182930')
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 60)
      .sign(secret);

    const response = await bearer(expired);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('credential boundaries', () => {
  /**
   * The mirror of the access-token-as-refresh-credential test in
   * features/auth/auth.int.test.ts. Each credential must work in exactly one
   * place, so that stealing one never yields the powers of the other.
   */
  it('rejects a refresh token presented as a Bearer access token', async () => {
    const { refreshToken } = await register();

    const response = await bearer(refreshToken);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('does not accept an access token supplied in the refresh cookie', async () => {
    const { accessToken } = await register();

    const response = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${accessToken}`);

    expect(response.status).toBe(401);
  });

  it('does not let a Bearer access token stand in for the refresh cookie', async () => {
    const { accessToken } = await register();

    const response = await request(app)
      .post(url('/refresh'))
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(401);
  });
});
