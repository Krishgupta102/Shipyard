import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('Health Check Endpoints', () => {
  it('GET /health returns 200 OK with postgres and redis status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.postgres).toBe('healthy');
    expect(res.body.services.redis).toBe('healthy');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('GET /api/health returns identical healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
