import { describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { runStartupReconciliation } from '../reconciler.js';
import { DeploymentStatus, DeploymentTrigger, Slot } from '@shipyard/shared';

describe('Worker Startup Reconciliation Sweep (ADR-005)', () => {
  it('detects and marks orphaned deployments as FAILED with worker_crash_recovery', async () => {
    // 1. Create a dummy project
    const project = await prisma.project.create({
      data: {
        name: 'Reconciler Test',
        slug: `reconcile-${Date.now()}`,
        repoUrl: 'https://github.com/shipyard-demo/reconcile-test',
        user: {
          connectOrCreate: {
            where: { githubId: 'reconciler-user' },
            create: {
              githubId: 'reconciler-user',
              githubUsername: 'reconciler-tester',
            },
          },
        },
      },
    });

    // 2. Create an orphaned deployment stuck in BUILDING with updatedAt 15 minutes ago
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const stuckDeployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: DeploymentStatus.BUILDING,
        trigger: DeploymentTrigger.MANUAL,
        targetSlot: Slot.BLUE,
        commitSha: 'deadbeef1234',
        gitRef: 'refs/heads/main',
        createdAt: fifteenMinutesAgo,
        updatedAt: fifteenMinutesAgo,
      },
    });

    // 3. Run reconciliation sweep
    await runStartupReconciliation();

    // 4. Verify deployment was resolved to FAILED
    const resolved = await prisma.deployment.findUnique({
      where: { id: stuckDeployment.id },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe(DeploymentStatus.FAILED);
    expect(resolved?.failureReason).toContain('worker_crash_recovery');
    expect(resolved?.finishedAt).not.toBeNull();

    // Cleanup
    await prisma.deployment.delete({ where: { id: stuckDeployment.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });

  it('does NOT mark a deployment FAILED if its BullMQ job is still active or waiting in queue', async () => {
    const { Queue } = await import('bullmq');
    const { redis } = await import('../redis.js');
    const queue = new Queue('deployments', { connection: redis });

    const project = await prisma.project.create({
      data: {
        name: 'Active Job Test',
        slug: `active-job-${Date.now()}`,
        repoUrl: 'https://github.com/shipyard-demo/active-job',
        user: {
          connectOrCreate: {
            where: { githubId: 'active-job-user' },
            create: { githubId: 'active-job-user', githubUsername: 'active-job-dev' },
          },
        },
      },
    });

    const activeDeployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: DeploymentStatus.BUILDING,
        trigger: DeploymentTrigger.MANUAL,
        targetSlot: Slot.BLUE,
        commitSha: 'commit123',
        gitRef: 'refs/heads/main',
        startedAt: new Date(Date.now() - 12 * 60 * 1000), // 12 mins ago
      },
    });

    // Enqueue a real BullMQ job for this deployment
    const job = await queue.add(
      'build-and-deploy',
      {
        deploymentId: activeDeployment.id,
        projectId: project.id,
        targetSlot: Slot.BLUE,
        trigger: DeploymentTrigger.MANUAL,
        commitSha: 'commit123',
        gitRef: 'refs/heads/main',
      },
      { jobId: `deploy-${activeDeployment.id}` }
    );

    try {
      // Run reconciliation sweep
      await runStartupReconciliation();

      // Verify the deployment is STILL in BUILDING state (not failed!)
      const rechecked = await prisma.deployment.findUnique({
        where: { id: activeDeployment.id },
      });
      expect(rechecked?.status).toBe(DeploymentStatus.BUILDING);
    } finally {
      await job.remove().catch(() => {});
      await queue.close();
      await prisma.deployment.delete({ where: { id: activeDeployment.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
