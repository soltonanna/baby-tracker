import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { API_PREFIX, createApp } from '../../app.js';
import { User } from '../../models/User.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../lib/cookies.js';
import { resetAuthRateLimits } from '../../middleware/rateLimit.js';
import { signAccessToken } from '../../lib/accessToken.js';

const app = createApp();
const url = (path: string): string => `${API_PREFIX}/auth${path}`;

const REGISTRATION = {
  email: 'Anahit@Example.com',
  password: 'a-perfectly-ordinary-passphrase',
  displayName: 'Anahit',
};
const CREDENTIALS = { email: REGISTRATION.email, password: REGISTRATION.password };

type SupertestResponse = Awaited<ReturnType<ReturnType<typeof request>['post']>>;

function setCookieHeaders(response: SupertestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

function refreshCookieHeader(response: SupertestResponse): string {
  const cookie = setCookieHeaders(response).find((value) =>
    value.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
  if (!cookie) throw new Error('Response carried no refresh cookie');
  return cookie;
}

/** The `name=value` pair, ready to send back as a Cookie header. */
function refreshCookieValue(response: SupertestResponse): string {
  return refreshCookieHeader(response).split(';')[0] ?? '';
}

const rawTokenOf = (cookiePair: string): string => cookiePair.split('=').slice(1).join('=');

async function registerFresh(): Promise<SupertestResponse> {
  return request(app).post(url('/register')).send(REGISTRATION);
}

beforeEach(() => {
  // Otherwise one test's failed logins would trip the limiter for the next.
  resetAuthRateLimits();
});

describe('POST /auth/register', () => {
  it('creates the account, signs the user in and sets the refresh cookie', async () => {
    const response = await registerFresh();

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'anahit@example.com',
      displayName: 'Anahit',
      locale: 'ru',
      timezone: 'Asia/Yerevan',
      units: { weight: 'kg', length: 'cm', volume: 'ml' },
    });
    expect(response.body.user.id).toMatch(/^[0-9a-f]{24}$/);
    expect(response.body.accessToken).toBeTypeOf('string');
    expect(response.body.expiresIn).toBe(900);
  });

  it('stores the email lowercased, so case cannot create a second account', async () => {
    await registerFresh();

    const stored = await User.findOne({ email: 'anahit@example.com' });
    expect(stored).not.toBeNull();

    const duplicate = await request(app)
      .post(url('/register'))
      .send({ ...REGISTRATION, email: 'ANAHIT@EXAMPLE.COM' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');
    expect(await User.countDocuments()).toBe(1);
  });

  it('rejects an invalid body with details', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: 'not-an-email', password: 'short', displayName: '' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('the refresh cookie', () => {
  it('is httpOnly, scoped to the auth path, and not readable by JavaScript', async () => {
    const cookie = refreshCookieHeader(await registerFresh());

    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(new RegExp(`Path=${REFRESH_COOKIE_PATH}`, 'i'));
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=\d+/i);
    // COOKIE_SECURE follows NODE_ENV; production is asserted by config, not here.
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('carries a token that is stored only as a hash', async () => {
    const raw = rawTokenOf(refreshCookieValue(await registerFresh()));

    const stored = await RefreshToken.findOne({});
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    // The raw value must appear nowhere in the database.
    expect(await RefreshToken.countDocuments({ tokenHash: raw })).toBe(0);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerFresh();
  });

  it('signs an existing user in and records the login', async () => {
    const response = await request(app).post(url('/login')).send(CREDENTIALS);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('anahit@example.com');
    expect(refreshCookieHeader(response)).toBeTruthy();

    const stored = await User.findOne({ email: 'anahit@example.com' });
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('gives a wrong password and an unknown email byte-identical responses', async () => {
    const wrongPassword = await request(app)
      .post(url('/login'))
      .send({ ...CREDENTIALS, password: 'definitely-not-the-password' });

    const unknownEmail = await request(app)
      .post(url('/login'))
      .send({ email: 'nobody@example.com', password: CREDENTIALS.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    // Byte-identical, not merely similar.
    expect(JSON.stringify(unknownEmail.body)).toBe(JSON.stringify(wrongPassword.body));
    expect(setCookieHeaders(unknownEmail)).toEqual([]);
  });

  it('locks out after repeated failures', async () => {
    const attempt = (): Promise<SupertestResponse> =>
      request(app)
        .post(url('/login'))
        .send({ ...CREDENTIALS, password: 'wrong-password-here' });

    let last: SupertestResponse | undefined;
    for (let i = 0; i < 11; i += 1) {
      last = await attempt();
    }

    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: a new access token and a different refresh cookie', async () => {
    const registered = await registerFresh();
    const firstCookie = refreshCookieValue(registered);

    const refreshed = await request(app).post(url('/refresh')).set('Cookie', firstCookie);

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf('string');
    expect(refreshed.body.expiresIn).toBe(900);
    expect(refreshCookieValue(refreshed)).not.toBe(firstCookie);

    // The rotated token is dead, the new one works.
    const reused = await request(app).post(url('/refresh')).set('Cookie', firstCookie);
    expect(reused.status).toBe(401);
  });

  it('revokes the whole login when a rotated token is presented again', async () => {
    const registered = await registerFresh();
    const firstCookie = refreshCookieValue(registered);

    const refreshed = await request(app).post(url('/refresh')).set('Cookie', firstCookie);
    const secondCookie = refreshCookieValue(refreshed);

    // The stolen, already-rotated token is replayed.
    const replay = await request(app).post(url('/refresh')).set('Cookie', firstCookie);
    expect(replay.status).toBe(401);

    // …which must also kill the newest token of that session.
    const afterReuse = await request(app).post(url('/refresh')).set('Cookie', secondCookie);
    expect(afterReuse.status).toBe(401);

    const live = await RefreshToken.countDocuments({ revokedAt: null });
    expect(live).toBe(0);
    expect(await RefreshToken.countDocuments({ revokedReason: 'reuse_detected' })).toBeGreaterThan(
      0,
    );
  });

  it('rejects a missing cookie, a garbage token, and an access token', async () => {
    const registered = await registerFresh();
    const accessToken = registered.body.accessToken as string;

    const missing = await request(app).post(url('/refresh'));
    expect(missing.status).toBe(401);

    const garbage = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=not-a-real-token`);
    expect(garbage.status).toBe(401);

    // Credential boundary: an access token is not a refresh credential.
    const asRefresh = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${accessToken}`);
    expect(asRefresh.status).toBe(401);

    const signed = await signAccessToken('66f0a1b2c3d4e5f607182930');
    const signedAsRefresh = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${signed}`);
    expect(signedAsRefresh.status).toBe(401);
  });

  it('clears the cookie when refreshing fails', async () => {
    const response = await request(app)
      .post(url('/refresh'))
      .set('Cookie', `${REFRESH_COOKIE_NAME}=not-a-real-token`);

    expect(refreshCookieHeader(response)).toMatch(/refresh_token=;|Expires=Thu, 01 Jan 1970/i);
  });
});

describe('POST /auth/logout', () => {
  it('revokes server-side, clears the cookie, and is idempotent', async () => {
    const registered = await registerFresh();
    const cookie = refreshCookieValue(registered);

    const first = await request(app).post(url('/logout')).set('Cookie', cookie);
    expect(first.status).toBe(204);
    expect(refreshCookieHeader(first)).toMatch(/refresh_token=;|Expires=Thu, 01 Jan 1970/i);

    // The token is dead on the server, not merely forgotten by the browser.
    const afterLogout = await request(app).post(url('/refresh')).set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);

    const second = await request(app).post(url('/logout')).set('Cookie', cookie);
    expect(second.status).toBe(204);

    const withoutCookie = await request(app).post(url('/logout'));
    expect(withoutCookie.status).toBe(204);
  });

  it('leaves other sessions of the same user alone', async () => {
    await registerFresh();

    const phone = await request(app).post(url('/login')).send(CREDENTIALS);
    const laptop = await request(app).post(url('/login')).send(CREDENTIALS);

    await request(app).post(url('/logout')).set('Cookie', refreshCookieValue(phone));

    const phoneRefresh = await request(app)
      .post(url('/refresh'))
      .set('Cookie', refreshCookieValue(phone));
    expect(phoneRefresh.status).toBe(401);

    const laptopRefresh = await request(app)
      .post(url('/refresh'))
      .set('Cookie', refreshCookieValue(laptop));
    expect(laptopRefresh.status).toBe(200);
  });
});

describe('password hash exposure', () => {
  it('never appears in any auth response body', async () => {
    const registered = await registerFresh();
    const loggedIn = await request(app).post(url('/login')).send(CREDENTIALS);
    const refreshed = await request(app)
      .post(url('/refresh'))
      .set('Cookie', refreshCookieValue(loggedIn));

    for (const response of [registered, loggedIn, refreshed]) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('scrypt$');
      expect(body).not.toContain(REGISTRATION.password);
    }
  });
});
