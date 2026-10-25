/**
 * =============================================================================
 * Deployments Route Handler
 *
 * Manages deployment lifecycles, manual triggers, rollbacks, and real-time SSE logs.
 * Follows ADR-002, ADR-005, and ADR-006 for state separation, idempotency, and queues.
 * =============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db.js';
import { createRedisSubscriber } from '../redis.js';
import { enqueueDeploymentJob } from '../queue.js';
import {
  assertCanTransition,
  DeploymentStatus,
  DeploymentTrigger,
  getNextSlot,
  isTerminalStatus,
  rollbackRequestSchema,
  triggerDeploymentSchema,
} from '@shipyard/shared';
import {
  deploymentsEnqueuedTotal,
  deploymentsCompletedTotal,
  sseConnectionsActive,
} from '../metrics.js';

export const deploymentsRouter = Router();

/**
 * POST /api/projects/:projectId/deploy
 * Manually trigger a deployment pipeline for a project.
 */
deploymentsRouter.post(
  '/projects/:projectId/deploy',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const body = triggerDeploymentSchema.parse(req.body);

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const targetSlot = getNextSlot(project.activeSlot);
      const gitRef = body.branch ? `refs/heads/${body.branch}` : `refs/heads/${project.defaultBranch}`;
      const commitSha = body.commitSha || 'HEAD';

      // Create deployment record in initial QUEUED state
      const deployment = await prisma.deployment.create({
        data: {
          projectId: project.id,
          status: DeploymentStatus.QUEUED,
          trigger: DeploymentTrigger.MANUAL,
          targetSlot,
          commitSha,
          gitRef,
        },
      });

      // Enqueue BullMQ job with deterministic idempotency key
      await enqueueDeploymentJob({
        deploymentId: deployment.id,
        projectId: project.id,
        targetSlot,
        trigger: DeploymentTrigger.MANUAL,
        commitSha,
        gitRef,
      });

      // Track enqueue for Prometheus
      deploymentsEnqueuedTotal.labels(DeploymentTrigger.MANUAL).inc();

      res.status(201).json({ deployment });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/projects/:projectId/deployments
 * List deployments for a specific project.
 */
deploymentsRouter.get(
  '/projects/:projectId/deployments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const [deployments, total] = await Promise.all([
        prisma.deployment.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.deployment.count({ where: { projectId } }),
      ]);

      res.json({
        deployments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/deployments/:id
 * Retrieve details for a single deployment.
 */
deploymentsRouter.get(
  '/deployments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const deployment = await prisma.deployment.findUnique({
        where: { id },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              slug: true,
              activeDeploymentId: true,
              activeSlot: true,
            },
          },
        },
      });

      if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }

      res.json({ deployment });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/deployments/:id/cancel
 * Cancel an active or queued deployment.
 */
deploymentsRouter.post(
  '/deployments/:id/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const deployment = await prisma.deployment.findUnique({
        where: { id },
      });

      if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }

      // Enforce centralized state machine: only QUEUED or BUILDING may be CANCELLED
      assertCanTransition(deployment.status as DeploymentStatus, DeploymentStatus.CANCELLED);

      const updated = await prisma.deployment.update({
        where: { id },
        data: {
          status: DeploymentStatus.CANCELLED,
          finishedAt: new Date(),
          failureReason: 'Deployment cancelled by user request.',
        },
      });

      // Track cancellation for Prometheus
      deploymentsCompletedTotal.labels(updated.projectId).inc();

      res.json({ deployment: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/projects/:projectId/rollback
 * Roll back to a previous successful deployment.
 *
 * ADR-002 Design Rule:
 * Rollback does NOT mutate the status of the target deployment.
 * Instead, it creates a NEW deployment record referencing the verified immutable image tag.
 * Project.activeDeploymentId is only updated after the rollback deployment passes health checks.
 */
deploymentsRouter.post(
  '/projects/:projectId/rollback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const { targetDeploymentId } = rollbackRequestSchema.parse(req.body);

      const [project, targetDeployment] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId } }),
        prisma.deployment.findUnique({ where: { id: targetDeploymentId } }),
      ]);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (!targetDeployment || targetDeployment.projectId !== projectId) {
        res.status(404).json({ error: 'Target rollback deployment not found for this project.' });
        return;
      }

      if (targetDeployment.status !== DeploymentStatus.SUCCESS) {
        res.status(400).json({
          error: 'Invalid rollback target',
          message: 'Can only roll back to a previously successful deployment.',
        });
        return;
      }

      if (!targetDeployment.imageTag) {
        res.status(400).json({
          error: 'Missing image tag',
          message: 'Target deployment does not have an immutable Docker image tag recorded.',
        });
        return;
      }

      const targetSlot = getNextSlot(project.activeSlot);

      // Create new deployment record representing the rollback execution
      const rollbackDeployment = await prisma.deployment.create({
        data: {
          projectId: project.id,
          status: DeploymentStatus.QUEUED,
          trigger: DeploymentTrigger.ROLLBACK,
          targetSlot,
          commitSha: targetDeployment.commitSha,
          commitMessage: `Rollback to deployment ${targetDeployment.id.slice(0, 8)}`,
          gitRef: targetDeployment.gitRef,
          imageTag: targetDeployment.imageTag,
          rollbackFromDeploymentId: targetDeployment.id,
        },
      });

      // Enqueue BullMQ job
      await enqueueDeploymentJob({
        deploymentId: rollbackDeployment.id,
        projectId: project.id,
        targetSlot,
        trigger: DeploymentTrigger.ROLLBACK,
        commitSha: targetDeployment.commitSha,
        gitRef: targetDeployment.gitRef,
        rollbackFromDeploymentId: targetDeployment.id,
      });

      // Track rollback enqueue for Prometheus
      deploymentsEnqueuedTotal.labels(DeploymentTrigger.ROLLBACK).inc();

      res.status(201).json({ deployment: rollbackDeployment });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/deployments/:id/logs and /api/deployments/:id/logs/stream
 * Server-Sent Events (SSE) endpoint for real-time log streaming.
 * Replays past logs from PostgreSQL, then subscribes to Redis Pub/Sub for live logs.
 */
deploymentsRouter.get(
  ['/deployments/:id/logs', '/deployments/:id/logs/stream'],
  async (req: Request, res: Response, next: NextFunction) => {
    let cleanup: (() => void) | null = null;
    try {
      const { id } = req.params;
      const deployment = await prisma.deployment.findUnique({
        where: { id },
      });

      if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }

      // Establish SSE HTTP connection
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (Nginx/Traefik)
      res.flushHeaders();

      // Track active SSE connections
      sseConnectionsActive.inc();

      let isCleanedUp = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let subscriber: ReturnType<typeof createRedisSubscriber> | null = null;
      const channel = `deployment:logs:${id}`;

      cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (subscriber) {
          subscriber.unsubscribe(channel).catch(() => {});
          subscriber.quit().catch(() => {});
          subscriber = null;
        }
        sseConnectionsActive.dec();
      };

      req.on('close', cleanup);
      res.on('finish', cleanup);

      // Initial state sync
      res.write(`event: state\ndata: ${JSON.stringify({ status: deployment.status, targetSlot: deployment.targetSlot })}\n\n`);

      // 1. Fetch and stream historical logs from Postgres
      const existingLogs = await prisma.logLine.findMany({
        where: { deploymentId: id },
        orderBy: { timestamp: 'asc' },
      });

      for (const log of existingLogs) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }

      // 2. If deployment is already terminal, end the stream immediately
      if (isTerminalStatus(deployment.status as DeploymentStatus)) {
        res.write('event: end\ndata: {"message": "Stream complete"}\n\n');
        cleanup();
        res.end();
        return;
      }

      // 3. Keepalive heartbeat every 15s to prevent intermediary proxy / client timeouts
      heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15000);

      // 4. Subscribe to live logs on Redis Pub/Sub
      subscriber = createRedisSubscriber();
      await subscriber.subscribe(channel);

      subscriber.on('message', (_chan, message) => {
        try {
          const parsed = JSON.parse(message);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);

          // If the message signals deployment termination, close the stream
          if (parsed.isTerminal) {
            res.write('event: end\ndata: {"message": "Deployment completed"}\n\n');
            cleanup?.();
            res.end();
          }
        } catch {
          res.write(`data: ${message}\n\n`);
        }
      });
    } catch (err) {
      if (typeof cleanup === 'function') {
        cleanup();
      }
      next(err);
    }
  }
);
