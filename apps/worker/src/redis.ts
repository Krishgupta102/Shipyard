/**
 * =============================================================================
 * Worker Redis Client
 *
 * Dedicated Redis client for publishing real-time build and deployment logs to SSE subscribers.
 * =============================================================================
 */

import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
