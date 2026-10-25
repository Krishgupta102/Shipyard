/**
 * =============================================================================
 * Projects Route Handler
 *
 * Provides CRUD management for user projects.
 * =============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db.js';
import { createProjectSchema, updateProjectSchema } from '@shipyard/shared';

export const projectsRouter = Router();

/**
 * Helper to ensure a fallback default owner exists in single-owner mode (ADR-003).
 */
async function getDefaultUserId(): Promise<string> {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        githubId: 'owner-default',
        githubUsername: 'platform-owner',
        email: 'owner@shipyard.local',
      },
    });
  }
  return user.id;
}

/**
 * GET /api/projects
 * List all projects with active deployment routing info.
 */
projectsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        activeDeployment: true,
        _count: {
          select: { deployments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:id
 * Retrieve a project by its CUID or unique slug.
 */
projectsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
      include: {
        activeDeployment: true,
        envVars: {
          select: {
            id: true,
            key: true,
            value: true,
            isSecret: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        deployments: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Mask secret environment variable values in the response
    const maskedEnvVars = project.envVars.map((ev) => ({
      ...ev,
      value: ev.isSecret ? '••••••••' : ev.value,
    }));

    res.json({ project: { ...project, envVars: maskedEnvVars } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects
 * Create a new project.
 */
projectsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = createProjectSchema.parse(req.body);
    const userId = await getDefaultUserId();

    const project = await prisma.project.create({
      data: {
        name: validated.name,
        slug: validated.slug,
        repoUrl: validated.repoUrl,
        defaultBranch: validated.defaultBranch,
        buildCommand: validated.buildCommand ?? null,
        runCommand: validated.runCommand ?? null,
        port: validated.port,
        healthCheckPath: validated.healthCheckPath,
        userId,
      },
    });

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/projects/:id
 * Update project configuration (slug cannot be modified).
 */
projectsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const validated = updateProjectSchema.parse(req.body);

    const project = await prisma.project.update({
      where: { id },
      data: validated,
    });

    res.json({ project });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and cascade delete all associated deployments, logs, and env vars.
 */
projectsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    // Clear activeDeployment pointer first to avoid foreign key cycle during cascade
    await prisma.project.update({
      where: { id },
      data: { activeDeploymentId: null },
    });

    await prisma.project.delete({
      where: { id },
    });

    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    next(err);
  }
});
