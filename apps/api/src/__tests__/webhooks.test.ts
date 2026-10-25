import { describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../app.js';
import { config } from '../config.js';

function computeSignature(payload: object, secret: string): string {
  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(json);
  return `sha256=${hmac.digest('hex')}`;
}

describe('GitHub Webhook Handler', () => {
  it('rejects webhooks with missing or invalid HMAC signature with 401', async () => {
    const payload = { ref: 'refs/heads/main' };

    const noSigRes = await request(app)
      .post('/api/webhooks/github')
      .send(payload);
    expect(noSigRes.status).toBe(401);
    expect(noSigRes.body.error).toBe('Invalid HMAC signature');

    const badSigRes = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', 'sha256=invalidhexsignature')
      .send(payload);
    expect(badSigRes.status).toBe(401);
  });

  it('accepts and responds to GitHub ping event with valid signature', async () => {
    const payload = { zen: 'Keep it logically awesome.' };
    const signature = computeSignature(payload, config.githubWebhookSecret);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'ping')
      .set('X-Hub-Signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('GitHub ping received');
  });

  it('queues a deployment when valid push to default branch is received', async () => {
    const payload = {
      ref: 'refs/heads/main',
      repository: {
        html_url: 'https://github.com/shipyard-demo/express-hello',
        clone_url: 'https://github.com/shipyard-demo/express-hello.git',
      },
      head_commit: {
        id: '1234567890abcdef1234567890abcdef12345678',
        message: 'feat: webhook automated build',
      },
    };
    const signature = computeSignature(payload, config.githubWebhookSecret);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'push')
      .set('X-Hub-Signature-256', signature)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Deployment queued from webhook');
    expect(res.body.deploymentId).toBeDefined();
    expect(res.body.projectSlug).toBe('express-hello');
  });

  it('skips build when push is to non-default branch', async () => {
    const payload = {
      ref: 'refs/heads/experimental',
      repository: {
        html_url: 'https://github.com/shipyard-demo/express-hello',
      },
      head_commit: {
        id: 'abcdef1234567890abcdef1234567890abcdef12',
        message: 'experiment',
      },
    };
    const signature = computeSignature(payload, config.githubWebhookSecret);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'push')
      .set('X-Hub-Signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Build skipped');
  });
});
