import { describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { prisma } from '../db.js';
import { deploymentQueue } from '../queue.js';
import { DeploymentStatus, DeploymentTrigger, LogStream } from '@shipyard/shared';
import { redis } from '../redis.js';

describe('Deployments & Rollback API Endpoints', () => {
  afterAll(async () => {
    // Clean up queue jobs
    await deploymentQueue.drain();
  });

  it('POST /api/projects/:projectId/deploy triggers a build and creates BullMQ job', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
    });
    expect(project).not.toBeNull();

    const res = await request(app)
      .post(`/api/projects/${project!.id}/deploy`)
      .send({ branch: 'feature/test', commitSha: 'abcdef1234567890' });

    expect(res.status).toBe(201);
    expect(res.body.deployment).toBeDefined();
    expect(res.body.deployment.status).toBe(DeploymentStatus.QUEUED);
    expect(res.body.deployment.trigger).toBe(DeploymentTrigger.MANUAL);

    const deploymentId = res.body.deployment.id;

    // Verify BullMQ has the deterministic job id
    const expectedJobId = `deploy-${deploymentId}`;
    const job = await deploymentQueue.getJob(expectedJobId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(expectedJobId);
    expect(job?.data.deploymentId).toBe(deploymentId);
  });

  it('POST /api/deployments/:id/cancel cancels a QUEUED deployment', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
    });

    // Create a queued deployment
    const createRes = await request(app)
      .post(`/api/projects/${project!.id}/deploy`)
      .send({});
    const deploymentId = createRes.body.deployment.id;

    // Cancel it
    const cancelRes = await request(app).post(`/api/deployments/${deploymentId}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.deployment.status).toBe(DeploymentStatus.CANCELLED);

    // Trying to cancel again should fail with 409 (terminal state violation)
    const secondCancelRes = await request(app).post(`/api/deployments/${deploymentId}/cancel`);
    expect(secondCancelRes.status).toBe(409);
    expect(secondCancelRes.body.error).toBe('Illegal state transition');
  });

  it('POST /api/projects/:projectId/rollback creates a new deployment referencing the target image', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
      include: {
        deployments: {
          where: { status: DeploymentStatus.SUCCESS },
          take: 1,
        },
      },
    });

    const targetDeployment = project!.deployments[0]!;
    expect(targetDeployment).toBeDefined();

    const res = await request(app)
      .post(`/api/projects/${project!.id}/rollback`)
      .send({ targetDeploymentId: targetDeployment.id });

    expect(res.status).toBe(201);
    expect(res.body.deployment.trigger).toBe(DeploymentTrigger.ROLLBACK);
    expect(res.body.deployment.rollbackFromDeploymentId).toBe(targetDeployment.id);
    expect(res.body.deployment.imageTag).toBe(targetDeployment.imageTag);
    expect(res.body.deployment.status).toBe(DeploymentStatus.QUEUED);
  });

  it('POST /api/projects/:projectId/rollback rejects rollback to a FAILED deployment', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
      include: {
        deployments: {
          where: { status: DeploymentStatus.FAILED },
          take: 1,
        },
      },
    });

    const failedDeployment = project!.deployments[0]!;
    expect(failedDeployment).toBeDefined();

    const res = await request(app)
      .post(`/api/projects/${project!.id}/rollback`)
      .send({ targetDeploymentId: failedDeployment.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid rollback target');
  });

  it('GET /api/deployments/:id/logs/stream streams historical logs and sends end event for terminal deployment', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
    });

    // Create a finished deployment with seed log lines
    const dep = await prisma.deployment.create({
      data: {
        projectId: project!.id,
        status: DeploymentStatus.SUCCESS,
        trigger: DeploymentTrigger.MANUAL,
        targetSlot: 'BLUE',
        commitSha: 'c0ffee123456',
        gitRef: 'refs/heads/main',
      },
    });

    await prisma.logLine.createMany({
      data: [
        {
          deploymentId: dep.id,
          stream: LogStream.SYSTEM,
          message: 'Starting deployment pipeline...',
        },
        {
          deploymentId: dep.id,
          stream: LogStream.STDOUT,
          message: 'Building Docker image layer 1/3',
        },
      ],
    });

    const res = await request(app)
      .get(`/api/deployments/${dep.id}/logs/stream`)
      .set('Accept', 'text/event-stream');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: state');
    expect(res.text).toContain('Starting deployment pipeline...');
    expect(res.text).toContain('Building Docker image layer 1/3');
    expect(res.text).toContain('event: end');
  });

  it('GET /api/deployments/:id/logs returns 404 for non-existent deployment', async () => {
    const res = await request(app)
      .get('/api/deployments/non-existent-dep-id/logs')
      .set('Accept', 'text/event-stream');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deployment not found');
  });
});
