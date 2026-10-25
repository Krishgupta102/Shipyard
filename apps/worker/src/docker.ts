/**
 * =============================================================================
 * Docker Engine API Client (dockerode)
 *
 * Provides typed access to the local Docker daemon Unix socket.
 * Single-owner security boundary: only the worker process has socket access (ADR-003).
 * =============================================================================
 */

import Docker from 'dockerode';
import { config } from './config.js';

export const docker = new Docker({
  socketPath: config.dockerSocketPath,
});
