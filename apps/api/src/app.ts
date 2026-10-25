/**
 * =============================================================================
 * Shipyard Express Application Setup
 *
 * Configures middleware, route mounting, and central error handling.
 * Exported separately from server.ts so supertest can test routes without binding ports.
 * =============================================================================
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { healthRouter } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { envVarsRouter } from './routes/env-vars.js';
import { deploymentsRouter } from './routes/deployments.js';
import { webhooksRouter } from './routes/webhooks.js';
import { errorHandler } from './middlewares/error-handler.js';
import { prometheusMiddleware } from './middlewares/prometheus.js';
import { metricsRegistry } from './metrics.js';
import { config } from './config.js';

export function createApp(): Express {
  const app = express();

  // 1. Prometheus HTTP instrumentation (before all routes)
  app.use(prometheusMiddleware);

  // 2. Prometheus metrics scrape endpoint
  // Exposed at GET /metrics — scraped by Prometheus on port 3001.
  // Returns text/plain; version=0.0.4 (Prometheus exposition format).
  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = await metricsRegistry.metrics();
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(metrics);
    } catch (err) {
      res.status(500).end('Failed to collect metrics');
    }
  });

  // 3. Raw body capture for HMAC webhook verification
  app.use(
    express.json({
      verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
      limit: '10mb',
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // 2. CORS configuration
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', config.corsOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Hub-Signature-256, X-GitHub-Event'
    );
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // 5. Mount Routes
  app.use('/', healthRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectId/env', envVarsRouter);
  app.use('/api', deploymentsRouter);
  app.use('/api/webhooks', webhooksRouter);

  // 6. Fallback 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // 7. Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
