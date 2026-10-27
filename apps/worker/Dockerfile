# =============================================================================
# apps/worker/Dockerfile
#
# Production image for the Shipyard Build & Deploy Worker.
# Build context: monorepo root (required for npm workspace resolution).
#
# Stages:
#   deps    — install ALL dependencies (needed for tsc and prisma generate)
#   builder — compile TypeScript for shared + worker, generate Prisma client
#   runner  — lean production image; Docker socket is mounted at runtime
#
# Build command (from monorepo root):
#   docker build -f apps/worker/Dockerfile -t shipyard-worker:latest .
#
# ── Docker Socket Access ──────────────────────────────────────────────────────
# The worker uses the Docker Engine API (via dockerode) to build images and
# manage application containers (ADR-003). At runtime the host Docker socket
# MUST be bind-mounted:
#
#   docker run -v /var/run/docker.sock:/var/run/docker.sock shipyard-worker:latest
#   (or via docker-compose.yml volumes: /var/run/docker.sock:/var/run/docker.sock)
#
# The runtime user (nodejs, UID 1001) must be in the docker group on the host,
# OR the socket bind-mount must be chown'd so UID 1001 can read/write it.
# In the production Compose configuration the worker runs under a user that
# has docker-group membership. On the EC2 host, the `shipyard` system user is
# added to the docker group by user_data.sh.
#
# No additional host privileges (--privileged, --cap-add) are granted.
# Application containers started by the worker are themselves unprivileged —
# they have no access to this socket (ADR-003).
#
# Required runtime environment variables (no defaults for secrets):
#   DATABASE_URL                    postgresql://user:pass@host:5432/shipyard
#   REDIS_URL                       redis://host:6379
#   NODE_ENV                        production
#   DOCKER_SOCKET_PATH              /var/run/docker.sock (default)
#   BUILDS_DIR                      /tmp/shipyard/builds (default)
#   TRAEFIK_DYNAMIC_CONFIG_DIR      /etc/shipyard/traefik/dynamic
#   TRAEFIK_API_URL                 http://traefik:8080
#   TRAEFIK_INGRESS_URL             http://traefik
#   SHIPYARD_DOMAIN                 your-domain.com
#   APPS_NETWORK                    shipyard-apps
#   WORKER_CONCURRENCY              2 (optional)
#   WORKER_METRICS_PORT             3002 (optional)
#   BUILD_TIMEOUT_SECONDS           300 (optional)
#   BUILD_MEMORY_LIMIT_MB           1024 (optional)
# =============================================================================

# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /build

# openssl: Prisma native binary (musl); git: worker clones repos via simple-git
RUN apk add --no-cache openssl libc6-compat git

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/api/package.json          ./apps/api/

RUN npm ci --workspace=packages/shared \
           --workspace=apps/worker \
           --workspace=apps/api \
           --include-workspace-root

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache openssl libc6-compat git

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/api/package.json          ./apps/api/

COPY --from=deps /build/node_modules ./node_modules

COPY tsconfig.base.json              ./
COPY packages/shared/                ./packages/shared/
COPY apps/worker/                    ./apps/worker/
# The worker uses the same Prisma schema as the API
COPY apps/api/prisma/                ./apps/api/prisma/

# 1. Build shared package
RUN npm run build --workspace=packages/shared

# 2. Generate Prisma client for linux-musl (Alpine)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN ./node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma

# 3. Compile the worker TypeScript
RUN npm run build --workspace=apps/worker

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# openssl: Prisma; git: simple-git (clone repos); tini: proper PID 1 signal handling
RUN apk add --no-cache openssl libc6-compat git tini \
 && addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S nodejs -G nodejs \
 # Create writable scratch directory for docker build contexts
 && mkdir -p /tmp/shipyard/builds \
 && chown nodejs:nodejs /tmp/shipyard/builds

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/worker/package.json       ./apps/worker/

RUN npm ci --workspace=packages/shared \
           --workspace=apps/worker \
           --include-workspace-root \
           --omit=dev \
 && npm cache clean --force

# Copy compiled output
COPY --from=builder --chown=nodejs:nodejs /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=nodejs:nodejs /build/apps/worker/dist     ./apps/worker/dist

# Prisma schema + generated client
COPY --from=builder --chown=nodejs:nodejs /build/apps/api/prisma      ./apps/api/prisma
COPY --from=builder --chown=nodejs:nodejs /build/node_modules/.prisma ./node_modules/.prisma

# Workspace symlinks
COPY --from=builder --chown=nodejs:nodejs /build/node_modules/@shipyard ./node_modules/@shipyard

USER nodejs

# Expose worker Prometheus metrics port
EXPOSE 3002

ENV NODE_ENV=production

# Health check against the worker's /health endpoint on its metrics HTTP server.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e " \
    const http = require('http'); \
    const port = process.env.WORKER_METRICS_PORT || 3002; \
    const req = http.get('http://localhost:' + port + '/health', (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.setTimeout(8000, () => { req.destroy(); process.exit(1); }); \
  "

# Use tini as PID 1 for proper SIGTERM forwarding to the Node.js process.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
