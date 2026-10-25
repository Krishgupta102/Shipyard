/**
 * =============================================================================
 * BullMQ Job Queue (Producer)
 *
 * Enqueues asynchronous build and deployment jobs to Redis for the Worker.
 *
 * Key Design Principles (ADR-005 & ADR-006):
 * - Deterministic Job ID: `jobId: 'deploy:' + deploymentId`
 *   BullMQ will automatically reject duplicate jobs with the same ID, preventing
 *   race conditions if webhooks or user clicks trigger duplicate events.
 * - Exponential backoff retry configured on transient network/IO errors.
 * =============================================================================
 */

import { Queue } from 'bullmq';
import { DeployJobData } from '@shipyard/shared';
import { redis } from './redis.js';

export const DEPLOYMENT_QUEUE_NAME = 'deployments';

export const deploymentQueue = new Queue<DeployJobData>(DEPLOYMENT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

/**
 * Enqueues a deployment job with a deterministic idempotency key.
 */
export async function enqueueDeploymentJob(jobData: DeployJobData): Promise<string> {
  const job = await deploymentQueue.add('build-and-deploy', jobData, {
    jobId: `deploy-${jobData.deploymentId}`,
  });
  return job.id!;
}
