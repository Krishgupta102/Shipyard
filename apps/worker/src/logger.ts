/**
 * =============================================================================
 * Real-Time Deployment Logger
 *
 * Persists log events to PostgreSQL and simultaneously broadcasts them
 * via Redis Pub/Sub for Server-Sent Events (SSE) streaming to dashboard clients.
 * =============================================================================
 */

import { LogStream } from '@shipyard/shared';
import { prisma } from './db.js';
import { redis } from './redis.js';

export interface DeploymentLogger {
  log(stream: LogStream, message: string): Promise<void>;
  logSystem(message: string): Promise<void>;
  logStdout(message: string): Promise<void>;
  logStderr(message: string): Promise<void>;
  close(isTerminal?: boolean): Promise<void>;
}

export function createDeploymentLogger(deploymentId: string): DeploymentLogger {
  const channel = `deployment:logs:${deploymentId}`;

  async function log(stream: LogStream, message: string): Promise<void> {
    const timestamp = new Date();
    const cleanMessage = message.replace(/\r?\n$/, '');

    // 1. Persist to PostgreSQL in background
    const logLinePromise = prisma.logLine
      .create({
        data: {
          deploymentId,
          stream,
          message: cleanMessage,
          timestamp,
        },
      })
      .catch((err) => {
        console.error(`Failed to persist log for deployment ${deploymentId}:`, err);
      });

    // 2. Broadcast via Redis Pub/Sub for active SSE clients
    const payload = JSON.stringify({
      deploymentId,
      stream,
      message: cleanMessage,
      timestamp: timestamp.toISOString(),
    });

    const redisPromise = redis.publish(channel, payload).catch((err) => {
      console.error(`Failed to publish log to Redis channel ${channel}:`, err);
    });

    await Promise.all([logLinePromise, redisPromise]);
  }

  return {
    log,
    logSystem: (msg: string) => log(LogStream.SYSTEM, msg),
    logStdout: (msg: string) => log(LogStream.STDOUT, msg),
    logStderr: (msg: string) => log(LogStream.STDERR, msg),
    close: async (isTerminal = true) => {
      if (isTerminal) {
        await redis
          .publish(
            channel,
            JSON.stringify({
              deploymentId,
              isTerminal: true,
              timestamp: new Date().toISOString(),
            })
          )
          .catch(() => {});
      }
    },
  };
}
