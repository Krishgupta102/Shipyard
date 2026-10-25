/**
 * =============================================================================
 * Git Checkout & Build Context Handler
 *
 * Clones git repositories into isolated temporary scratch directories,
 * verifies the root Dockerfile, and packages the build context into a tar stream.
 *
 * ADR-005: Deterministic scratch paths (`/tmp/shipyard/builds/${deploymentId}`)
 * ensure any retry wipes prior partial clones cleanly before re-attempting.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import tar from 'tar-fs';
import { config } from './config.js';
import { DeploymentLogger } from './logger.js';

export async function prepareScratchDir(deploymentId: string): Promise<string> {
  const scratchDir = path.join(config.buildsDir, deploymentId);
  // Wipe scratch directory to ensure idempotency on job retries (ADR-005)
  await fs.rm(scratchDir, { recursive: true, force: true });
  await fs.mkdir(scratchDir, { recursive: true });
  return scratchDir;
}

export async function cleanScratchDir(scratchDir: string): Promise<void> {
  try {
    await fs.rm(scratchDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to clean up scratch dir ${scratchDir}:`, err);
  }
}

export async function cloneAndCheckout(
  repoUrl: string,
  gitRef: string,
  commitSha: string,
  scratchDir: string,
  logger: DeploymentLogger
): Promise<{ resolvedSha: string; commitMessage: string }> {
  const git = simpleGit(scratchDir);

  const isExactSha = Boolean(commitSha && commitSha !== 'HEAD' && commitSha.length >= 7);

  if (isExactSha) {
    await logger.logSystem(`Cloning repository ${repoUrl} for exact commit ${commitSha.slice(0, 8)}...`);
    // Full clone to guarantee historical commit SHA is checked out (not latest branch HEAD)
    await git.clone(repoUrl, '.');
    await git.checkout(commitSha);
  } else {
    // If commitSha is 'HEAD' or unspecified, clone the target branch
    const branch = gitRef.startsWith('refs/heads/') ? gitRef.replace('refs/heads/', '') : gitRef;
    await logger.logSystem(`Cloning repository ${repoUrl} (branch: ${branch})...`);
    await git.clone(repoUrl, '.', ['--depth', '1', '--branch', branch]);
  }

  // Get exact commit SHA and message of the checked out HEAD
  const logSummary = await git.log({ maxCount: 1 });
  const latestCommit = logSummary.latest;

  const resolvedSha = latestCommit?.hash || (await git.revparse(['HEAD'])).trim();
  const commitMessage = latestCommit?.message || 'Commit ' + resolvedSha.slice(0, 8);

  // Assertion: If an exact commitSha was requested, verify that the checked-out commit matches
  if (
    isExactSha &&
    !resolvedSha.toLowerCase().startsWith(commitSha.toLowerCase()) &&
    !commitSha.toLowerCase().startsWith(resolvedSha.toLowerCase())
  ) {
    throw new Error(
      `Git checkout mismatch: requested commit ${commitSha}, but checked out ${resolvedSha}`
    );
  }

  await logger.logSystem(`Checked out commit ${resolvedSha.slice(0, 8)}: "${commitMessage}"`);

  return { resolvedSha, commitMessage };
}

export async function verifyDockerfile(scratchDir: string): Promise<void> {
  const dockerfilePath = path.join(scratchDir, 'Dockerfile');
  if (!existsSync(dockerfilePath)) {
    throw new Error(
      'Dockerfile not found in repository root. Every Shipyard application must contain a Dockerfile in its root directory.'
    );
  }
}

export function createBuildContextTar(scratchDir: string): NodeJS.ReadableStream {
  return tar.pack(scratchDir, {
    ignore: (name) => {
      // Exclude .git folder from Docker build context to optimize tar speed and image cache
      const rel = path.relative(scratchDir, name);
      return rel.startsWith('.git');
    },
  });
}
