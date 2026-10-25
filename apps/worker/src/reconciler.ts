/**
 * =============================================================================
 * Worker Startup Reconciliation Sweep (ADR-005 Layer 3)
 *
 * Runs once whenever the Worker boots.
 * Resiliently reconciles deployments stuck in transient states (BUILDING, DEPLOYING):
 * 1. Inspects BullMQ job state and active locks (never fails active or queued jobs).
 * 2. Checks build timeout watchdog.
 * 3. Inspects Docker containers and Traefik routing configuration:
 *    - If container is running, healthy, and Traefik is routing to it -> marks SUCCESS.
 *    - If container is dead/missing, lock expired, or timed out -> marks FAILED and cleans up.
 * =============================================================================
 */

import { Queue } from 'bullmq';
import { DeployJobData, DeploymentStatus } from '@shipyard/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db.js';
import { docker } from './docker.js';
import { redis } from './redis.js';
import { config } from './config.js';

const deploymentQueue = new Queue<DeployJobData>('deployments', {
  connection: redis,
});

export async function runStartupReconciliation(): Promise<void> {
  console.log('🔍 Running worker startup reconciliation sweep (ADR-005)...');

  // Find deployments stuck in transient lifecycle states
  const transientDeployments = await prisma.deployment.findMany({
    where: {
      status: {
        in: [DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING],
      },
    },
    include: {
      project: true,
    },
  });

  if (transientDeployments.length === 0) {
    console.log('✅ Reconciliation sweep complete: no transient deployments found.');
    return;
  }

  console.log(`🔍 Inspecting ${transientDeployments.length} deployment(s) in transient states...`);

  for (const dep of transientDeployments) {
    const jobId = `deploy-${dep.id}`;

    // 1. Check BullMQ Job State & Active Lock
    let jobState: string | null = null;
    let isJobLocked = false;

    try {
      const job = await deploymentQueue.getJob(jobId);
      if (job) {
        jobState = await job.getState();
        isJobLocked = Boolean(await (job as any).isLocked?.());
      }
    } catch (err) {
      console.warn(`Could not query BullMQ job state for ${jobId}:`, err);
    }

    // Rule: Do NOT fail deployments whose jobs are actively running under another worker's lock
    if (jobState === 'active' && isJobLocked) {
      console.log(`ℹ️  Skipping deployment ${dep.id}: BullMQ job is active with a live worker lock.`);
      continue;
    }

    // Rule: Do NOT fail deployments that are queued or delayed waiting for execution
    if (jobState === 'waiting' || jobState === 'delayed') {
      console.log(`ℹ️  Skipping deployment ${dep.id}: BullMQ job is ${jobState} in queue.`);
      continue;
    }

    // 2. Check Build Timeout
    const referenceTime = dep.startedAt || dep.updatedAt;
    const elapsedSeconds = (Date.now() - referenceTime.getTime()) / 1000;
    const hasTimedOut = elapsedSeconds > config.buildTimeoutSeconds;

    // 3. Inspect Docker Container Status
    const containerName = `shipyard-${dep.project.slug}-${dep.targetSlot.toLowerCase()}`;
    let isContainerRunning = false;
    let isContainerHealthy = false;

    try {
      const container = docker.getContainer(containerName);
      const inspect = await container.inspect();
      isContainerRunning = Boolean(inspect.State.Running);
      isContainerHealthy = inspect.State.Health ? inspect.State.Health.Status === 'healthy' : isContainerRunning;
    } catch {
      isContainerRunning = false;
      isContainerHealthy = false;
    }

    // 4. Inspect Traefik Routing Configuration
    let isTraefikRoutingToContainer = false;
    try {
      const dynamicConfigPath = path.join(config.traefikDynamicConfigDir, `${dep.projectId}.yml`);
      const fileContent = await fs.readFile(dynamicConfigPath, 'utf8');
      if (fileContent.includes(containerName)) {
        isTraefikRoutingToContainer = true;
      }
    } catch {
      isTraefikRoutingToContainer = false;
    }

    // Scenario A: Worker crashed AFTER routing cutover and container is healthy
    // -> Promote to SUCCESS and update Project active routing pointers!
    if (isContainerRunning && isContainerHealthy && isTraefikRoutingToContainer) {
      console.log(`✨ Recovered successful deployment ${dep.id}: container healthy and Traefik routing confirmed.`);

      await prisma.$transaction([
        prisma.deployment.update({
          where: { id: dep.id },
          data: {
            status: DeploymentStatus.SUCCESS,
            finishedAt: new Date(),
          },
        }),
        prisma.project.update({
          where: { id: dep.projectId },
          data: {
            activeDeploymentId: dep.id,
            activeSlot: dep.targetSlot,
          },
        }),
      ]);

      continue;
    }

    // Scenario B: Job failed, lock expired, or build timed out without a healthy live container
    // -> Mark FAILED with descriptive crash recovery audit log
    if (!isJobLocked || hasTimedOut || jobState === 'failed' || !jobState) {
      const reason = `worker_crash_recovery: Worker interrupted during ${dep.status}. Job state: ${
        jobState || 'none'
      }, Lock: ${isJobLocked ? 'active' : 'expired'}, Container: ${
        isContainerRunning ? 'running_unverified' : 'missing'
      }, Timed out: ${hasTimedOut}.`;

      // Clean up orphaned unverified container if it was left running
      if (isContainerRunning && !isTraefikRoutingToContainer) {
        try {
          const container = docker.getContainer(containerName);
          await container.stop({ t: 2 });
          await container.remove({ force: true });
          console.log(`Cleaned up orphaned container ${containerName}`);
        } catch {}
      }

      await prisma.deployment.update({
        where: { id: dep.id },
        data: {
          status: DeploymentStatus.FAILED,
          finishedAt: new Date(),
          failureReason: reason,
        },
      });

      console.log(`Resolved orphaned deployment ${dep.id} -> FAILED (${reason})`);
    }
  }
}
