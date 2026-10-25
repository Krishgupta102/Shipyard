import { describe, expect, it } from 'vitest';
import { DeploymentStatus, Slot } from '../enums.js';
import {
  ALLOWED_TRANSITIONS,
  assertCanTransition,
  canTransition,
  getNextSlot,
  InvalidStateTransitionError,
  isTerminalStatus,
} from '../state-machine.js';

describe('Deployment State Machine', () => {
  describe('ALLOWED_TRANSITIONS rules', () => {
    it('defines transitions for every DeploymentStatus', () => {
      const allStatuses = Object.values(DeploymentStatus);
      for (const status of allStatuses) {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true);
      }
    });

    it('allows valid transitions from QUEUED', () => {
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING)).toBe(true);
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.CANCELLED)).toBe(true);
      // Forbidden
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.DEPLOYING)).toBe(false);
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.SUCCESS)).toBe(false);
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.FAILED)).toBe(false);
    });

    it('allows valid transitions from BUILDING', () => {
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)).toBe(true);
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.FAILED)).toBe(true);
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.CANCELLED)).toBe(true);
      // Forbidden
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.QUEUED)).toBe(false);
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.SUCCESS)).toBe(false);
    });

    it('allows valid transitions from DEPLOYING', () => {
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.SUCCESS)).toBe(true);
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED)).toBe(true);
      // Forbidden
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.QUEUED)).toBe(false);
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.BUILDING)).toBe(false);
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.CANCELLED)).toBe(false);
    });

    it('forbids ANY transition out of SUCCESS (terminal state)', () => {
      const allStatuses = Object.values(DeploymentStatus);
      for (const target of allStatuses) {
        expect(canTransition(DeploymentStatus.SUCCESS, target)).toBe(false);
      }
    });

    it('forbids ANY transition out of FAILED (terminal state)', () => {
      const allStatuses = Object.values(DeploymentStatus);
      for (const target of allStatuses) {
        expect(canTransition(DeploymentStatus.FAILED, target)).toBe(false);
      }
    });

    it('forbids ANY transition out of CANCELLED (terminal state)', () => {
      const allStatuses = Object.values(DeploymentStatus);
      for (const target of allStatuses) {
        expect(canTransition(DeploymentStatus.CANCELLED, target)).toBe(false);
      }
    });
  });

  describe('isTerminalStatus', () => {
    it('identifies SUCCESS, FAILED, CANCELLED as terminal', () => {
      expect(isTerminalStatus(DeploymentStatus.SUCCESS)).toBe(true);
      expect(isTerminalStatus(DeploymentStatus.FAILED)).toBe(true);
      expect(isTerminalStatus(DeploymentStatus.CANCELLED)).toBe(true);
    });

    it('identifies QUEUED, BUILDING, DEPLOYING as non-terminal', () => {
      expect(isTerminalStatus(DeploymentStatus.QUEUED)).toBe(false);
      expect(isTerminalStatus(DeploymentStatus.BUILDING)).toBe(false);
      expect(isTerminalStatus(DeploymentStatus.DEPLOYING)).toBe(false);
    });
  });

  describe('assertCanTransition', () => {
    it('does not throw on legal transitions', () => {
      expect(() => {
        assertCanTransition(DeploymentStatus.QUEUED, DeploymentStatus.BUILDING);
      }).not.toThrow();

      expect(() => {
        assertCanTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING);
      }).not.toThrow();

      expect(() => {
        assertCanTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.SUCCESS);
      }).not.toThrow();
    });

    it('throws InvalidStateTransitionError with descriptive message on illegal transitions', () => {
      expect(() => {
        assertCanTransition(DeploymentStatus.SUCCESS, DeploymentStatus.BUILDING);
      }).toThrow(InvalidStateTransitionError);

      try {
        assertCanTransition(DeploymentStatus.SUCCESS, DeploymentStatus.BUILDING);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidStateTransitionError);
        const transitionErr = err as InvalidStateTransitionError;
        expect(transitionErr.from).toBe(DeploymentStatus.SUCCESS);
        expect(transitionErr.to).toBe(DeploymentStatus.BUILDING);
        expect(transitionErr.message).toContain("Cannot transition deployment from 'SUCCESS' to 'BUILDING'");
      }
    });
  });

  describe('getNextSlot', () => {
    it('returns BLUE when activeSlot is null or undefined (initial deployment)', () => {
      expect(getNextSlot(null)).toBe(Slot.BLUE);
      expect(getNextSlot(undefined)).toBe(Slot.BLUE);
    });

    it('returns GREEN when activeSlot is BLUE', () => {
      expect(getNextSlot(Slot.BLUE)).toBe(Slot.GREEN);
    });

    it('returns BLUE when activeSlot is GREEN', () => {
      expect(getNextSlot(Slot.GREEN)).toBe(Slot.BLUE);
    });
  });
});
