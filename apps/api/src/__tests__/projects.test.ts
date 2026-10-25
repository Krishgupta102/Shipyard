import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { prisma } from '../db.js';

describe('Projects REST API Endpoints', () => {
  it('GET /api/projects returns list of projects including seeded project', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.projects)).toBe(true);

    const seeded = res.body.projects.find((p: any) => p.slug === 'express-hello');
    expect(seeded).toBeDefined();
    expect(seeded.name).toBe('Express Hello World');
  });

  it('GET /api/projects/:id finds project by slug and masks secret env vars', async () => {
    const res = await request(app).get('/api/projects/express-hello');
    expect(res.status).toBe(200);
    expect(res.body.project.slug).toBe('express-hello');
    expect(res.body.project.envVars).toBeDefined();

    const secretVar = res.body.project.envVars.find((ev: any) => ev.key === 'API_SECRET_KEY');
    expect(secretVar).toBeDefined();
    expect(secretVar.value).toBe('••••••••'); // Masked!
  });

  it('POST /api/projects creates a new project with validation', async () => {
    const slug = `test-app-${Date.now()}`;
    const payload = {
      name: 'Integration Test App',
      slug,
      repoUrl: 'https://github.com/shipyard-demo/test-app',
      port: 8080,
      healthCheckPath: '/status',
    };

    const res = await request(app).post('/api/projects').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.project.slug).toBe(slug);
    expect(res.body.project.port).toBe(8080);

    // Clean up
    await prisma.project.delete({ where: { id: res.body.project.id } });
  });

  it('POST /api/projects rejects invalid payloads with 400 and validation details', async () => {
    const res = await request(app).post('/api/projects').send({
      name: '',
      slug: 'INVALID SLUG WITH SPACES',
      repoUrl: 'not-a-url',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('DELETE /api/projects/:id successfully removes project', async () => {
    const slug = `to-delete-${Date.now()}`;
    const createRes = await request(app).post('/api/projects').send({
      name: 'To Delete',
      slug,
      repoUrl: 'https://github.com/shipyard-demo/to-delete',
    });

    const projectId = createRes.body.project.id;

    const delRes = await request(app).delete(`/api/projects/${projectId}`);
    expect(delRes.status).toBe(200);

    const getRes = await request(app).get(`/api/projects/${projectId}`);
    expect(getRes.status).toBe(404);
  });
});
