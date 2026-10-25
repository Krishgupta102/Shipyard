/**
 * =============================================================================
 * Shipyard Build & Deploy Worker Configuration
 *
 * Configures database, Redis, Docker daemon socket, and resource boundaries (ADR-003).
 * =============================================================================
 */

import path from 'node:path';
import os from 'node:os';

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://shipyard:shipyard_local_dev@localhost:5432/shipyard',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  buildsDir: process.env.BUILDS_DIR || path.join(os.tmpdir(), 'shipyard', 'builds'),
  buildTimeoutSeconds: parseInt(process.env.BUILD_TIMEOUT_SECONDS || '300', 10),
  buildMemoryLimitMb: parseInt(process.env.BUILD_MEMORY_LIMIT_MB || '1024', 10),
  buildCpuLimit: parseFloat(process.env.BUILD_CPU_LIMIT || '1.0'),
  traefikDynamicConfigDir: process.env.TRAEFIK_DYNAMIC_CONFIG_DIR || '/etc/shipyard/traefik/dynamic',
  traefikApiUrl: process.env.TRAEFIK_API_URL || 'http://127.0.0.1:8080',
  traefikIngressUrl: process.env.TRAEFIK_INGRESS_URL || 'http://127.0.0.1',
  shipyardDomain: process.env.SHIPYARD_DOMAIN || 'shipyard.local',
  appsNetwork: process.env.APPS_NETWORK || 'shipyard-apps',
  healthCheckTimeoutSeconds: parseInt(process.env.HEALTH_CHECK_TIMEOUT_SECONDS || '30', 10),
  healthCheckIntervalSeconds: parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS || '1', 10),
  drainSeconds: parseInt(process.env.DRAIN_SECONDS || '5', 10),
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
} as const;
