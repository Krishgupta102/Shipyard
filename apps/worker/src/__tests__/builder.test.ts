import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildDockerImage, imageExists } from '../builder.js';
import { createDeploymentLogger } from '../logger.js';
import { docker } from '../docker.js';
import { prisma } from '../db.js';

describe('Docker Image Builder Pipeline', () => {
  const testImageTags: string[] = [];

  afterAll(async () => {
    // Clean up test images from local daemon
    for (const tag of testImageTags) {
      try {
        const img = docker.getImage(tag);
        await img.remove({ force: true });
      } catch {}
    }
  });

  it('builds a real Docker image with resource constraints and streams logs', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipyard-build-test-'));
    const commitSha = '1a2b3c4d5e6f7a8b9c0d';

    // Create real Project and Deployment in DB for logger FK integrity
    const project = await prisma.project.create({
      data: {
        name: 'Builder Test Project',
        slug: `builder-proj-${Date.now()}`,
        repoUrl: 'https://github.com/shipyard-demo/builder-test',
        user: {
          connectOrCreate: {
            where: { githubId: 'builder-user' },
            create: { githubId: 'builder-user', githubUsername: 'builder-dev' },
          },
        },
      },
    });

    const deployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: 'BUILDING',
        targetSlot: 'BLUE',
        commitSha,
        gitRef: 'refs/heads/main',
      },
    });

    const expectedTag = `shipyard/${project.id}:${commitSha.slice(0, 8)}`;
    testImageTags.push(expectedTag);

    try {
      // 1. Create a minimal valid Dockerfile
      const dockerfileContent = `
FROM alpine:3.19
RUN echo "Building Shipyard Image" > /test-build.txt
CMD ["cat", "/test-build.txt"]
`;
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), dockerfileContent);

      const logger = createDeploymentLogger(deployment.id);

      // Check image doesn't exist yet
      expect(await imageExists(expectedTag)).toBe(false);

      // 2. Execute build
      const imageTag = await buildDockerImage({
        projectId: project.id,
        commitSha,
        scratchDir: tempDir,
        logger,
      });

      expect(imageTag).toBe(expectedTag);

      // 3. Confirm image now exists in Docker daemon
      expect(await imageExists(expectedTag)).toBe(true);

      // 4. Inspect image metadata
      const img = docker.getImage(expectedTag);
      const inspect = await img.inspect();
      expect(inspect.RepoTags).toContain(expectedTag);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      await prisma.logLine.deleteMany({ where: { deploymentId: deployment.id } });
      await prisma.deployment.delete({ where: { id: deployment.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  }, 45000);
});
