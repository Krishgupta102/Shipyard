/**
 * =============================================================================
 * Health Check Prober
 *
 * Implements two distinct health checks required for zero-downtime blue-green deploys:
 *
 * 1. Direct Health Check:
 *    Probes the new application container directly via its localhost-bound port.
 *    Confirms the application process has started, bound to its port, and passed
 *    internal initialization (e.g. database connections, warmup).
 *
 * 2. Ingress Health Check:
 *    Probes the application through Traefik's edge router with the expected Host header.
 *    Confirms Traefik has reloaded its routing table and is actively proxying traffic
 *    to the new container without TCP/HTTP errors.
 * =============================================================================
 */

import http from 'node:http';
import { config } from './config.js';
import { DeploymentLogger } from './logger.js';

interface DirectHealthCheckOptions {
  hostPort: number;
  healthCheckPath: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  logger: DeploymentLogger;
}

interface IngressHealthCheckOptions {
  projectSlug: string;
  healthCheckPath: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  logger: DeploymentLogger;
}

function makeHttpRequest(options: http.RequestOptions): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 500, body });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(3000, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.end();
  });
}

/**
 * Polls the container directly on 127.0.0.1:<hostPort><healthCheckPath>
 * Retries every intervalSeconds until HTTP 200 or timeoutSeconds expires.
 */
export async function pollDirectHealthCheck({
  hostPort,
  healthCheckPath,
  timeoutSeconds = config.healthCheckTimeoutSeconds,
  intervalSeconds = config.healthCheckIntervalSeconds,
  logger,
}: DirectHealthCheckOptions): Promise<void> {
  const normalizedPath = healthCheckPath.startsWith('/') ? healthCheckPath : `/${healthCheckPath}`;
  const startTime = Date.now();
  const maxTimeMs = timeoutSeconds * 1000;

  await logger.logSystem(
    `Starting direct health check probe on http://127.0.0.1:${hostPort}${normalizedPath} (timeout: ${timeoutSeconds}s)...`
  );

  let attempt = 0;
  let lastError = 'No response';

  while (Date.now() - startTime < maxTimeMs) {
    attempt++;
    try {
      const response = await makeHttpRequest({
        host: '127.0.0.1',
        port: hostPort,
        path: normalizedPath,
        method: 'GET',
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await logger.logSystem(
          `Direct health check passed on attempt ${attempt} (HTTP ${response.statusCode} OK).`
        );
        return;
      }

      lastError = `Received HTTP ${response.statusCode}`;
    } catch (err: any) {
      lastError = err.message || 'Connection refused';
    }

    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }

  throw new Error(
    `Direct health check failed on http://127.0.0.1:${hostPort}${normalizedPath} after ${timeoutSeconds}s. Last status: ${lastError}`
  );
}

/**
 * Polls Traefik's ingress router at http://127.0.0.1:80<healthCheckPath>
 * with Host: <projectSlug>.<shipyardDomain>
 * Confirms end-to-end traffic flow through Traefik to the container.
 */
export async function pollIngressHealthCheck({
  projectSlug,
  healthCheckPath,
  timeoutSeconds = 15,
  intervalSeconds = 1,
  logger,
}: IngressHealthCheckOptions): Promise<void> {
  const normalizedPath = healthCheckPath.startsWith('/') ? healthCheckPath : `/${healthCheckPath}`;
  const hostHeader = `${projectSlug}.${config.shipyardDomain}`;
  const startTime = Date.now();
  const maxTimeMs = timeoutSeconds * 1000;

  await logger.logSystem(
    `Starting Traefik ingress health check via Host: ${hostHeader}${normalizedPath}...`
  );

  let attempt = 0;
  let lastError = 'No response';

  while (Date.now() - startTime < maxTimeMs) {
    attempt++;
    try {
      const response = await makeHttpRequest({
        host: '127.0.0.1',
        port: 80,
        path: normalizedPath,
        method: 'GET',
        headers: {
          Host: hostHeader,
        },
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await logger.logSystem(
          `Traefik ingress route verified end-to-end (attempt ${attempt}, HTTP ${response.statusCode} OK).`
        );
        return;
      }

      lastError = `Received HTTP ${response.statusCode}`;
    } catch (err: any) {
      lastError = err.message || 'Connection refused';
    }

    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }

  throw new Error(
    `Ingress health check failed via Traefik (Host: ${hostHeader}) after ${timeoutSeconds}s. Last status: ${lastError}`
  );
}
