/**
 * =============================================================================
 * Shipyard Dashboard API Client
 *
 * Types and fetch helpers for connecting the Next.js UI to the Express Control Plane API.
 * =============================================================================
 */

import { DeploymentStatus, DeploymentTrigger, Slot, LogStream } from '@shipyard/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface Project {
  id: string;
  userId?: string;
  name: string;
  slug: string;
  repoUrl: string;
  defaultBranch: string;
  port: number;
  healthCheckPath: string;
  activeSlot: Slot | null;
  activeDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
  envVars?: ProjectEnvVar[];
  deployments?: Deployment[];
  _count?: {
    deployments: number;
    envVars: number;
  };
}

export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  targetSlot: Slot;
  commitSha: string;
  commitMessage: string | null;
  gitRef: string;
  imageTag: string | null;
  containerId: string | null;
  errorMessage: string | null;
  rollbackFromDeploymentId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project?: {
    id: string;
    name: string;
    slug: string;
    activeDeploymentId: string | null;
    activeSlot: Slot | null;
  };
}

export interface ProjectEnvVar {
  id: string;
  projectId: string;
  key: string;
  value: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LogLine {
  id?: string;
  deploymentId: string;
  stream: LogStream;
  message: string;
  timestamp: string;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'no-store' as RequestCache,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({ error: res.statusText }))) as any;
    throw new Error(errorBody.message || errorBody.error || `HTTP error ${res.status}`);
  }

  return (await res.json()) as T;
}

export const api = {
  // Projects
  async getProjects(): Promise<{ projects: Project[] }> {
    return request('/api/projects');
  },

  async getProject(idOrSlug: string): Promise<{ project: Project }> {
    return request(`/api/projects/${idOrSlug}`);
  },

  async createProject(data: {
    name: string;
    slug?: string;
    repoUrl: string;
    defaultBranch?: string;
    port?: number;
    healthCheckPath?: string;
    envVars?: Array<{ key: string; value: string; isSecret?: boolean }>;
  }): Promise<{ project: Project }> {
    return request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteProject(id: string): Promise<{ message: string }> {
    return request(`/api/projects/${id}`, {
      method: 'DELETE',
    });
  },

  // Environment Variables
  async getEnvVars(projectId: string): Promise<{ envVars: ProjectEnvVar[] }> {
    return request(`/api/projects/${projectId}/env`);
  },

  async setEnvVar(
    projectId: string,
    data: { key: string; value: string; isSecret?: boolean }
  ): Promise<{ envVar: ProjectEnvVar }> {
    return request(`/api/projects/${projectId}/env`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteEnvVar(projectId: string, key: string): Promise<{ message: string }> {
    return request(`/api/projects/${projectId}/env/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  },

  // Deployments
  async getDeployments(
    projectId: string,
    page = 1,
    limit = 20
  ): Promise<{ deployments: Deployment[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    return request(`/api/projects/${projectId}/deployments?page=${page}&limit=${limit}`);
  },

  async getDeployment(id: string): Promise<{ deployment: Deployment }> {
    return request(`/api/deployments/${id}`);
  },

  async triggerDeploy(
    projectId: string,
    data?: { branch?: string; commitSha?: string }
  ): Promise<{ deployment: Deployment }> {
    return request(`/api/projects/${projectId}/deploy`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  async rollback(
    projectId: string,
    targetDeploymentId: string
  ): Promise<{ deployment: Deployment }> {
    return request(`/api/projects/${projectId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetDeploymentId }),
    });
  },

  async cancelDeployment(id: string): Promise<{ deployment: Deployment }> {
    return request(`/api/deployments/${id}/cancel`, {
      method: 'POST',
    });
  },

  getLogStreamUrl(deploymentId: string): string {
    return `${API_BASE}/api/deployments/${deploymentId}/logs/stream`;
  },
};
