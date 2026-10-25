import { describe, expect, it } from 'vitest';
import {
  createEnvVarSchema,
  createProjectSchema,
  rollbackRequestSchema,
} from '../schemas.js';

describe('Shared Zod Schemas', () => {
  describe('createProjectSchema', () => {
    it('validates a correct project payload', () => {
      const input = {
        name: 'My Sample App',
        slug: 'my-sample-app',
        repoUrl: 'https://github.com/my-org/my-sample-app',
        defaultBranch: 'main',
        port: 8080,
        healthCheckPath: '/api/health',
      };

      const result = createProjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
        expect(result.data.healthCheckPath).toBe('/api/health');
      }
    });

    it('applies default port (3000) and default healthCheckPath (/health)', () => {
      const input = {
        name: 'Minimal App',
        slug: 'minimal-app',
        repoUrl: 'https://github.com/org/repo',
      };

      const result = createProjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(3000);
        expect(result.data.healthCheckPath).toBe('/health');
        expect(result.data.defaultBranch).toBe('main');
      }
    });

    it('rejects invalid slugs (uppercase, spaces, special chars, leading/trailing hyphen)', () => {
      const invalidSlugs = ['My-App', 'app 1', 'app_one', '-lead-hyphen', 'trail-hyphen-', 'ab'];
      for (const slug of invalidSlugs) {
        const result = createProjectSchema.safeParse({
          name: 'App',
          slug,
          repoUrl: 'https://github.com/org/repo',
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects invalid repo URLs', () => {
      const result = createProjectSchema.safeParse({
        name: 'App',
        slug: 'valid-slug',
        repoUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('rejects healthCheckPath without leading slash', () => {
      const result = createProjectSchema.safeParse({
        name: 'App',
        slug: 'valid-slug',
        repoUrl: 'https://github.com/org/repo',
        healthCheckPath: 'health',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createEnvVarSchema', () => {
    it('accepts valid uppercase environment variable keys', () => {
      const valid = [
        { key: 'DATABASE_URL', value: 'postgres://...' },
        { key: 'API_KEY', value: 'secret' },
        { key: '_PRIVATE_CONFIG', value: 'val' },
        { key: 'PORT', value: '3000' },
      ];

      for (const item of valid) {
        const result = createEnvVarSchema.safeParse(item);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid keys (lowercase, spaces, hyphens, numbers first)', () => {
      const invalid = ['lowercase', 'DATABASE-URL', '123_NUMBER', 'SPACE KEY'];
      for (const key of invalid) {
        const result = createEnvVarSchema.safeParse({ key, value: 'test' });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('rollbackRequestSchema', () => {
    it('validates a target deployment ID', () => {
      const result = rollbackRequestSchema.safeParse({ targetDeploymentId: 'cuid12345' });
      expect(result.success).toBe(true);
    });

    it('rejects empty target deployment ID', () => {
      const result = rollbackRequestSchema.safeParse({ targetDeploymentId: '  ' });
      expect(result.success).toBe(false);
    });
  });
});
