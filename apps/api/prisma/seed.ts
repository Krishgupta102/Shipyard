/**
 * =============================================================================
 * Shipyard Database Seed Script
 *
 * Populates PostgreSQL with realistic demonstration data for local development.
 * Demonstrates ADR-002 state separation:
 * 1. Deployment 1 (v1) -> SUCCESS (Slot BLUE)
 * 2. Deployment 2 (v2) -> FAILED (Slot GREEN) - health check failed, traffic never touched it
 * 3. Deployment 3 (v3) -> SUCCESS (Slot GREEN) - Rollback to v1 image, health checks passed,
 *    and Project.activeDeploymentId updated to v3 with activeSlot = GREEN.
 * =============================================================================
 */

import { PrismaClient, DeploymentStatus, DeploymentTrigger, Slot, LogStream } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Shipyard database seeding...');

  // Clean existing records in reverse dependency order
  await prisma.logLine.deleteMany();
  await prisma.projectEnvVar.deleteMany();
  // Clear active deployment references before deleting deployments
  await prisma.project.updateMany({ data: { activeDeploymentId: null } });
  await prisma.deployment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Cleaned existing database tables.');

  // 1. Create Demo User
  const user = await prisma.user.create({
    data: {
      githubId: '98765432',
      githubUsername: 'dev-demo',
      email: 'demo@shipyard.local',
      avatarUrl: 'https://avatars.githubusercontent.com/u/98765432?v=4',
    },
  });
  console.log(`👤 Created user: ${user.githubUsername} (${user.id})`);

  // 2. Create Sample Project
  const project = await prisma.project.create({
    data: {
      name: 'Express Hello World',
      slug: 'express-hello',
      repoUrl: 'https://github.com/shipyard-demo/express-hello',
      defaultBranch: 'main',
      port: 3000,
      healthCheckPath: '/health',
      userId: user.id,
    },
  });
  console.log(`📦 Created project: ${project.name} (slug: ${project.slug})`);

  // 3. Add Project Environment Variables
  await prisma.projectEnvVar.createMany({
    data: [
      {
        projectId: project.id,
        key: 'NODE_ENV',
        value: 'production',
        isSecret: false,
      },
      {
        projectId: project.id,
        key: 'PORT',
        value: '3000',
        isSecret: false,
      },
      {
        projectId: project.id,
        key: 'API_SECRET_KEY',
        value: 'sk_live_sample_secret_key_shipyard',
        isSecret: true,
      },
    ],
  });
  console.log('🔑 Added environment variables.');

  // 4. Deployment 1 (v1 - Initial successful deploy to BLUE)
  const d1Started = new Date(Date.now() - 1000 * 60 * 30); // 30m ago
  const d1Finished = new Date(Date.now() - 1000 * 60 * 28); // 28m ago

  const dep1 = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.SUCCESS,
      trigger: DeploymentTrigger.MANUAL,
      targetSlot: Slot.BLUE,
      commitSha: '7f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
      commitMessage: 'feat: initial express server with /health endpoint',
      gitRef: 'refs/heads/main',
      imageTag: `shipyard/${project.id}:7f9a1b2`,
      startedAt: d1Started,
      finishedAt: d1Finished,
      logLines: {
        create: [
          { stream: LogStream.SYSTEM, message: 'Deployment queued', timestamp: d1Started },
          { stream: LogStream.SYSTEM, message: 'Cloning repository refs/heads/main...', timestamp: new Date(d1Started.getTime() + 1000) },
          { stream: LogStream.STDOUT, message: 'Step 1/5 : FROM node:20-alpine', timestamp: new Date(d1Started.getTime() + 5000) },
          { stream: LogStream.STDOUT, message: 'Step 5/5 : CMD ["npm", "start"]', timestamp: new Date(d1Started.getTime() + 25000) },
          { stream: LogStream.SYSTEM, message: 'Starting container shipyard-express-hello-blue...', timestamp: new Date(d1Started.getTime() + 30000) },
          { stream: LogStream.SYSTEM, message: 'Running direct healthcheck GET http://127.0.0.1:3000/health -> 200 OK', timestamp: new Date(d1Started.getTime() + 35000) },
          { stream: LogStream.SYSTEM, message: 'Atomic file rename for Traefik dynamic config succeeded', timestamp: new Date(d1Started.getTime() + 37000) },
          { stream: LogStream.SYSTEM, message: 'Traefik ingress route verified. Deployment SUCCESS.', timestamp: d1Finished },
        ],
      },
    },
  });

  // 5. Deployment 2 (v2 - Failed deploy to GREEN, bad healthcheck)
  const d2Started = new Date(Date.now() - 1000 * 60 * 15); // 15m ago
  const d2Finished = new Date(Date.now() - 1000 * 60 * 13); // 13m ago

  const dep2 = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.FAILED,
      trigger: DeploymentTrigger.GITHUB_WEBHOOK,
      targetSlot: Slot.GREEN,
      commitSha: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
      commitMessage: 'fix: broken database connection string',
      gitRef: 'refs/heads/main',
      imageTag: `shipyard/${project.id}:9a8b7c6`,
      startedAt: d2Started,
      finishedAt: d2Finished,
      failureReason: 'Healthcheck timed out after 30s: GET /health returned 500 Internal Server Error',
      logLines: {
        create: [
          { stream: LogStream.SYSTEM, message: 'Deployment triggered by GitHub webhook push', timestamp: d2Started },
          { stream: LogStream.STDOUT, message: 'Step 1/5 : FROM node:20-alpine', timestamp: new Date(d2Started.getTime() + 5000) },
          { stream: LogStream.SYSTEM, message: 'Starting container shipyard-express-hello-green...', timestamp: new Date(d2Started.getTime() + 25000) },
          { stream: LogStream.STDERR, message: 'Error: Cannot connect to database at localhost:5432', timestamp: new Date(d2Started.getTime() + 27000) },
          { stream: LogStream.STDERR, message: 'Healthcheck failed: received status 500', timestamp: new Date(d2Started.getTime() + 30000) },
          { stream: LogStream.SYSTEM, message: 'Health check failed. Container stopped. Live traffic remains on Slot BLUE.', timestamp: d2Finished },
        ],
      },
    },
  });

  // 6. Deployment 3 (v3 - Manual Rollback to v1 image, deployed to GREEN slot)
  const d3Started = new Date(Date.now() - 1000 * 60 * 5); // 5m ago
  const d3Finished = new Date(Date.now() - 1000 * 60 * 3); // 3m ago

  const dep3 = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.SUCCESS,
      trigger: DeploymentTrigger.ROLLBACK,
      targetSlot: Slot.GREEN,
      commitSha: '7f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
      commitMessage: 'Rollback to deployment ' + dep1.id.slice(0, 8),
      gitRef: 'refs/heads/main',
      imageTag: `shipyard/${project.id}:7f9a1b2`,
      rollbackFromDeploymentId: dep1.id,
      startedAt: d3Started,
      finishedAt: d3Finished,
      logLines: {
        create: [
          { stream: LogStream.SYSTEM, message: `Rollback requested to image tag shipyard/${project.id}:7f9a1b2`, timestamp: d3Started },
          { stream: LogStream.SYSTEM, message: 'Starting container shipyard-express-hello-green with existing image...', timestamp: new Date(d3Started.getTime() + 2000) },
          { stream: LogStream.SYSTEM, message: 'Health check GET /health passed (HTTP 200 OK)', timestamp: new Date(d3Started.getTime() + 5000) },
          { stream: LogStream.SYSTEM, message: 'Atomic file rename for Traefik dynamic config succeeded', timestamp: new Date(d3Started.getTime() + 7000) },
          { stream: LogStream.SYSTEM, message: 'Traefik ingress route verified. Draining blue container.', timestamp: d3Finished },
        ],
      },
    },
  });

  // 7. Update Project active deployment to dep3 (Slot GREEN)
  await prisma.project.update({
    where: { id: project.id },
    data: {
      activeDeploymentId: dep3.id,
      activeSlot: Slot.GREEN,
    },
  });

  console.log(`🚀 Updated project active deployment to ${dep3.id} (Slot: GREEN)`);
  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
