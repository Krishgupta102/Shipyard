/**
 * =============================================================================
 * Shipyard Worker — Prometheus Metrics Registry
 *
 * Exposes a dedicated prom-client registry with custom metrics for:
 *   - Deployment pipeline outcomes (SUCCESS / FAILED counters per trigger)
 *   - Docker build duration (histogram, per project)
 *   - Container health check duration (histogram)
 *   - Traefik route verification duration (histogram)
 *   - BullMQ deployment queue depth (gauge, refreshed periodically)
 *   - Active in-progress deployments (gauge)
 *   - Default Node.js process metrics (GC, heap, event-loop lag)
 *
 * A separate Registry (not the prom-client global default) is used to keep
 * the worker namespace isolated. The registry is served on a dedicated HTTP
 * server at port 3002 (GET /metrics), separate from the BullMQ worker loop.
 *
 * ADR-009: Prometheus Instrumentation Strategy
 * =============================================================================
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// ---------------------------------------------------------------------------
// Shared registry (isolated from prom-client global default)
// ---------------------------------------------------------------------------
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry, prefix: 'shipyard_worker_' });

// ---------------------------------------------------------------------------
// Deployment Pipeline Outcome Counters
// ---------------------------------------------------------------------------

/**
 * Total deployments that completed with SUCCESS status.
 * Labels: trigger (MANUAL | GITHUB_WEBHOOK | ROLLBACK)
 */
export const deploymentsSuccessTotal = new Counter({
  name: 'shipyard_deployments_success_total',
  help: 'Total number of deployments that completed successfully',
  labelNames: ['trigger'] as const,
  registers: [metricsRegistry],
});

/**
 * Total deployments that completed with FAILED status.
 * Labels: trigger, failure_stage (building | deploying | health_check | traefik | unknown)
 */
export const deploymentsFailedTotal = new Counter({
  name: 'shipyard_deployments_failed_total',
  help: 'Total number of deployments that failed',
  labelNames: ['trigger', 'failure_stage'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Build Pipeline Duration Histograms
// ---------------------------------------------------------------------------

/**
 * Docker image build duration in seconds.
 * Buckets are biased toward the typical build range (10s–300s).
 */
export const dockerBuildDurationSeconds = new Histogram({
  name: 'shipyard_docker_build_duration_seconds',
  help: 'Duration of Docker image builds in seconds',
  labelNames: ['project_id', 'result'] as const,
  buckets: [5, 10, 30, 60, 90, 120, 180, 240, 300, 420, 600],
  registers: [metricsRegistry],
});

/**
 * Git clone + checkout duration in seconds.
 */
export const gitCheckoutDurationSeconds = new Histogram({
  name: 'shipyard_git_checkout_duration_seconds',
  help: 'Duration of Git clone and checkout operations in seconds',
  labelNames: ['result'] as const,
  buckets: [1, 2, 5, 10, 20, 30, 60, 120],
  registers: [metricsRegistry],
});

/**
 * Container direct health check polling duration in seconds.
 * Measures time from container start to first successful /health 200.
 */
export const containerHealthCheckDurationSeconds = new Histogram({
  name: 'shipyard_container_healthcheck_duration_seconds',
  help: 'Time from container start to first successful direct health check',
  labelNames: ['result'] as const,
  buckets: [1, 2, 5, 10, 15, 20, 30, 60],
  registers: [metricsRegistry],
});

/**
 * Traefik route verification duration in seconds (control-plane + ingress).
 */
export const traefikVerificationDurationSeconds = new Histogram({
  name: 'shipyard_traefik_verification_duration_seconds',
  help: 'Duration of Traefik route verification (control-plane + ingress) in seconds',
  labelNames: ['stage', 'result'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15],
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// BullMQ Queue State Gauges
// ---------------------------------------------------------------------------

/**
 * Current number of jobs waiting in the deployment queue.
 * Refreshed by a periodic poller in metrics-server.ts.
 */
export const queueWaitingJobs = new Gauge({
  name: 'shipyard_queue_waiting_jobs',
  help: 'Number of deployment jobs currently waiting in the BullMQ queue',
  registers: [metricsRegistry],
});

/**
 * Current number of active (in-progress) deployment jobs.
 */
export const queueActiveJobs = new Gauge({
  name: 'shipyard_queue_active_jobs',
  help: 'Number of deployment jobs currently being processed',
  registers: [metricsRegistry],
});

/**
 * Current number of delayed (scheduled future) deployment jobs.
 */
export const queueDelayedJobs = new Gauge({
  name: 'shipyard_queue_delayed_jobs',
  help: 'Number of deployment jobs in a delayed/scheduled state',
  registers: [metricsRegistry],
});

/**
 * Current number of failed (not yet cleaned up) deployment jobs.
 */
export const queueFailedJobs = new Gauge({
  name: 'shipyard_queue_failed_jobs',
  help: 'Number of deployment jobs in failed state (not yet cleaned up)',
  registers: [metricsRegistry],
});
