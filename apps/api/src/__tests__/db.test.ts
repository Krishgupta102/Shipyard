import { describe, expect, it, afterAll } from 'vitest';
import { PrismaClient, DeploymentStatus, Slot, DeploymentTrigger } from '@prisma/client';
import { canTransition, assertCanTransition, InvalidStateTransitionError } from '@shipyard/shared';

const prisma = new PrismaClient();

describe('Database Schema & State Integration', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('can query seeded user and project with relations', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
      include: {
        user: true,
        envVars: true,
        activeDeployment: true,
        deployments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    expect(project).not.toBeNull();
    expect(project?.user.githubUsername).toBe('dev-demo');
    expect(project?.envVars.length).toBeGreaterThanOrEqual(3);
    expect(project?.deployments.length).toBeGreaterThanOrEqual(3);
  });

  it('verifies ADR-002: active deployment is separated from individual deployment status', async () => {
    const project = await prisma.project.findUnique({
      where: { slug: 'express-hello' },
      include: {
        activeDeployment: true,
        deployments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    expect(project).not.toBeNull();
    // Deployment 1 (v1): Succeeded on BLUE
    const v1 = project!.deployments[0]!;
    expect(v1.status).toBe(DeploymentStatus.SUCCESS);
    expect(v1.targetSlot).toBe(Slot.BLUE);

    // Deployment 2 (v2): Failed on GREEN
    const v2 = project!.deployments[1]!;
    expect(v2.status).toBe(DeploymentStatus.FAILED);
    expect(v2.targetSlot).toBe(Slot.GREEN);
    expect(v2.failureReason).toContain('Healthcheck timed out');

    // Deployment 3 (v3): Succeeded on GREEN (Rollback to v1 image)
    const v3 = project!.deployments[2]!;
    expect(v3.status).toBe(DeploymentStatus.SUCCESS);
    expect(v3.targetSlot).toBe(Slot.GREEN);
    expect(v3.trigger).toBe(DeploymentTrigger.ROLLBACK);
    expect(v3.rollbackFromDeploymentId).toBe(v1.id);

    // Active deployment on project is v3 on GREEN slot
    expect(project!.activeDeploymentId).toBe(v3.id);
    expect(project!.activeSlot).toBe(Slot.GREEN);
    expect(project!.activeDeployment?.id).toBe(v3.id);
  });

  it('enforces state machine transition rules against database status values', () => {
    expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING)).toBe(true);
    expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)).toBe(true);
    expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.SUCCESS)).toBe(true);

    // Terminal states cannot transition
    expect(canTransition(DeploymentStatus.SUCCESS, DeploymentStatus.DEPLOYING)).toBe(false);
    expect(() => {
      assertCanTransition(DeploymentStatus.SUCCESS, DeploymentStatus.BUILDING);
    }).toThrow(InvalidStateTransitionError);
  });
});
