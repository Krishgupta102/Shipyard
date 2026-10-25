/**
 * =============================================================================
 * Shipyard Shared Zod Schemas
 *
 * Centralized request validation schemas for API inputs, webhooks, and forms.
 * =============================================================================
 */

import { z } from 'zod';
import { DeploymentStatus, DeploymentTrigger, LogStream, Slot } from './enums.js';

/**
 * Project Slug Rules:
 * - 3 to 63 characters (RFC 1123 hostname label limit for subdomains)
 * - Lowercase alphanumeric and hyphens only
 * - Cannot start or end with a hyphen
 */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Environment Variable Key Rules:
 * - Starts with an uppercase ASCII letter or underscore
 * - Followed by uppercase ASCII letters, digits, or underscores
 * - Example: DATABASE_URL, API_KEY, PORT_8080
 */
export const ENV_VAR_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

// ── Enums as Zod Schemas ──────────────────────────────────────────────────────

export const deploymentStatusSchema = z.enum([
  DeploymentStatus.QUEUED,
  DeploymentStatus.BUILDING,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.CANCELLED,
]);

export const slotSchema = z.enum([
  Slot.BLUE,
  Slot.GREEN,
]);

export const deploymentTriggerSchema = z.enum([
  DeploymentTrigger.MANUAL,
  DeploymentTrigger.GITHUB_WEBHOOK,
  DeploymentTrigger.ROLLBACK,
]);

export const logStreamSchema = z.enum([
  LogStream.STDOUT,
  LogStream.STDERR,
  LogStream.SYSTEM,
]);

// ── Project Schemas ──────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(100, 'Project name cannot exceed 100 characters'),

  slug: z
    .string()
    .trim()
    .min(3, 'Slug must be at least 3 characters')
    .max(63, 'Slug cannot exceed 63 characters')
    .regex(
      SLUG_REGEX,
      'Slug must contain only lowercase alphanumeric characters and hyphens, and cannot start or end with a hyphen'
    ),

  repoUrl: z
    .string()
    .trim()
    .url('Must be a valid repository URL')
    .refine(
      (url) => url.startsWith('https://github.com/') || url.endsWith('.git'),
      'Must be a valid GitHub or Git repository URL'
    ),

  defaultBranch: z
    .string()
    .trim()
    .min(1, 'Default branch is required')
    .default('main'),

  buildCommand: z.string().trim().optional(),
  runCommand: z.string().trim().optional(),

  port: z.coerce
    .number()
    .int()
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535')
    .default(3000),

  healthCheckPath: z
    .string()
    .trim()
    .regex(/^\//, 'Health check path must start with a forward slash (e.g. /health)')
    .default('/health'),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .omit({ slug: true });

// ── Environment Variable Schemas ──────────────────────────────────────────────

export const createEnvVarSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      ENV_VAR_KEY_REGEX,
      'Environment variable key must be uppercase alphanumeric with underscores (e.g. DATABASE_URL)'
    ),
  value: z.string(),
  isSecret: z.boolean().default(true),
});

export const createEnvVarsBatchSchema = z.object({
  variables: z.array(createEnvVarSchema).min(1, 'At least one environment variable is required'),
});

// ── Deployment Action Schemas ──────────────────────────────────────────────────

export const triggerDeploymentSchema = z.object({
  branch: z.string().trim().optional(),
  commitSha: z.string().trim().optional(),
});

export const rollbackRequestSchema = z.object({
  targetDeploymentId: z
    .string()
    .trim()
    .min(1, 'Target deployment ID is required'),
});

// ── BullMQ Build & Deploy Job Data Schema ──────────────────────────────────────

export const deployJobDataSchema = z.object({
  deploymentId: z.string().min(1),
  projectId: z.string().min(1),
  targetSlot: slotSchema,
  trigger: deploymentTriggerSchema,
  commitSha: z.string().min(1),
  gitRef: z.string().min(1),
  rollbackFromDeploymentId: z.string().optional(),
});
