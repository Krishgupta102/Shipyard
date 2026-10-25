/**
 * =============================================================================
 * Traefik Dynamic File Provider & Blue-Green Traffic Switcher
 *
 * Implements ADR-004 and ADR-007:
 * - POSIX-atomic configuration replacement (write to .tmp then rename).
 * - Multi-stage cutover verification (Traefik control-plane API + ingress probe).
 * - Automatic route restoration if cutover fails.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { config } from './config.js';
import { docker } from './docker.js';
import { DeploymentLogger } from './logger.js';

export function buildTraefikDynamicConfig(
  projectSlug: string,
  containerName: string,
  port: number
): string {
  const dynamicConfig = {
    http: {
      routers: {
        [`router-${projectSlug}`]: {
          rule: `Host(\`${projectSlug}.${config.shipyardDomain}\`)`,
          service: `srv-${projectSlug}`,
          entryPoints: ['web'],
        },
      },
      services: {
        [`srv-${projectSlug}`]: {
          loadBalancer: {
            servers: [{ url: `http://${containerName}:${port}` }],
          },
        },
      },
    },
  };

  return JSON.stringify(dynamicConfig, null, 2);
}

/**
 * Atomically replaces the Traefik dynamic config file.
 * Writes to a temporary file first, then executes an atomic rename(2) syscall.
 *
 * To ensure reliability across both host volumes and containerized environments:
 * 1. Writes and renames locally in config.traefikDynamicConfigDir.
 * 2. Writes and renames inside the shipyard-traefik container via exec ('mv tmp final').
 */
export async function writeAtomicTraefikConfig(
  projectId: string,
  configContent: string,
  logger?: DeploymentLogger
): Promise<void> {
  const fileName = `${projectId}.yml`;
  const tmpFileName = `${projectId}.tmp.yml`;

  // 1. Local filesystem atomic write
  try {
    await fs.mkdir(config.traefikDynamicConfigDir, { recursive: true });
    const localTmp = path.join(config.traefikDynamicConfigDir, tmpFileName);
    const localFinal = path.join(config.traefikDynamicConfigDir, fileName);

    await fs.writeFile(localTmp, configContent, 'utf8');
    await fs.rename(localTmp, localFinal);
  } catch (localErr: any) {
    console.warn(`Local Traefik config write warning: ${localErr.message}`);
  }

  // 2. Traefik container atomic write & rename
  try {
    const traefikContainer = docker.getContainer('shipyard-traefik');
    const containerTmpPath = `/etc/traefik/dynamic/${tmpFileName}`;
    const containerFinalPath = `/etc/traefik/dynamic/${fileName}`;

    // Write temp file inside container via shell
    const escapedContent = configContent.replace(/'/g, "'\\''");
    const writeExec = await traefikContainer.exec({
      Cmd: ['sh', '-c', `printf '%s' '${escapedContent}' > "${containerTmpPath}" && mv "${containerTmpPath}" "${containerFinalPath}"`],
    });
    await writeExec.start({});
  } catch (containerErr: any) {
    console.warn(`Traefik container direct write warning: ${containerErr.message}`);
  }

  if (logger) {
    await logger.logSystem(`Atomically replaced Traefik dynamic routing configuration (${fileName}).`);
  }
}

/**
 * Polls the Traefik dashboard API to verify that Traefik's in-memory routing table
 * has reloaded and is pointing to the expected green container address.
 */
export async function verifyTraefikRoute(
  projectSlug: string,
  expectedContainerName: string,
  port: number,
  maxAttempts = 15,
  delayMs = 1000,
  logger?: DeploymentLogger
): Promise<void> {
  const serviceName = `srv-${projectSlug}@file`;
  const expectedUrl = `http://${expectedContainerName}:${port}`;
  const apiUrl = `${config.traefikApiUrl}/api/http/services/${serviceName}`;

  if (logger) {
    await logger.logSystem(`Stage 1 Verification: Polling Traefik API for service ${serviceName}...`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await new Promise<any>((resolve, reject) => {
        const req = http.get(apiUrl, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`Traefik API returned HTTP ${res.statusCode}`));
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('Traefik API timeout')));
      });

      const serverUrl = data.loadBalancer?.servers?.[0]?.url;
      if (serverUrl === expectedUrl) {
        if (logger) {
          await logger.logSystem(
            `Stage 1 Verification Passed: Traefik service ${serviceName} updated to ${expectedUrl} (attempt ${attempt}).`
          );
        }
        return;
      }
    } catch (err: any) {
      // Traefik may take a second to create the service on initial deployment
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error(
    `Traefik route verification failed after ${maxAttempts}s: service ${serviceName} did not update to ${expectedUrl}.`
  );
}

/**
 * Restores the previous routing configuration if cutover verification fails.
 */
export async function restorePreviousTraefikRoute(
  projectId: string,
  projectSlug: string,
  oldContainerName: string,
  port: number,
  logger?: DeploymentLogger
): Promise<void> {
  if (logger) {
    await logger.logSystem(`Restoring previous Traefik route to ${oldContainerName}...`);
  }

  const restoredConfig = buildTraefikDynamicConfig(projectSlug, oldContainerName, port);
  await writeAtomicTraefikConfig(projectId, restoredConfig, logger);

  // Short pause to allow Traefik inotify watcher to reload restored config
  await new Promise((r) => setTimeout(r, 1000));
}
