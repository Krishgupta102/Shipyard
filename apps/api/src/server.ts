/**
 * =============================================================================
 * Shipyard API HTTP Server Entrypoint
 * =============================================================================
 */

import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { redis } from './redis.js';
import { deploymentQueue } from './queue.js';

const server = app.listen(config.port, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Shipyard Control Plane API is listening on port ${config.port}`);
  console.log(`📡 Health Check: http://localhost:${config.port}/health`);
  console.log(`📦 REST API:     http://localhost:${config.port}/api/projects`);
  console.log(`======================================================\n`);
});

// Graceful shutdown handling
async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down API gracefully...`);
  server.close(async () => {
    try {
      await deploymentQueue.close();
      await redis.quit();
      await prisma.$disconnect();
      console.log('✅ All connections closed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
