/**
 * =============================================================================
 * Shipyard Shared TypeScript Types & DTOs
 * =============================================================================
 */

import { z } from 'zod';
import {
  createEnvVarSchema,
  createEnvVarsBatchSchema,
  createProjectSchema,
  deployJobDataSchema,
  rollbackRequestSchema,
  triggerDeploymentSchema,
  updateProjectSchema,
} from './schemas.js';
import { DeploymentStatus, DeploymentTrigger, LogStream, Slot } from './enums.js';

// Schema-inferred input types
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateEnvVarInput = z.infer<typeof createEnvVarSchema>;
export type CreateEnvVarsBatchInput = z.infer<typeof createEnvVarsBatchSchema>;
export type TriggerDeploymentInput = z.infer<typeof triggerDeploymentSchema>;
export type RollbackRequestInput = z.infer<typeof rollbackRequestSchema>;
export type DeployJobData = z.infer<typeof deployJobDataSchema>;

/**
 * Clean Project Data Transfer Object (DTO) for API responses.
 */
export interface ProjectDTO {
  id: string;
  name: string;
  slug: string;
  repoUrl: string;
  defaultBranch: string;
  buildCommand?: string | null;
  runCommand?: string | null;
  port: number;
  healthCheckPath: string;
  activeDeploymentId?: string | null;
  activeSlot?: Slot | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Clean Deployment Data Transfer Object (DTO) for API responses.
 */
export interface DeploymentDTO {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  targetSlot: Slot;
  commitSha: string;
  commitMessage?: string | null;
  gitRef: string;
  imageTag?: string | null;
  rollbackFromDeploymentId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Clean LogLine DTO for SSE streaming and API responses.
 */
export interface LogLineDTO {
  id: string;
  deploymentId: string;
  stream: LogStream;
  message: string;
  timestamp: string;
}
