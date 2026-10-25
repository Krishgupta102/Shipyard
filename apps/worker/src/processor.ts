/**
 * =============================================================================
 * BullMQ Deployment Job Processor (Phases 3 & 4)
 *
 * Orchestrates the full build-and-deploy pipeline with zero downtime:
 * 1. Git checkout of exact commit & Docker image build with CPU/memory limits.
 * 2. Starts new container on `shipyard-apps` network alongside active container.
 * 3. Probes container directly on /health until 200 OK.
 * 4. Atomically replaces Traefik dynamic routing file (ADR-004).
 * 5. Verifies Traefik API and end-to-end ingress health check (ADR-007).
 * 6. Atomically updates Deployment.status = SUCCESS and Project.activeDeploymentId.
 * 7. Drains in-flight requests for 5s and removes previous container.
 * =============================================================================
 */

import { Job } from 'bullmq';
import {
  assertCanTransition,
  DeployJobData,
  DeploymentStatus,
  DeploymentTrigger,
  Slot,
} from '@shipyard/shared';
import { prisma } from './db.js';
import { config } from './config.js';
import { createDeploymentLogger } from './logger.js';
import {
  cleanScratchDir,
  cloneAndCheckout,
  prepareScratchDir,
  verifyDockerfile,
} from './git.js';
import { buildDockerImage } from './builder.js';
import {
  createAndStartAppContainer,
  getContainerName,
  stopAndRemoveContainer,
} from './container.js';
import {
  pollDirectHealthCheck,
  pollIngressHealthCheck,
} from './healthcheck.js';
import {
  buildTraefikDynamicConfig,
  restorePreviousTraefikRoute,
  verifyTraefikRoute,
  writeAtomicTraefikConfig,
} from './traefik.js';
import {
  deploymentsSuccessTotal,
  deploymentsFailedTotal,
  dockerBuildDurationSeconds,
  gitCheckoutDurationSeconds,
  containerHealthCheckDurationSeconds,
  traefikVerificationDurationSeconds,
} from './metrics.js';

export async function processDeploymentJob(job: Job<DeployJobData>): Promise<void> {
  const { deploymentId, projectId, targetSlot, trigger, commitSha, gitRef, rollbackFromDeploymentId } = job.data;
  const logger = createDeploymentLogger(deploymentId);

  let scratchDir: string | null = null;
  let newContainerName: string | null = null;
  let cutoverAttempted = false;
  let failureStage = 'unknown';

  try {
    // 1. Fetch deployment and project records
    const [deployment, project] = await Promise.all([
      prisma.deployment.findUnique({ where: { id: deploymentId } }),
      prisma.project.findUnique({ where: { id: projectId } }),
    ]);

    if (!deployment || !project) {
      throw new Error(`Deployment (${deploymentId}) or Project (${projectId}) not found.`);
    }

    // Check if deployment was cancelled while sitting in queue
    if (deployment.status === DeploymentStatus.CANCELLED) {
      await logger.logSystem('Deployment was cancelled before execution started. Exiting job.');
      await logger.close(true);
      return;
    }

    // 2. Transition QUEUED -> BUILDING (ADR-002)
    assertCanTransition(deployment.status as DeploymentStatus, DeploymentStatus.BUILDING);

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.BUILDING,
        startedAt: new Date(),
      },
    });

    await logger.logSystem(`Build worker started processing job ${job.id}`);
    await logger.logSystem(`Project: ${project.name} (${project.slug}) | Target Slot: ${targetSlot}`);

    let imageTag: string;

    // 3. Rollback Shortcut (ADR-002: immutable images)
    if (trigger === DeploymentTrigger.ROLLBACK && rollbackFromDeploymentId) {
      const rollbackTarget = await prisma.deployment.findUnique({
        where: { id: rollbackFromDeploymentId },
      });

      if (rollbackTarget?.imageTag) {
        imageTag = rollbackTarget.imageTag;
        await logger.logSystem(`Rollback optimization: reusing verified image ${imageTag}. Skipping build.`);
      } else {
        throw new Error(`Rollback target deployment ${rollbackFromDeploymentId} has no immutable image tag.`);
      }
    } else {
      // 4. Standard Build: Git clone & Docker image build
      scratchDir = await prepareScratchDir(deploymentId);

      failureStage = 'building';
      const gitStart = Date.now();
      const { resolvedSha, commitMessage } = await cloneAndCheckout(
        project.repoUrl,
        gitRef,
        commitSha,
        scratchDir,
        logger
      );
      gitCheckoutDurationSeconds.labels('success').observe((Date.now() - gitStart) / 1000);

      // Verify repository root contains a Dockerfile
      await verifyDockerfile(scratchDir);

      // Persist resolved commit info
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          commitSha: resolvedSha,
          commitMessage,
        },
      });

      // Build Docker image with CPU CFS quota & memory caps
      const buildStart = Date.now();
      try {
        imageTag = await buildDockerImage({
          projectId: project.id,
          commitSha: resolvedSha,
          scratchDir,
          logger,
        });
        dockerBuildDurationSeconds.labels(project.id, 'success').observe((Date.now() - buildStart) / 1000);
      } catch (buildErr) {
        dockerBuildDurationSeconds.labels(project.id, 'failed').observe((Date.now() - buildStart) / 1000);
        throw buildErr;
      }

      await cleanScratchDir(scratchDir);
      scratchDir = null;
    }

    // 5. Transition BUILDING -> DEPLOYING
    assertCanTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING);

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.DEPLOYING,
        imageTag,
      },
    });

    await logger.logSystem(`Image ready: ${imageTag}. Entering Phase 4 container deployment.`);

    // 6. Start new container in targetSlot (active container continues serving traffic!)
    const containerResult = await createAndStartAppContainer({
      projectId: project.id,
      projectSlug: project.slug,
      port: project.port,
      slot: targetSlot,
      imageTag,
      logger,
    });
    newContainerName = containerResult.containerName;

    // 7. Direct in-container health check
    failureStage = 'health_check';
    const hcStart = Date.now();
    try {
      await pollDirectHealthCheck({
        hostPort: containerResult.hostPort,
        healthCheckPath: project.healthCheckPath,
        timeoutSeconds: config.healthCheckTimeoutSeconds,
        intervalSeconds: config.healthCheckIntervalSeconds,
        logger,
      });
      containerHealthCheckDurationSeconds.labels('success').observe((Date.now() - hcStart) / 1000);
    } catch (hcErr) {
      containerHealthCheckDurationSeconds.labels('failed').observe((Date.now() - hcStart) / 1000);
      throw hcErr;
    }

    // 8. Atomic Traefik routing switch (ADR-004)
    cutoverAttempted = true;
    const dynamicConfigContent = buildTraefikDynamicConfig(
      project.slug,
      containerResult.containerName,
      project.port
    );
    await writeAtomicTraefikConfig(project.id, dynamicConfigContent, logger);

    // 9. Two-stage post-cutover verification (ADR-007)
    failureStage = 'traefik';
    // Stage 1: Verify Traefik control plane API updated
    const tv1Start = Date.now();
    try {
      await verifyTraefikRoute(
        project.slug,
        containerResult.containerName,
        project.port,
        15,
        1000,
        logger
      );
      traefikVerificationDurationSeconds.labels('control_plane', 'success').observe((Date.now() - tv1Start) / 1000);
    } catch (tvErr) {
      traefikVerificationDurationSeconds.labels('control_plane', 'failed').observe((Date.now() - tv1Start) / 1000);
      throw tvErr;
    }

    // Stage 2: End-to-end ingress health check through Traefik
    const tv2Start = Date.now();
    try {
      await pollIngressHealthCheck({
        projectSlug: project.slug,
        healthCheckPath: project.healthCheckPath,
        timeoutSeconds: 15,
        intervalSeconds: 1,
        logger,
      });
      traefikVerificationDurationSeconds.labels('ingress', 'success').observe((Date.now() - tv2Start) / 1000);
    } catch (tvErr) {
      traefikVerificationDurationSeconds.labels('ingress', 'failed').observe((Date.now() - tv2Start) / 1000);
      throw tvErr;
    }

    // 10. Both verifications passed! Update Database atomically
    assertCanTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.SUCCESS);

    const oldActiveSlot = project.activeSlot;
    const oldContainerName = oldActiveSlot ? getContainerName(project.slug, oldActiveSlot) : null;

    await prisma.$transaction([
      prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: DeploymentStatus.SUCCESS,
          finishedAt: new Date(),
        },
      }),
      prisma.project.update({
        where: { id: project.id },
        data: {
          activeDeploymentId: deployment.id,
          activeSlot: targetSlot,
        },
      }),
    ]);

    await logger.logSystem(
      `Traffic successfully switched to slot ${targetSlot}. Deployment marked SUCCESS.`
    );

    // Record successful deployment in Prometheus
    deploymentsSuccessTotal.labels(trigger).inc();

    // 11. Graceful draining and cleanup of previous slot container
    if (oldContainerName && oldActiveSlot !== targetSlot) {
      await stopAndRemoveContainer(oldContainerName, config.drainSeconds, logger);
    }

    await logger.close(true);
  } catch (err: any) {
    console.error(`Deployment pipeline failed for ${deploymentId}:`, err);
    await logger.logStderr(`Deployment failed: ${err.message || err}`);

    // If scratch dir was left, clean it up
    if (scratchDir) {
      await cleanScratchDir(scratchDir);
    }

    // If cutover was attempted but verification failed: restore old Traefik route!
    if (cutoverAttempted) {
      try {
        const freshProject = await prisma.project.findUnique({ where: { id: projectId } });
        if (freshProject?.activeSlot) {
          const oldContainer = getContainerName(freshProject.slug, freshProject.activeSlot);
          await restorePreviousTraefikRoute(
            freshProject.id,
            freshProject.slug,
            oldContainer,
            freshProject.port,
            logger
          );
          // Confirm old application remains accessible through Traefik ingress
          await pollIngressHealthCheck({
            projectSlug: freshProject.slug,
            healthCheckPath: freshProject.healthCheckPath,
            timeoutSeconds: 10,
            intervalSeconds: 1,
            logger,
          });
          await logger.logSystem(
            `Restored Traefik route to prior live container (${oldContainer}). Live traffic preserved.`
          );
        }
      } catch (restoreErr: any) {
        console.error('Failed to restore prior Traefik route:', restoreErr);
        await logger.logStderr(`Failed to restore prior Traefik route: ${restoreErr.message}`);
      }
    }

    // Stop and remove the failed new container so it doesn't linger
    if (newContainerName) {
      await stopAndRemoveContainer(newContainerName, 0, logger);
    }

    // Mark deployment FAILED in database
    try {
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: DeploymentStatus.FAILED,
          finishedAt: new Date(),
          failureReason: err.message || 'Deployment pipeline failed unexpectedly.',
        },
      });
      // Record failure in Prometheus
      deploymentsFailedTotal.labels(trigger, failureStage).inc();
    } catch (dbErr) {
      console.error('Failed to update deployment status to FAILED:', dbErr);
    }

    await logger.close(true);
    throw err;
  }
}
