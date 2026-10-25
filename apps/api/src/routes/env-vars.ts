/**
 * =============================================================================
 * Project Environment Variables Handler
 *
 * Manages project-specific environment variables and secrets.
 * Enforces key naming conventions and unique key constraints per project.
 * =============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db.js';
import { createEnvVarSchema, createEnvVarsBatchSchema } from '@shipyard/shared';

export const envVarsRouter = Router({ mergeParams: true });

/**
 * GET /api/projects/:projectId/env
 * Retrieve environment variables for a project. Secrets masked unless explicitly revealed.
 */
envVarsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const reveal = req.query.reveal === 'true';

    const envVars = await prisma.projectEnvVar.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });

    const formatted = envVars.map((ev) => ({
      ...ev,
      value: !reveal && ev.isSecret ? '••••••••' : ev.value,
    }));

    res.json({ envVars: formatted });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/env
 * Add or update a single environment variable (upsert).
 */
envVarsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.projectId as string;
    const validated = createEnvVarSchema.parse(req.body);

    // Verify project exists
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const envVar = await prisma.projectEnvVar.upsert({
      where: {
        projectId_key: {
          projectId,
          key: validated.key,
        },
      },
      update: {
        value: validated.value,
        isSecret: validated.isSecret,
      },
      create: {
        projectId,
        key: validated.key,
        value: validated.value,
        isSecret: validated.isSecret,
      },
    });

    res.status(201).json({ envVar });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/env/batch
 * Batch upsert environment variables.
 */
envVarsRouter.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.projectId as string;
    const validated = createEnvVarsBatchSchema.parse(req.body);

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const results = await prisma.$transaction(
      validated.variables.map((v) =>
        prisma.projectEnvVar.upsert({
          where: {
            projectId_key: {
              projectId,
              key: v.key,
            },
          },
          update: {
            value: v.value,
            isSecret: v.isSecret,
          },
          create: {
            projectId,
            key: v.key,
            value: v.value,
            isSecret: v.isSecret,
          },
        })
      )
    );

    res.status(200).json({ count: results.length });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/projects/:projectId/env/:key
 * Delete an environment variable by key.
 */
envVarsRouter.delete('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.projectId as string;
    const key = req.params.key as string;

    await prisma.projectEnvVar.delete({
      where: {
        projectId_key: {
          projectId,
          key,
        },
      },
    });

    res.json({ message: `Environment variable '${key}' deleted` });
  } catch (err) {
    next(err);
  }
});
