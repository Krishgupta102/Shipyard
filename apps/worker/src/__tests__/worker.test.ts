import { describe, expect, it } from 'vitest';
import { deployJobDataSchema, getNextSlot, Slot, DeploymentTrigger } from '@shipyard/shared';

describe('Worker Deployment Pipeline Unit Tests', () => {
  it('validates incoming BullMQ deployment job payload', () => {
    const validJob = {
      deploymentId: 'dep-12345',
      projectId: 'proj-98765',
      targetSlot: Slot.BLUE,
      trigger: DeploymentTrigger.GITHUB_WEBHOOK,
      commitSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      gitRef: 'refs/heads/main',
    };

    const parsed = deployJobDataSchema.safeParse(validJob);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deploymentId).toBe('dep-12345');
      expect(parsed.data.targetSlot).toBe(Slot.BLUE);
    }
  });

  it('correctly calculates alternate slot for blue-green cutover', () => {
    expect(getNextSlot(null)).toBe(Slot.BLUE);
    expect(getNextSlot(Slot.BLUE)).toBe(Slot.GREEN);
    expect(getNextSlot(Slot.GREEN)).toBe(Slot.BLUE);
  });

  it('rejects malformed BullMQ job payload', () => {
    const invalidJob = {
      deploymentId: '', // empty
      projectId: 'proj-1',
      targetSlot: 'INVALID_SLOT',
    };

    const parsed = deployJobDataSchema.safeParse(invalidJob);
    expect(parsed.success).toBe(false);
  });
});
