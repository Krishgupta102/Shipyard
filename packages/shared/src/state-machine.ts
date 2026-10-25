/**
 * =============================================================================
 * Deployment State Machine
 *
 * Enforces valid lifecycle transitions for deployments.
 * Centralizing state machine logic here ensures that the API, Worker, and
 * background reconciliation workers all follow identical transition rules.
 *
 * See docs/DECISIONS.md ADR-002:
 * "Deployment.status records the immutable lifecycle of one pipeline execution:
 *  QUEUED -> BUILDING -> DEPLOYING -> SUCCESS | FAILED | CANCELLED"
 * =============================================================================
 */

import { DeploymentStatus, Slot } from './enums.js';

/**
 * Custom error thrown whenever an invalid state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  public readonly from: DeploymentStatus;
  public readonly to: DeploymentStatus;

  constructor(from: DeploymentStatus, to: DeploymentStatus) {
    super(`Cannot transition deployment from '${from}' to '${to}'.`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
    // Maintain prototype chain for instanceof checks
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

/**
 * Explicit map of allowed transitions for each DeploymentStatus.
 *
 * Lifecycle Rules:
 * 1. QUEUED can proceed to BUILDING (worker picked up the job) or CANCELLED (user cancelled before start).
 * 2. BUILDING can proceed to DEPLOYING (Docker image built successfully), FAILED (build error/timeout),
 *    or CANCELLED (user cancelled during build).
 * 3. DEPLOYING can proceed to SUCCESS (health checks passed & Traefik verified) or FAILED (health check failed/route verification failed).
 * 4. SUCCESS, FAILED, CANCELLED are terminal states: no further transitions are permitted.
 */
export const ALLOWED_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  [DeploymentStatus.QUEUED]: [
    DeploymentStatus.BUILDING,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.BUILDING]: [
    DeploymentStatus.DEPLOYING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.DEPLOYING]: [
    DeploymentStatus.SUCCESS,
    DeploymentStatus.FAILED,
  ],
  [DeploymentStatus.SUCCESS]: [],
  [DeploymentStatus.FAILED]: [],
  [DeploymentStatus.CANCELLED]: [],
} as const;

/**
 * Returns true if the status is a terminal state (no further transitions permitted).
 */
export function isTerminalStatus(status: DeploymentStatus): boolean {
  return (
    status === DeploymentStatus.SUCCESS ||
    status === DeploymentStatus.FAILED ||
    status === DeploymentStatus.CANCELLED
  );
}

/**
 * Returns true if a transition from `from` to `to` is legally permitted.
 */
export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Asserts that a transition from `from` to `to` is legally permitted.
 * Throws InvalidStateTransitionError if the transition is prohibited.
 */
export function assertCanTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * Determines the target slot for the next deployment given the currently active slot.
 *
 * In blue-green deployments:
 * - If currently active slot is BLUE  -> next target slot is GREEN.
 * - If currently active slot is GREEN -> next target slot is BLUE.
 * - If no slot is active (first deployment for the project) -> defaults to BLUE.
 *
 * @param activeSlot Currently live slot serving traffic (Project.activeSlot)
 * @returns The target slot to spin up the next deployment into
 */
export function getNextSlot(activeSlot: Slot | null | undefined): Slot {
  if (activeSlot === Slot.BLUE) {
    return Slot.GREEN;
  }
  return Slot.BLUE;
}
