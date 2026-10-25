/**
 * =============================================================================
 * Shipyard API Configuration
 *
 * Validates and exposes typed environment variables for the API service.
 * =============================================================================
 */

export const config = {
  port: parseInt(process.env.API_PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://shipyard:shipyard_local_dev@localhost:5432/shipyard',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || 'dev_webhook_secret',
  corsOrigin: process.env.CORS_ORIGIN || '*',
} as const;
