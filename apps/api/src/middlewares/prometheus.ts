/**
 * =============================================================================
 * Prometheus HTTP Metrics Middleware
 *
 * Instruments every Express request with:
 *   - shipyard_api_http_requests_total (counter)
 *   - shipyard_api_http_request_duration_seconds (histogram)
 *
 * Route normalization:
 *   Express `req.route.path` is used when available (matched routes), giving
 *   `/api/projects/:projectId/deployments` instead of the full literal URL.
 *   Unmatched paths fall back to the literal pathname, capped at 100 chars.
 *   The /metrics and /health endpoints are excluded from instrumentation to
 *   avoid cardinality explosion from frequent scrapes and health checks.
 *
 * Design note: We attach a `startTime = process.hrtime.bigint()` to the
 * request object at the start of the pipeline and read it in the `res.on('finish')`
 * callback to produce an accurate, sub-millisecond duration without needing
 * a response-time library.
 * =============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../metrics.js';

/** Paths excluded from instrumentation (they generate very high-frequency, low-value data points). */
const EXCLUDED_PATHS = new Set(['/metrics', '/health', '/api/health', '/favicon.ico']);

/**
 * Normalises a request to a route label suitable for Prometheus cardinality.
 * Priority: matched Express route pattern > raw pathname (truncated).
 */
function normaliseRoute(req: Request): string {
  // Use the matched Express route pattern (e.g. /api/projects/:projectId/deployments)
  if (req.route?.path) {
    // Prefix with the router mount path if available
    const base = (req.baseUrl ?? '').replace(/\/$/, '');
    const route = typeof req.route.path === 'string' ? req.route.path : String(req.route.path);
    return `${base}${route}`;
  }
  // Fallback: raw path, truncated to avoid label explosion from IDs
  const raw = req.path ?? req.url ?? 'unknown';
  return raw.length > 100 ? raw.slice(0, 100) + '…' : raw;
}

declare module 'express' {
  interface Request {
    _metricsStartTime?: bigint;
  }
}

/**
 * Express middleware that records request duration and count.
 * Mount BEFORE routes in app.ts.
 */
export function prometheusMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path ?? req.url ?? '';

  // Skip excluded paths immediately
  if (EXCLUDED_PATHS.has(path)) {
    next();
    return;
  }

  // Record start time with nanosecond precision
  req._metricsStartTime = process.hrtime.bigint();

  res.on('finish', () => {
    const route = normaliseRoute(req);
    const method = req.method ?? 'UNKNOWN';
    const statusCode = String(res.statusCode);

    httpRequestsTotal.labels(method, route, statusCode).inc();

    if (req._metricsStartTime !== undefined) {
      const durationNs = process.hrtime.bigint() - req._metricsStartTime;
      const durationSeconds = Number(durationNs) / 1e9;
      httpRequestDurationSeconds.labels(method, route, statusCode).observe(durationSeconds);
    }
  });

  next();
}
