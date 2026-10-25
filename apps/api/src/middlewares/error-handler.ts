/**
 * =============================================================================
 * Centralized Express Error Handling Middleware
 *
 * Formats errors into structured, predictable JSON responses:
 * - 400 Bad Request for Zod validation errors
 * - 409 Conflict for invalid state machine transitions or duplicate keys
 * - 404 Not Found for missing database records
 * - 500 Internal Server Error for unhandled exceptions
 * =============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { InvalidStateTransitionError } from '@shipyard/shared';
import { Prisma } from '@prisma/client';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod Validation Errors
  if (err instanceof ZodError || (err as any)?.name === 'ZodError') {
    const zodErr = err as ZodError;
    const issues = zodErr.issues || (zodErr as unknown as { errors?: typeof zodErr.issues }).errors || [];
    res.status(400).json({
      error: 'Validation failed',
      details: issues.map((e) => ({
        path: Array.isArray(e.path) ? e.path.join('.') : String(e.path),
        message: e.message,
      })),
    });
    return;
  }

  // 2. Deployment State Machine Violations (ADR-002)
  if (err instanceof InvalidStateTransitionError || (err as any)?.name === 'InvalidStateTransitionError') {
    const stateErr = err as InvalidStateTransitionError;
    res.status(409).json({
      error: 'Illegal state transition',
      message: stateErr.message,
      from: stateErr.from,
      to: stateErr.to,
    });
    return;
  }

  // 3. Prisma Known Request Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta?.target as string[]).join(', ')
        : (err.meta?.target as string) || 'unique field';
      res.status(409).json({
        error: 'Conflict',
        message: `A record with this ${target} already exists.`,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested record was not found.',
      });
      return;
    }
  }

  // 4. Fallback: Internal Server Error
  console.error('Unhandled server error:', err);
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : message,
  });
}
