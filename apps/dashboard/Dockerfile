# =============================================================================
# apps/dashboard/Dockerfile
#
# Production image for the Shipyard Next.js App Router Dashboard.
# Build context: monorepo root (required for npm workspace resolution and
# shared package access).
#
# Stages:
#   deps    — install ALL workspace dependencies
#   builder — build the shared package, then next build (produces standalone)
#   runner  — minimal image running .next/standalone/apps/dashboard/server.js
#
# Build command (from monorepo root):
#   docker build -f apps/dashboard/Dockerfile -t shipyard-dashboard:latest .
#
# ── Build-time vs Runtime API URL ────────────────────────────────────────────
# NEXT_PUBLIC_API_URL is a NEXT_PUBLIC_ variable, which means Next.js inlines
# its value into client-side JavaScript bundles AT BUILD TIME via static
# replacement. It is NOT available as a runtime environment variable.
#
# Consequence: you must provide the correct production API URL when building
# the image. If the API is at a different URL than when the image was built,
# the dashboard will continue to point to the build-time URL.
#
# How to handle this correctly:
#
#   Option A (recommended for single-host deploys where API URL is fixed):
#     Pass NEXT_PUBLIC_API_URL as a build argument:
#       docker build \
#         --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com \
#         -f apps/dashboard/Dockerfile -t shipyard-dashboard:latest .
#
#   Option B (URL unknown at build time — future enhancement):
#     Implement a server-side API proxy route (Next.js Route Handlers) and
#     let the client always call /api/* on the same origin. The server-side
#     fetch uses INTERNAL_API_URL (a true runtime env var). This avoids the
#     NEXT_PUBLIC_ bake-in limitation entirely but requires application changes.
#
#   Default: If NEXT_PUBLIC_API_URL is unset at build time, the dashboard
#   falls back to 'http://localhost:3001' (see src/lib/api.ts) which works
#   for local development but will fail in production.
#
# Required runtime environment variables:
#   NODE_ENV             production (set in image)
#   PORT                 3000 (optional, Next.js standalone default)
#   HOSTNAME             0.0.0.0 (set in image so container accepts external connections)
#
# Optional build argument:
#   NEXT_PUBLIC_API_URL  URL the browser will use to reach the API
#                        (e.g. https://api.your-domain.com or http://api:3001
#                        when on the same Docker network)
# =============================================================================

# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /build

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/dashboard/package.json    ./apps/dashboard/

RUN npm ci --workspace=packages/shared \
           --workspace=apps/dashboard \
           --include-workspace-root

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/dashboard/package.json    ./apps/dashboard/

COPY --from=deps /build/node_modules ./node_modules

COPY tsconfig.base.json  ./
COPY packages/shared/    ./packages/shared/
COPY apps/dashboard/     ./apps/dashboard/

# 1. Build shared package (dashboard imports @shipyard/shared for enums/types)
RUN npm run build --workspace=packages/shared

# 2. Accept optional build-time API URL (see header comment)
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Disable Next.js telemetry in CI/build environments
ENV NEXT_TELEMETRY_DISABLED=1

# 3. Build the Next.js app (produces .next/standalone thanks to next.config.js)
RUN npm run build --workspace=apps/dashboard

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache libc6-compat \
 && addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S nextjs -G nodejs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 0.0.0.0 is required so the standalone server binds on all interfaces
# inside the container, not just localhost.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy the self-contained Next.js standalone server.
# In a monorepo setup, Next.js standalone preserves the folder structure.
COPY --from=builder --chown=nextjs:nodejs /build/apps/dashboard/.next/standalone ./

# Copy static assets (CSS, JS chunks generated at build time).
# In a monorepo standalone server, static assets are located under apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /build/apps/dashboard/.next/static ./apps/dashboard/.next/static

USER nextjs

EXPOSE 3000

# Health check — Next.js standalone server serves a basic 200 on the root path.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e " \
    const http = require('http'); \
    const port = process.env.PORT || 3000; \
    const req = http.get('http://localhost:' + port + '/', (res) => { \
      process.exit(res.statusCode < 500 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.setTimeout(8000, () => { req.destroy(); process.exit(1); }); \
  "

# In a monorepo standalone build, the server entry point is at apps/dashboard/server.js
CMD ["node", "apps/dashboard/server.js"]
