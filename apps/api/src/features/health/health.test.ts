import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { API_PREFIX, createApp } from '../../app.js';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('reports that the API is up', async () => {
    const response = await request(app).get(`${API_PREFIX}/health`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body.database).toBeTypeOf('string');
    expect(Number.isFinite(Date.parse(response.body.timestamp))).toBe(true);
  });
});

describe('unknown routes', () => {
  it('returns the standard error envelope', async () => {
    const response = await request(app).get(`${API_PREFIX}/does-not-exist`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('does not exist');
  });
});
