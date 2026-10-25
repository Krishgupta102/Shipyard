/**
 * =============================================================================
 * GitHub Webhook Handler
 *
 * Processes GitHub push events to trigger automatic deployments.
 * Validates HMAC-SHA256 signatures (`X-Hub-Signature-256`) using timing-safe comparison.
 * =============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { enqueueDeploymentJob } from '../queue.js';
import { DeploymentStatus, DeploymentTrigger, getNextSlot } from '@shipyard/shared';
import { webhooksReceivedTotal, deploymentsEnqueuedTotal } from '../metrics.js';

export const webhooksRouter = Router();

/**
 * Validates GitHub HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyGitHubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * POST /api/webhooks/github
 * Ingests webhook push events from GitHub.
 */
webhooksRouter.post(
  '/github',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const event = req.headers['x-github-event'] as string | undefined;
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body));

      // 1. Verify HMAC Signature
      const isValid = verifyGitHubSignature(rawBody, signature, config.githubWebhookSecret);
      if (!isValid) {
        webhooksReceivedTotal.labels(event ?? 'unknown', 'signature_invalid').inc();
        res.status(401).json({ error: 'Invalid HMAC signature' });
        return;
      }

      // Handle ping event from GitHub webhook setup
      if (event === 'ping') {
        webhooksReceivedTotal.labels('ping', 'accepted').inc();
        res.status(200).json({ message: 'GitHub ping received and verified successfully.' });
        return;
      }

      // We only trigger builds on 'push' events
      if (event !== 'push') {
        webhooksReceivedTotal.labels(event ?? 'unknown', 'ignored').inc();
        res.status(200).json({ message: `Ignored event: ${event}` });
        return;
      }

      const payload = req.body;
      const ref = payload.ref as string | undefined; // e.g. "refs/heads/main"
      const repositoryUrl = payload.repository?.html_url as string | undefined;
      const cloneUrl = payload.repository?.clone_url as string | undefined;
      const commitSha = payload.head_commit?.id || payload.after || 'HEAD';
      const commitMessage = payload.head_commit?.message || 'Push event from GitHub';

      if (!repositoryUrl || !ref) {
        res.status(400).json({ error: 'Missing repository URL or git ref in payload' });
        return;
      }

      // Normalize candidate URLs for matching
      const candidateUrls = [
        repositoryUrl,
        repositoryUrl.replace(/\/$/, ''),
        cloneUrl,
        cloneUrl?.replace(/\.git$/, ''),
      ].filter(Boolean) as string[];

      // 2. Find linked Project
      const project = await prisma.project.findFirst({
        where: {
          OR: candidateUrls.map((url) => ({
            repoUrl: { contains: url, mode: 'insensitive' },
          })),
        },
      });

      if (!project) {
        res.status(200).json({
          message: 'Webhook received, but no matching Shipyard project is linked to this repository.',
        });
        return;
      }

      // 3. Confirm push is to the default branch
      const expectedRef = `refs/heads/${project.defaultBranch}`;
      if (ref !== expectedRef) {
        res.status(200).json({
          message: `Push was to '${ref}', but project default branch is '${project.defaultBranch}'. Build skipped.`,
        });
        return;
      }

      // 4. Trigger blue-green deployment
      const targetSlot = getNextSlot(project.activeSlot);

      const deployment = await prisma.deployment.create({
        data: {
          projectId: project.id,
          status: DeploymentStatus.QUEUED,
          trigger: DeploymentTrigger.GITHUB_WEBHOOK,
          targetSlot,
          commitSha,
          commitMessage,
          gitRef: ref,
        },
      });

      // 5. Enqueue BullMQ job
      await enqueueDeploymentJob({
        deploymentId: deployment.id,
        projectId: project.id,
        targetSlot,
        trigger: DeploymentTrigger.GITHUB_WEBHOOK,
        commitSha,
        gitRef: ref,
      });

      // Track webhook-triggered enqueue for Prometheus
      webhooksReceivedTotal.labels('push', 'deployed').inc();
      deploymentsEnqueuedTotal.labels(DeploymentTrigger.GITHUB_WEBHOOK).inc();

      res.status(201).json({
        message: 'Deployment queued from webhook',
        deploymentId: deployment.id,
        projectSlug: project.slug,
        targetSlot,
      });
    } catch (err) {
      next(err);
    }
  }
);
