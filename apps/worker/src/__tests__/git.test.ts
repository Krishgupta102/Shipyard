import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  cleanScratchDir,
  createBuildContextTar,
  prepareScratchDir,
  verifyDockerfile,
} from '../git.js';
import simpleGit from 'simple-git';

describe('Worker Git & Scratch Directory Utilities', () => {
  it('creates and cleans scratch directories idempotently', async () => {
    const deploymentId = `test-dep-${Date.now()}`;
    const scratchDir = await prepareScratchDir(deploymentId);

    const exists = await fs.stat(scratchDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await cleanScratchDir(scratchDir);
    const existsAfter = await fs.stat(scratchDir).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });

  it('verifyDockerfile throws when Dockerfile is missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-no-dockerfile-'));
    try {
      await expect(verifyDockerfile(tempDir)).rejects.toThrow('Dockerfile not found');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('verifyDockerfile passes when Dockerfile exists in root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-with-dockerfile-'));
    try {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), 'FROM alpine:latest\n');
      await expect(verifyDockerfile(tempDir)).resolves.not.toThrow();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('createBuildContextTar packages directory into a readable tar stream', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-tar-'));
    try {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), 'FROM alpine:latest\n');
      await fs.writeFile(path.join(tempDir, 'index.js'), 'console.log("hello");\n');

      const tarStream = createBuildContextTar(tempDir);
      expect(tarStream).toBeDefined();
      expect(typeof tarStream.pipe).toBe('function');

      // Fully consume the stream before cleaning up temp directory
      await new Promise<void>((resolve, reject) => {
        tarStream.on('end', resolve);
        tarStream.on('error', reject);
        tarStream.resume();
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('checks out the exact specified historical commit SHA, not branch HEAD', async () => {
    const originDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-origin-'));
    const destDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-dest-'));
    const gitOrigin = simpleGit(originDir);

    try {
      await gitOrigin.init();
      await gitOrigin.addConfig('user.name', 'Test User');
      await gitOrigin.addConfig('user.email', 'test@example.com');

      // Commit 1 (older historical commit)
      await fs.writeFile(path.join(originDir, 'version.txt'), 'commit 1 content\n');
      await fs.writeFile(path.join(originDir, 'Dockerfile'), 'FROM alpine:latest\n');
      await gitOrigin.add('.');
      await gitOrigin.commit('commit 1');
      const log1 = await gitOrigin.log({ maxCount: 1 });
      const c1Sha = log1.latest!.hash;

      // Commit 2 (newer commit on main branch)
      await fs.writeFile(path.join(originDir, 'version.txt'), 'commit 2 content\n');
      await gitOrigin.add('.');
      await gitOrigin.commit('commit 2');

      const mockLogger = {
        log: async () => {},
        logSystem: async () => {},
        logStdout: async () => {},
        logStderr: async () => {},
        close: async () => {},
      };

      // Specifically request older commit c1Sha
      const { cloneAndCheckout } = await import('../git.js');
      const result = await cloneAndCheckout(originDir, 'refs/heads/master', c1Sha, destDir, mockLogger);

      expect(result.resolvedSha).toBe(c1Sha);

      // Verify the workspace file content matches commit 1, NOT commit 2
      const checkedOutContent = await fs.readFile(path.join(destDir, 'version.txt'), 'utf8');
      expect(checkedOutContent.trim()).toBe('commit 1 content');
    } finally {
      await fs.rm(originDir, { recursive: true, force: true });
      await fs.rm(destDir, { recursive: true, force: true });
    }
  });
});
