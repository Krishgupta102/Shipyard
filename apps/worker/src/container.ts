/**
 * =============================================================================
 * Container Lifecycle Manager
 *
 * Spins up and drains application containers on the isolated `shipyard-apps` network.
 * Applies container hardening (ADR-003):
 * - Network isolation: cannot reach internal platform databases/Redis
 * - No socket access
 * - Hard memory limits & CFS CPU quota
 * - Injects only project-specific environment variables
 * =============================================================================
 */

import { Slot } from '@shipyard/shared';
import { docker } from './docker.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { DeploymentLogger } from './logger.js';

export function getContainerName(projectSlug: string, slot: Slot): string {
  return `shipyard-${projectSlug}-${slot.toLowerCase()}`;
}

export interface ContainerStartResult {
  containerId: string;
  containerName: string;
  hostPort: number;
}

export async function createAndStartAppContainer({
  projectId,
  projectSlug,
  port,
  slot,
  imageTag,
  logger,
}: {
  projectId: string;
  projectSlug: string;
  port: number;
  slot: Slot;
  imageTag: string;
  logger: DeploymentLogger;
}): Promise<ContainerStartResult> {
  const containerName = getContainerName(projectSlug, slot);
  await logger.logSystem(`Preparing application container ${containerName}...`);

  // 1. Remove any pre-existing container with this slot name (idempotency recovery)
  try {
    const existing = docker.getContainer(containerName);
    await existing.stop({ t: 2 }).catch(() => {});
    await existing.remove({ force: true }).catch(() => {});
    await logger.logSystem(`Cleaned up prior container instance for slot ${slot}.`);
  } catch {}

  // 2. Fetch project-specific runtime environment variables (ADR-003: never platform secrets)
  const envVars = await prisma.projectEnvVar.findMany({
    where: { projectId },
  });

  const envList: string[] = [
    `PORT=${port}`,
    ...envVars.map((ev) => `${ev.key}=${ev.value}`),
  ];

  await logger.logSystem(
    `Injecting ${envVars.length} project environment variable(s) (platform credentials excluded).`
  );

  // 3. Resource boundaries
  const memoryBytes = config.buildMemoryLimitMb * 1024 * 1024;
  const nanoCpus = Math.floor(config.buildCpuLimit * 1e9);

  // 4. Create Container
  const portKey = `${port}/tcp`;
  const container = await docker.createContainer({
    Image: imageTag,
    name: containerName,
    Env: envList,
    ExposedPorts: {
      [portKey]: {},
    },
    HostConfig: {
      NetworkMode: config.appsNetwork,
      PortBindings: {
        [portKey]: [{ HostIp: '127.0.0.1', HostPort: '' }], // Ephemeral host port for healthcheck
      },
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: nanoCpus,
      SecurityOpt: ['no-new-privileges'],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  // 5. Start Container
  await container.start();
  await logger.logSystem(`Started container ${containerName} (ID: ${container.id.slice(0, 12)}).`);

  // 6. Inspect to retrieve ephemeral host port for healthcheck
  const inspect = await container.inspect();
  const binding = inspect.NetworkSettings.Ports[portKey]?.[0];
  const hostPort = binding?.HostPort ? parseInt(binding.HostPort, 10) : port;

  await logger.logSystem(
    `Container attached to network '${config.appsNetwork}'. Host healthcheck probe bound to 127.0.0.1:${hostPort}.`
  );

  return {
    containerId: container.id,
    containerName,
    hostPort,
  };
}

export async function stopAndRemoveContainer(
  containerName: string,
  drainSeconds = 0,
  logger?: DeploymentLogger
): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect().catch(() => null);
    if (!inspect) return;

    if (drainSeconds > 0) {
      if (logger) {
        await logger.logSystem(
          `Waiting ${drainSeconds}s drain window for in-flight requests on ${containerName}...`
        );
      }
      await new Promise((r) => setTimeout(r, drainSeconds * 1000));
    }

    if (inspect.State.Running) {
      await container.stop({ t: 10 });
    }
    await container.remove({ force: true });
    if (logger) {
      await logger.logSystem(`Stopped and removed container ${containerName}.`);
    }
  } catch (err: any) {
    console.warn(`Failed to stop/remove container ${containerName}:`, err.message);
  }
}
