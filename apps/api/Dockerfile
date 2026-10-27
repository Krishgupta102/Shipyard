# =============================================================================
# apps/api/Dockerfile
#
# Production image for the Shipyard Control Plane API.
# Build context: monorepo root (required for npm workspace resolution).
#
# Stages:
#   deps    — install ALL dependencies (needed to build shared & run prisma generate)
#   builder — compile TypeScript for shared + api, generate Prisma client
#   runner  — lean production image with only compiled JS + prod node_modules
#
# Build command (from monorepo root):
#   docker build -f apps/api/Dockerfile -t shipyard-api:latest .
#
# Required runtime environment variables (no defaults for secrets):
#   DATABASE_URL          postgresql://user:pass@host:5432/shipyard
#   REDIS_URL             redis://host:6379
#   GITHUB_WEBHOOK_SECRET <random 32-byte hex>
#   NODE_ENV              production
#   API_PORT              3001 (optional, defaults to 3001)
#   CORS_ORIGIN           https://your-dashboard-domain (optional, defaults to *)
# =============================================================================

# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /build

# openssl: required by Prisma's native query engine on musl/Alpine at generate time.
# libc6-compat: glibc compatibility shims for some npm native modules.
RUN apk add --no-cache openssl libc6-compat

# Copy manifests for all workspaces first (maximises Docker layer cache reuse).
# npm workspaces v7+ hoists everything to the root node_modules — no per-workspace
# node_modules directories are created, so only the root directory is needed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/api/package.json          ./apps/api/

# Install all dependencies (dev + prod) — needed for tsc and prisma generate.
RUN npm ci --workspace=packages/shared \
           --workspace=apps/api \
           --include-workspace-root

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache openssl libc6-compat

# Copy package manifests needed for npm workspaces
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/api/package.json          ./apps/api/

# Reuse the hoisted node_modules from deps stage
COPY --from=deps /build/node_modules ./node_modules

# Copy source
COPY tsconfig.base.json      ./
COPY packages/shared/        ./packages/shared/
COPY apps/api/               ./apps/api/

# 1. Build shared package (api depends on it via workspace symlink @shipyard/shared)
RUN npm run build --workspace=packages/shared

# 2. Generate Prisma client for the linux-musl (Alpine) binary target.
#    DATABASE_URL is NOT evaluated at generate time; only schema.prisma is read.
#    A dummy value prevents any startup env check from failing during generation.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm run db:generate --workspace=apps/api

# 3. Compile the API TypeScript
RUN npm run build --workspace=apps/api

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# openssl: Prisma query engine requires openssl at runtime on musl/Alpine.
RUN apk add --no-cache openssl libc6-compat \
 && addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S nodejs -G nodejs

# Copy manifests so npm resolves workspace symlinks correctly
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/api/package.json          ./apps/api/

# Install production-only dependencies; omit dev tools and test runners
RUN npm ci --workspace=packages/shared \
           --workspace=apps/api \
           --include-workspace-root \
           --omit=dev \
 && npm cache clean --force

# Copy compiled TypeScript output from builder
COPY --from=builder --chown=nodejs:nodejs /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=nodejs:nodejs /build/apps/api/dist        ./apps/api/dist

# Copy Prisma schema + generated client.
# The generated client lives in node_modules/.prisma/client (workspace-hoisted root).
# It must be present at runtime for PrismaClient to load the query engine binary.
COPY --from=builder --chown=nodejs:nodejs /build/apps/api/prisma      ./apps/api/prisma
COPY --from=builder --chown=nodejs:nodejs /build/node_modules/.prisma ./node_modules/.prisma

# The workspace symlink at node_modules/@shipyard/shared must point to the
# compiled package/shared directory we just copied above.
COPY --from=builder --chown=nodejs:nodejs /build/node_modules/@shipyard ./node_modules/@shipyard

USER nodejs

# Expose API port (configurable at runtime via API_PORT env var)
EXPOSE 3001

ENV NODE_ENV=production

# Health check — uses the built-in Node.js http module (no curl dependency).
# GET /health checks Postgres + Redis connectivity and returns HTTP 200 when healthy.
# start_period accounts for Prisma connection pool warm-up and Postgres startup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e " \
    const http = require('http'); \
    const req = http.get('http://localhost:' + (process.env.API_PORT || 3001) + '/health', (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.setTimeout(8000, () => { req.destroy(); process.exit(1); }); \
  "

CMD ["node", "apps/api/dist/index.js"]
