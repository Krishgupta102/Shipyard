/**
 * =============================================================================
 * Shipyard Worker — Prometheus Metrics HTTP Server
 *
 * Runs a lightweight HTTP server on WORKER_METRICS_PORT (default: 3002).
 * Prometheus scrapes GET /metrics from this server on the shipyard-infra network.
 *
 * Additionally, this module runs a periodic BullMQ queue-depth poller that
 * updates queue gauge metrics every QUEUE_POLL_INTERVAL_MS (default: 15s),
 * matching Prometheus' default scrape interval so gauges never go stale.
 *
 * Design: The metrics server is completely independent of the BullMQ Worker.
 * It starts before the worker consumer and is closed last in graceful shutdown.
 * =============================================================================
 */

import http from 'node:http';
import { Queue } from 'bullmq';
import { DeployJobData } from '@shipyard/shared';
import { redis } from './redis.js';
import {
  metricsRegistry,
  queueWaitingJobs,
  queueActiveJobs,
  queueDelayedJobs,
  queueFailedJobs,
} from './metrics.js';

const WORKER_METRICS_PORT = parseInt(process.env.WORKER_METRICS_PORT || '3002', 10);
const QUEUE_POLL_INTERVAL_MS = parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '15000', 10);
const DEPLOYMENT_QUEUE_NAME = 'deployments';

/**
 * Creates and returns the Prometheus metrics HTTP server.
 * Responds to GET /metrics with the text/plain Prometheus exposition format.
 * Responds to GET /health with a simple 200 OK for liveness probes.
 */
export function createMetricsServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      try {
        const metrics = await metricsRegistry.metrics();
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end('Failed to collect metrics');
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return server;
}

/**
 * Polls BullMQ queue counts and updates gauge metrics.
 * Runs on a fixed interval so Prometheus always has fresh data on each scrape.
 */
export function startQueuePoller(): NodeJS.Timeout {
  const queue = new Queue<DeployJobData>(DEPLOYMENT_QUEUE_NAME, {
    connection: redis,
  });

  const poll = async () => {
    try {
      const [waiting, active, delayed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getDelayedCount(),
        queue.getFailedCount(),
      ]);

      queueWaitingJobs.set(waiting);
      queueActiveJobs.set(active);
      queueDelayedJobs.set(delayed);
      queueFailedJobs.set(failed);
    } catch (err) {
      // Non-fatal: if Redis is temporarily unavailable, skip this poll cycle.
      console.warn('[MetricsServer] Queue poll failed (will retry):', (err as Error).message);
    }
  };

  // Run immediately on startup, then on interval
  poll().catch(() => {});
  return setInterval(poll, QUEUE_POLL_INTERVAL_MS);
}

/**
 * Starts the metrics HTTP server and queue depth poller.
 * Returns handles needed for graceful shutdown.
 */
export async function startMetricsServer(): Promise<{
  server: http.Server;
  pollerHandle: NodeJS.Timeout;
  close: () => Promise<void>;
}> {
  const server = createMetricsServer();
  const pollerHandle = startQueuePoller();

  await new Promise<void>((resolve, reject) => {
    server.listen(WORKER_METRICS_PORT, () => {
      console.log(`📊 Worker metrics server listening on :${WORKER_METRICS_PORT}/metrics`);
      resolve();
    });
    server.on('error', reject);
  });

  const close = () =>
    new Promise<void>((resolve, reject) => {
      clearInterval(pollerHandle);
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  return { server, pollerHandle, close };
}
