/**
 * =============================================================================
 * Shipyard Build Worker Entrypoint
 * =============================================================================
 */

export * from './config.js';
export * from './db.js';
export * from './redis.js';
export * from './docker.js';
export * from './logger.js';
export * from './git.js';
export * from './builder.js';
export * from './container.js';
export * from './healthcheck.js';
export * from './traefik.js';
export * from './reconciler.js';
export * from './processor.js';
export * from './metrics.js';
export * from './metrics-server.js';
export * from './worker.js';

import { startWorkerService } from './worker.js';

startWorkerService().catch((err) => {
  console.error('Failed to start worker service:', err);
  process.exit(1);
});
