/**
 * =============================================================================
 * Health Check Routes
 *
 * Verifies API server health and dependencies (PostgreSQL and Redis).
 * =============================================================================
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { redis } from '../redis.js';

export const healthRouter = Router();

async function checkHealth(_req: Request, res: Response) {
  let postgresStatus = 'unknown';
  let redisStatus = 'unknown';
  let isHealthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    postgresStatus = 'healthy';
  } catch (err) {
    postgresStatus = 'unhealthy';
    isHealthy = false;
  }

  try {
    const pong = await redis.ping();
    redisStatus = pong === 'PONG' ? 'healthy' : 'unhealthy';
  } catch (err) {
    redisStatus = 'unhealthy';
    isHealthy = false;
  }

  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    services: {
      postgres: postgresStatus,
      redis: redisStatus,
    },
  });
}

healthRouter.get('/health', checkHealth);
healthRouter.get('/api/health', checkHealth);
