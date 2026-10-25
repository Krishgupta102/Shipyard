/**
 * =============================================================================
 * Shipyard Shared Enums
 *
 * These enums are shared across the API, Worker, and Dashboard.
 * They mirror the PostgreSQL/Prisma enum definitions to ensure type-safety
 * across all network boundaries and service communication.
 * =============================================================================
 */

/**
 * DeploymentStatus represents the immutable lifecycle progression of a single deployment.
 *
 * Crucial Design Principle (ADR-002):
 * - Deployment.status records whether this specific pipeline run succeeded or failed.
 * - Project.activeDeploymentId records whether this deployment is serving live traffic.
 *
 * Once a terminal state (SUCCESS, FAILED, CANCELLED) is reached, Deployment.status NEVER changes.
 */
export const DeploymentStatus = {
  QUEUED: 'QUEUED',
  BUILDING: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

/**
 * Blue-Green deployment slots.
 *
 * - BLUE: Application container named `shipyard-<projectId>-blue`
 * - GREEN: Application container named `shipyard-<projectId>-green`
 *
 * At any point in time, one slot is ACTIVE (serving live traffic via Traefik routing),
 * while the other is INACTIVE/IDLE (available for warming up and testing the next release).
 */
export const Slot = {
  BLUE: 'BLUE',
  GREEN: 'GREEN',
} as const;

export type Slot = (typeof Slot)[keyof typeof Slot];

/**
 * The event or actor that triggered the deployment.
 *
 * - MANUAL: Initiated by a user clicking "Deploy" in dashboard or calling POST /api/deployments
 * - GITHUB_WEBHOOK: Initiated automatically by a push event to the repository's default branch
 * - ROLLBACK: Initiated by user rolling back to a previously successful deployment image
 */
export const DeploymentTrigger = {
  MANUAL: 'MANUAL',
  GITHUB_WEBHOOK: 'GITHUB_WEBHOOK',
  ROLLBACK: 'ROLLBACK',
} as const;

export type DeploymentTrigger = (typeof DeploymentTrigger)[keyof typeof DeploymentTrigger];

/**
 * Category for logs generated during build and deploy execution.
 *
 * - STDOUT: Standard output from Docker build, container startup, or healthcheck
 * - STDERR: Standard error output from Docker build or failed container operations
 * - SYSTEM: Platform control-plane events (e.g. "Starting build", "Switching Traefik route")
 */
export const LogStream = {
  STDOUT: 'STDOUT',
  STDERR: 'STDERR',
  SYSTEM: 'SYSTEM',
} as const;

export type LogStream = (typeof LogStream)[keyof typeof LogStream];
