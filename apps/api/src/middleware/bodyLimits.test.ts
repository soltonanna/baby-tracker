import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { API_PREFIX, createApp } from '../app.js';

/**
 * The app-wide 1 MB body limit, and the one route exempt from it. No database:
 * every request here is refused before a handler would read one.
 */
const app = createApp();
const familyId = '64b000000000000000000001';
const twoMegabytes = JSON.stringify({ pad: 'x'.repeat(2_000_000) });

describe('request body limits', () => {
  it('answers 413, not 500, for an ordinary request over 1 MB', async () => {
    const response = await request(app)
      .post(`${API_PREFIX}/families`)
      .set('Content-Type', 'application/json')
      .send(twoMegabytes);

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('does not parse a large import body before the caller is authenticated', async () => {
    const response = await request(app)
      .post(`${API_PREFIX}/families/${familyId}/data/import`)
      .set('Content-Type', 'application/json')
      .send(twoMegabytes);

    // Reached authentication, so the app-wide parser let it through unread.
    expect(response.status).toBe(401);
  });
});
