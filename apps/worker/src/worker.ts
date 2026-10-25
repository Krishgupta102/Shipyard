/**
 * =============================================================================
 * BullMQ Worker Instance Setup & Lifecycle
 *
 * Listens for deployment jobs, handles stall detection, and cleans up on shutdown.
 * =============================================================================
 */

import { Worker } from 'bullmq';
import { DeployJobData } from '@shipyard/shared';
import { redis } from './redis.js';
import { prisma } from './db.js';
import { config } from './config.js';
import { processDeploymentJob } from './processor.js';
import { runStartupReconciliation } from './reconciler.js';
import { startMetricsServer } from './metrics-server.js';

export const DEPLOYMENT_QUEUE_NAME = 'deployments';

export function createWorker(): Worker<DeployJobData> {
  const worker = new Worker<DeployJobData>(
    DEPLOYMENT_QUEUE_NAME,
    async (job) => {
      await processDeploymentJob(job);
    },
    {
      connection: redis,
      concurrency: config.concurrency,
      lockDuration: 30000, // 30s lock heartbeat (ADR-005 Layer 1)
      stalledInterval: 30000,
      maxStalledCount: 2,
    }
  );

  worker.on('active', (job) => {
    console.log(`[Worker] Started job ${job.id} for deployment ${job.data.deploymentId}`);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Finished job ${job.id} for deployment ${job.data.deploymentId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Redis/Queue error:', err);
  });

  return worker;
}

export async function startWorkerService(): Promise<void> {
  console.log(`\n======================================================`);
  console.log(`🔨 Shipyard Build Worker starting...`);
  console.log(`⚙️  Concurrency: ${config.concurrency}`);
  console.log(`🐳 Docker Socket: ${config.dockerSocketPath}`);
  console.log(`📁 Scratch Builds Dir: ${config.buildsDir}`);
  console.log(`======================================================\n`);

  // 1. Start Prometheus metrics server (before worker consumer)
  const metricsServer = await startMetricsServer();

  // 2. Run startup reconciliation sweep (ADR-005)
  await runStartupReconciliation();

  // 3. Start worker consumer
  const worker = createWorker();

  // 4. Graceful shutdown handler
  async function shutdown(signal: string) {
    console.log(`\n[Worker] Received ${signal}. Shutting down worker gracefully...`);
    try {
      await worker.close();
      await metricsServer.close();
      await redis.quit();
      await prisma.$disconnect();
      console.log('✅ Worker shut down cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during worker shutdown:', err);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
