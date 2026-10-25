/**
 * =============================================================================
 * Shipyard API — Prometheus Metrics Registry
 *
 * Exposes a dedicated prom-client registry with custom metrics for:
 *   - HTTP request latencies (histogram, per route, method, status)
 *   - Deployment lifecycle events (counter, per trigger and final status)
 *   - Webhook ingestion events (counter, per source and status)
 *   - Active SSE log-stream connections (gauge)
 *   - Default Node.js / process metrics (GC, heap, event-loop lag, etc.)
 *
 * A single Registry instance is used (not the prom-client global default) so
 * that the API metrics namespace is fully isolated from any library that may
 * accidentally register to the default registry.
 *
 * ADR-009: Prometheus Instrumentation Strategy
 * =============================================================================
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// ---------------------------------------------------------------------------
// Shared registry (isolated from prom-client global default)
// ---------------------------------------------------------------------------
export const metricsRegistry = new Registry();

// Attach default Node.js process metrics (heap, GC, event-loop lag, etc.)
collectDefaultMetrics({ register: metricsRegistry, prefix: 'shipyard_api_' });

// ---------------------------------------------------------------------------
// HTTP Request Instrumentation
// ---------------------------------------------------------------------------

/**
 * Total HTTP requests completed by the API.
 * Labels allow Grafana to break down traffic by method, route, and status code.
 */
export const httpRequestsTotal = new Counter({
  name: 'shipyard_api_http_requests_total',
  help: 'Total number of HTTP requests handled by the Shipyard API',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

/**
 * HTTP request duration histogram.
 * Buckets follow the Prometheus recommendation for web APIs (≤1s focus).
 */
export const httpRequestDurationSeconds = new Histogram({
  name: 'shipyard_api_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Deployment Pipeline Metrics
// ---------------------------------------------------------------------------

/**
 * Total deployment jobs enqueued, labeled by trigger source.
 * Incremented in the API when a job is added to BullMQ.
 */
export const deploymentsEnqueuedTotal = new Counter({
  name: 'shipyard_deployments_enqueued_total',
  help: 'Total number of deployments enqueued by trigger source',
  labelNames: ['trigger'] as const,
  registers: [metricsRegistry],
});

/**
 * Terminal deployment outcomes (SUCCESS, FAILED, CANCELLED).
 * Incremented from the API cancel endpoint and tracked here for reporting.
 * The worker will record SUCCESS/FAILED via its own registry and port (3002).
 */
export const deploymentsCompletedTotal = new Counter({
  name: 'shipyard_api_deployments_cancelled_total',
  help: 'Total number of deployments cancelled through the API',
  labelNames: ['project_id'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Webhook Metrics
// ---------------------------------------------------------------------------

/**
 * Total webhooks received, labeled by event type and whether validation passed.
 */
export const webhooksReceivedTotal = new Counter({
  name: 'shipyard_webhooks_received_total',
  help: 'Total number of GitHub webhook events received',
  labelNames: ['event', 'result'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// SSE Log Streaming Metrics
// ---------------------------------------------------------------------------

/**
 * Current number of active SSE log-stream connections.
 * This is a real-time gauge: incremented on connection, decremented on close.
 */
export const sseConnectionsActive = new Gauge({
  name: 'shipyard_api_sse_connections_active',
  help: 'Current number of active SSE log stream connections',
  registers: [metricsRegistry],
});
