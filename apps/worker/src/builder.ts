/**
 * =============================================================================
 * Docker Image Builder
 *
 * Builds Docker images using the Docker Engine API with strict resource limits
 * (CPU/memory caps per ADR-003) and timeout watchdogs.
 * Streams stdout/stderr output lines in real-time.
 * =============================================================================
 */

import { docker } from './docker.js';
import { config } from './config.js';
import { DeploymentLogger } from './logger.js';
import { createBuildContextTar } from './git.js';

export async function imageExists(imageTag: string): Promise<boolean> {
  try {
    const img = docker.getImage(imageTag);
    await img.inspect();
    return true;
  } catch {
    return false;
  }
}

export interface BuildOptions {
  projectId: string;
  commitSha: string;
  scratchDir: string;
  logger: DeploymentLogger;
  forceRebuild?: boolean;
}

export async function buildDockerImage({
  projectId,
  commitSha,
  scratchDir,
  logger,
  forceRebuild = false,
}: BuildOptions): Promise<string> {
  const shortSha = commitSha.slice(0, 8);
  const imageTag = `shipyard/${projectId}:${shortSha}`;

  // ADR-005: Idempotency check — if the image tag already exists, reuse it unless forceRebuild
  if (!forceRebuild && (await imageExists(imageTag))) {
    await logger.logSystem(`Docker image ${imageTag} already exists in local daemon. Reusing cached image.`);
    return imageTag;
  }

  await logger.logSystem(`Packaging build context from ${scratchDir}...`);
  const tarStream = createBuildContextTar(scratchDir);

  await logger.logSystem(`Enforcing resource limits: Memory Cap = ${config.buildMemoryLimitMb}MB, CPU Quota = ${config.buildCpuLimit} cores, Timeout = ${config.buildTimeoutSeconds}s`);

  // Compute resource limits in bytes (ADR-003)
  const memoryBytes = config.buildMemoryLimitMb * 1024 * 1024;

  // Hard CFS CPU quota in Docker:
  // - cpuperiod: length of CFS period in microseconds (standard: 100,000us = 100ms)
  // - cpuquota: total CPU time available within the period (e.g. 1.0 CPU = 100,000us; 0.5 CPU = 50,000us)
  // - cpushares: relative weight during contention (1024 = 1 standard share)
  const cpuPeriod = 100000;
  const cpuQuota = Math.floor(config.buildCpuLimit * cpuPeriod);

  const buildStream: NodeJS.ReadableStream = await docker.buildImage(tarStream, {
    t: imageTag,
    memory: memoryBytes,
    memswap: memoryBytes, // Disable extra swap
    cpushares: Math.floor(config.buildCpuLimit * 1024),
    cpuperiod: cpuPeriod,
    cpuquota: cpuQuota,
  });

  // Watchdog timeout to prevent runaway builds
  let isTimedOut = false;
  const timeoutTimer = setTimeout(() => {
    isTimedOut = true;
    if (typeof (buildStream as any).destroy === 'function') {
      (buildStream as any).destroy();
    }
  }, config.buildTimeoutSeconds * 1000);

  try {
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        buildStream,
        (err, res) => {
          clearTimeout(timeoutTimer);
          if (isTimedOut) {
            return reject(
              new Error(`Build timed out after exceeding ${config.buildTimeoutSeconds} seconds limit.`)
            );
          }
          if (err) {
            return reject(err);
          }
          // Check for error in the last result frame
          const lastError = res?.find((item: any) => item?.error);
          if (lastError) {
            return reject(new Error(lastError.error || 'Docker build failed'));
          }
          resolve();
        },
        (event: any) => {
          if (event.stream) {
            // Log output line
            logger.logStdout(event.stream).catch(() => {});
          } else if (event.error) {
            logger.logStderr(event.error).catch(() => {});
          }
        }
      );
    });

    await logger.logSystem(`Docker image built successfully: ${imageTag}`);
    return imageTag;
  } finally {
    clearTimeout(timeoutTimer);
  }
}
