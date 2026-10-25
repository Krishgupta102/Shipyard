/**
 * =============================================================================
 * Redis Client
 *
 * Manages Redis connections for BullMQ queue operations and Pub/Sub SSE streaming.
 * Note: BullMQ requires `maxRetriesPerRequest: null` on its Redis instances.
 * =============================================================================
 */

import { Redis } from 'ioredis';
import { config } from './config.js';

/**
 * Shared primary Redis client.
 */
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/**
 * Creates an isolated Redis client (used for Redis Pub/Sub subscription channels).
 */
export function createRedisSubscriber(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
