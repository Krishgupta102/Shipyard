# Architecture Decision Records (ADRs) — Shipyard

> Each decision is recorded in the format: Context → Options Considered → Decision → Trade-offs → Interview Cheatsheet.
> These are the decisions you need to be able to explain fluently in a technical interview.

---

## ADR-001: Monorepo with npm Workspaces

**Status:** Accepted — Phase 0

### Context
Shipyard has three distinct application packages (API, Worker, Dashboard) and shared TypeScript types. They need to share code (types, schemas, enums) without a publish/versioning ceremony and must be independently buildable and testable.

### Options Considered

| Option | Pros | Cons |
|---|---|---|
| **Single package (no monorepo)** | Simple setup | No clear separation of concerns; API and Worker import each other indirectly |
| **npm Workspaces (chosen)** | Native, zero tooling, local package linking | No incremental build caching out of the box |
| **Turborepo or Nx** | Build caching, dependency graph | Significant added complexity and a major new tool to explain |

### Decision
Use **npm Workspaces** (native, no additional CLI tools). The `workspaces` field in the root `package.json` causes npm to symlink `packages/shared` into each application's `node_modules/@shipyard/shared`. No publish step needed.

### Trade-offs
- `npm run build --workspaces` rebuilds everything in parallel with no caching. For a portfolio project this is acceptable. In production, Turborepo's task-graph caching would be worth adding.
- npm workspace hoisting occasionally surprises developers when a dependency is available globally from the root. We minimize this by keeping explicit `devDependencies` per package.

### Interview Cheatsheet
> "I used npm workspaces to share types between the API and Worker without publishing to npm. The root package.json declares the workspace members, and npm symlinks local packages. I avoided Turborepo because it would be another abstraction I'd need to explain — the project is meant to be readable and explainable in interviews."

---

## ADR-002: Separation of Deployment Lifecycle Status from Active Routing State

**Status:** Accepted — Phase 0 (implemented in Phase 1)

### Context
A naïve deployment data model conflates two distinct concepts:
- **"Did this build and deployment pipeline succeed?"** — the lifecycle question.
- **"Is this deployment currently serving user traffic?"** — the routing question.

This conflation causes ambiguous states. Example: if deployment A was successful but has been superseded by deployment B, is deployment A "failed"? No — it succeeded, it's just no longer active. If deployment B then fails a health check, deployment A remains live — its status should not change.

### Decision: Two Separate Fields

**`Deployment.status`** records the immutable lifecycle of one pipeline execution:
- `QUEUED → BUILDING → DEPLOYING → SUCCESS | FAILED | CANCELLED`
- Once a terminal state (`SUCCESS`, `FAILED`, `CANCELLED`) is reached, it never changes.

**`Project.activeDeploymentId` + `Project.activeSlot`** record which deployment currently receives live traffic. This is a mutable pointer that is updated **only** after a successful health-check-verified traffic switch.

### What This Enables

| Scenario | `Deployment.status` | `Project.activeDeploymentId` | Meaning |
|---|---|---|---|
| v1 deploys successfully | `SUCCESS` | `v1` | v1 serves traffic |
| v2 deploys, health check fails | `FAILED` | still `v1` | v1 never interrupted |
| Rollback to v1 (new record `v3`) | `v3: SUCCESS` | `v1` | v1's original record untouched |

### Rollback Creates a New Deployment Record
Rollback does not modify the status of historical deployments. A new `Deployment` row is created referencing the same immutable image tag. This preserves a complete, auditable deployment history and means rollback always goes through the same `DEPLOYING → health check → SUCCESS` pipeline.

### Interview Cheatsheet
> "I separate the deployment pipeline's outcome from which container is currently live. Deployment status is append-only and immutable once terminal. The 'active' pointer on the Project row is only moved after health checks pass and traffic has verifiably switched. This means a failed deploy can never silently drop traffic, and the audit log is always truthful."

---

## ADR-003: Single-Owner Security Boundary & Docker Socket Access

**Status:** Accepted — Phase 0 (enforced in Phases 3-4)

### Context
The Shipyard Worker needs to build Docker images and run containers. This requires access to the Docker Engine API via the Unix socket at `/var/run/docker.sock`. Access to this socket is effectively root access to the host because it allows mounting any host path, running privileged containers, and executing arbitrary commands. In a multi-tenant public platform (like Heroku, Fly.io, or Render), this would be a critical security vulnerability.

### The Trust Boundary Decision

Shipyard is explicitly scoped to a **single-owner model**: only the platform operator's own repositories are ever built and run. This is documented as a deliberate scope decision, not an oversight.

**What this means in practice:**
- The Worker may access `/var/run/docker.sock` to build and run containers.
- Application containers that the Worker launches are **never** given socket access.
- Application containers run on the isolated `shipyard-apps` network, separate from the platform's `shipyard-infra` network.
- Application containers are only given their project's env vars — never platform secrets.

### Why True Multi-Tenant Sandboxing Is Out of Scope
True multi-tenant isolation (e.g., Fly.io, AWS Fargate) uses hardware virtualization — Firecracker microVMs or gVisor — because the Linux kernel's syscall surface is too broad to safely sandbox arbitrary root-level code. Implementing this would require replacing Docker Engine with a VM runtime, adding enormous complexity outside the project's educational goals.

### Container & Build Hardening Applied

```
--memory=1024m --memory-swap=1024m   # Hard memory cap; no unlimited swap
--cpus=1.0                           # Hard CFS CPU quota (NanoCpus / cpuperiod + cpuquota)
--security-opt=no-new-privileges     # Prevent privilege escalation
--network=shipyard-apps              # Cannot reach DB or Redis (isolated bridge)
# No --privileged
# No --cap-add
# No -v /var/run/docker.sock:/var/run/docker.sock
```

#### Why CPU Shares Are Not Equivalent to a Hard CPU Quota
In Docker, `cpushares` (`--cpu-shares`, default 1024) is a purely relative weight evaluated only during CPU contention. When no other processes demand CPU time, a container with low CPU shares can still consume 100% of all available CPU cores on the host. To enforce a true upper limit, we configure the Linux Completely Fair Scheduler (CFS) quota:
- In Docker build: `cpuperiod: 100000` (100ms) and `cpuquota: Math.floor(cpus * 100000)`.
- In Docker run: `NanoCpus: Math.floor(cpus * 1e9)`.
This guarantees that regardless of idle system resources, neither build processes nor user application containers can exceed their allocated CPU budget.

### Interview Cheatsheet
> "I deliberately scoped Shipyard as a single-owner platform, which lets me use the Docker Engine API directly from the Worker. The Worker is the only process with socket access. User application containers get a separate Docker network from the platform, no socket access, and only their own environment variables — never database credentials or API keys. Furthermore, I enforced hard Linux CFS CPU quotas (`cpuquota`/`NanoCpus`) rather than relative CPU shares, because CPU shares only throttle under contention and allow 100% core usage when idle."

---

## ADR-004: Traefik Dynamic File Provider vs. Docker Labels for Blue-Green Routing

**Status:** Accepted — Phase 0 (implemented in Phase 4)

### Context
We need to switch live HTTP traffic from the old container (blue) to the new container (green) **after** the green container has passed health checks. The switch must not drop in-flight requests.

### Why Docker Labels Don't Work for Blue-Green

The obvious approach is to use Traefik's Docker provider and update container labels. However, **Docker does not allow modifying labels on a running container.** To change a label, you must stop, remove, and recreate the container — which is exactly what we are trying to avoid during the warm-up phase. Furthermore, if both containers have the same routing label simultaneously, Traefik round-robins requests between them (50/50 canary), not a clean 100% cutover.

### Decision: Traefik Dynamic File Provider

Traefik supports a file provider that watches a directory for JSON/YAML files using Linux `inotify`. When a file changes, Traefik reloads the routing configuration **in memory, without restarting**, and without dropping existing TCP connections.

The Worker performs a **POSIX-atomic file rename** to switch routing:

```
1. Write new config to: /etc/traefik/dynamic/${projectId}.tmp.yml
2. fs.rename(tmp, final)  ← single syscall, atomic on POSIX filesystems
3. Traefik's inotify watcher triggers → in-memory reload
```

`rename()` is a POSIX-atomic operation: from Traefik's perspective, the file transitions directly from the old inode state to the new inode state, never presenting a partially written configuration.

**Note on File Extension (`.yml`):**
Traefik's dynamic file provider only indexes files ending in `.yml`, `.yaml`, or `.toml`. It intentionally skips `.json` files. Since YAML 1.2 is a strict superset of JSON, Shipyard formats the dynamic routing configuration as structured JSON and writes it with the `.yml` extension (`${projectId}.yml`). This gives us type-safe JSON serialization in TypeScript while satisfying Traefik's file provider scanner.

### Post-Rename Verification (Your Clarification Applied)
After the rename, we do **not** immediately mark `SUCCESS`. Instead:

```
1. Poll Traefik API GET /api/http/services/${serviceName}
   → Confirm the service URL has updated to the green container
   → Retry up to 10 times with 1s backoff (config reload has a delay)

2. Poll the application's /health endpoint via Traefik's ingress
   (not direct container — this confirms traffic actually reaches the green container)
   → Must return HTTP 200

3. Only if BOTH checks pass within timeout → mark Deployment SUCCESS
   → Wait 5s drain window → stop and remove the old (blue) container

4. If EITHER check times out → mark Deployment FAILED
   → Restore the previous routing config file (write the old config, rename)
   → Leave blue container running
   → Log the failure reason
```

### Rollback via File Provider
For manual rollback, the Worker:
1. Starts the rollback target image in the currently-inactive slot.
2. Passes health checks directly on the container.
3. Renames the dynamic config file to point to the rollback slot.
4. Verifies via Traefik API + ingress health check.
5. Updates `Project.activeDeploymentId` and `Project.activeSlot` only on confirmation.

### Trade-offs

| | Docker Label Provider | File Provider (chosen) |
|---|---|---|
| **Cutover atomicity** | Non-atomic (container recreate) | POSIX-atomic rename |
| **Zero-downtime** | Cannot do cleanly | Yes — Traefik reloads in-memory |
| **Complexity** | Simple but broken for our use case | Requires shared volume and verify step |
| **Crash recovery** | Re-apply labels on retry | Re-write config file on retry (idempotent) |

### Interview Cheatsheet
> "Docker labels can't be modified on a running container without recreating it, which breaks blue-green. I used Traefik's file provider instead. The Worker writes the new routing config to a temp file and renames it atomically — rename is a single POSIX syscall, so Traefik never sees a partial file. After the rename, I verify the route actually updated by polling the Traefik API and then confirming a successful health check through the Traefik ingress — not directly to the container. Only then do I mark the deployment successful and drain the old container."

---

## ADR-005: Crash Recovery, Idempotency, and Reconciliation

**Status:** Accepted — Phase 0 (implemented in Phases 3-4)

### Context
Workers can crash at any point in the build-deploy pipeline. Without recovery design, a crash mid-deployment can leave the system in an undefined state: an orphan container running, an old image marked FAILED incorrectly, or traffic split between versions.

### Three-Layer Recovery Strategy

#### Layer 1: BullMQ Stall Detection
BullMQ tracks a "lock" heartbeat on every active job. If a worker fails to renew the lock within `stalledInterval` (default: 30 seconds), BullMQ marks the job as stalled and re-queues it for another worker (up to `maxStalledCount` retries).

**What this provides:** automatic re-delivery without manual intervention.

#### Layer 2: Deterministic Idempotency Keys
Every resource in the pipeline has a **deterministic name** derived from stable identifiers:

| Resource | Naming Convention | Purpose |
|---|---|---|
| BullMQ Job ID | `deploy-${deploymentId}` | BullMQ rejects duplicate concurrent jobs (no colons) |
| Docker image tag | `shipyard/${projectId}:${commitSha}` | If image exists, skip build |
| Container name | `shipyard-${projectId}-${slot}` | Find and clean up orphaned containers |
| Traefik config file | `/etc/traefik/dynamic/${projectId}.yml` | Idempotent atomic file write (YAML provider) |
| Build scratch dir | `/tmp/shipyard/builds/${deploymentId}` | Wipe and re-clone on retry |

On each retry, the Worker checks whether each resource already exists in the expected state before re-creating it. This makes every step **idempotent**.

#### Layer 3: Worker Startup Reconciliation Sweep
When the Worker process boots, it reconciles uncompleted deployments (`BUILDING` or `DEPLOYING`). Rather than blindly failing records older than a fixed timestamp, it evaluates a deterministic decision tree:
1. **BullMQ Job State & Heartbeat:** Checks whether the BullMQ job is currently `active` with a live worker lock (`job.isLocked()`) or queued (`waiting`/`delayed`). If so, it leaves the job untouched to avoid racing with a healthy parallel worker.
2. **Build Timeout:** If the deployment is in `BUILDING` and elapsed time has exceeded `config.buildTimeoutMs` (10 minutes) with no active lock, it is marked `FAILED` with a descriptive error.
3. **Container State & Traefik Routing Inspection:** If the deployment was `DEPLOYING`, it inspects Docker daemon container state and the Traefik dynamic file:
   - *Crash AFTER routing cutover:* If the target container is running, passes health checks, and Traefik config points to it, the worker recovers the deployment, promotes it to `SUCCESS`, and updates `Project.activeSlot` and `Project.activeDeploymentId`.
   - *Crash BEFORE routing cutover:* If the target container is missing or unhealthy and Traefik still routes to the previous deployment, the orphaned container is cleaned up and the uncompleted deployment is safely marked `FAILED` without affecting live traffic.
4. Every reconciliation action logs structured diagnostics for full auditability.

### Crash Scenario Table

| Crash Point | State at Crash | Recovery Action |
|---|---|---|
| During git clone | Partial scratch dir | Delete dir, re-clone |
| After image build | Image exists in Docker | Skip build, proceed to deploy |
| After container start | Orphan container running | Stop and remove, start fresh |
| After Traefik rename, before verify | Traffic may be on green | Verify Traefik API → if confirmed, mark SUCCESS |
| After verify, before DB update | SUCCESS not persisted | Startup reconciler detects and writes SUCCESS |

### Interview Cheatsheet
> "I use three layers of crash recovery. First, BullMQ's lock heartbeat automatically re-queues stalled jobs. Second, every Docker resource has a deterministic name derived from the deployment ID, so a retry can find and clean up whatever the last attempt left behind. Third, on worker startup I run a reconciliation sweep that checks for deployments stuck in transient states and resolves them against the actual Docker state. This means the system can survive an OOM kill or host reboot mid-deployment without human intervention."

---

## ADR-006: BullMQ for Asynchronous Job Queue

**Status:** Accepted — Phase 0 (implemented in Phases 2-3)

### Context
Build operations are slow (minutes), CPU-intensive, and must not block the HTTP API. They need reliable delivery, retry with back-off, and protection against duplicate concurrent execution for the same deployment.

### Decision: BullMQ backed by Redis

BullMQ is a TypeScript-native job queue backed by Redis. Redis is already required for Pub/Sub log streaming, so BullMQ adds no new infrastructure dependency.

**Key features we rely on:**
- **Persistent jobs:** Jobs survive worker restarts (stored in Redis sorted sets).
- **Stall detection:** If a worker dies mid-job, the lock expires and the job is re-queued.
- **Idempotent job IDs:** `{ jobId: 'deploy:${deploymentId}' }` prevents duplicate jobs.
- **Per-project concurrency:** We can set `concurrency: 1` per project key to prevent two builds racing for the same blue/green slots.
- **Job events:** Workers emit progress events that we bridge to Redis Pub/Sub for SSE.

### Interview Cheatsheet
> "BullMQ uses Redis sorted sets to store jobs with their state — waiting, active, completed, failed. When a worker crashes, the job lock expires, and BullMQ automatically moves the job back to the waiting queue. I use a deterministic job ID per deployment so if the API accidentally enqueues the same deployment twice, BullMQ rejects the duplicate. Redis was already in the stack for log streaming, so BullMQ adds no new infrastructure."

---

## ADR-007: Traefik Post-Cutover Verification Before Marking SUCCESS

**Status:** Accepted — Phase 0 (implemented in Phase 4)

### Context
After the Worker performs `fs.renameSync()` to switch the Traefik dynamic config file, there is a non-zero delay before Traefik's inotify watcher triggers and the in-memory routing table updates. Declaring the deployment `SUCCESS` immediately after the file rename could mark a deployment as live before Traefik has actually applied the new route.

Additionally, confirming the route via a direct health check to the green container's IP does not prove that **Traefik** has begun routing traffic there — the container might be healthy but Traefik still serving from blue.

### Decision: Two-Stage Verification After File Rename

**Stage 1 — Traefik Control Plane Verification:**
Poll `GET http://localhost:8080/api/http/services/${serviceName}` on the Traefik dashboard API. Parse the response to confirm the service's `serverStatus` URL matches the green container's address. Retry with 1-second intervals, up to 15 attempts (15-second total window for config propagation).

**Stage 2 — End-to-End Ingress Health Check:**
Make `GET http://${subdomain}.shipyard.local/health` via the Traefik ingress endpoint. This confirms:
- Traefik is routing to green (not blue)
- The green container is receiving and responding to requests
- No networking issues between Traefik and the green container

Only after both stages pass within the timeout window does the Worker:
1. Mark `Deployment.status = SUCCESS`
2. Update `Project.activeDeploymentId` and `Project.activeSlot`
3. Wait 5 seconds (drain window for in-flight requests on blue)
4. Stop and remove the old (blue) container

**On Verification Failure:**
- Restore the previous Traefik config file (rename back to point to blue)
- Mark `Deployment.status = FAILED` with `errorMessage: "traefik_verification_failed"`
- The blue container has never been stopped — traffic is uninterrupted

### Interview Cheatsheet
> "After the atomic file rename, I don't trust that Traefik has immediately applied the new route. There's an inotify propagation delay. So I poll the Traefik dashboard API to verify the route table updated, then make a real HTTP request through the Traefik ingress to confirm traffic flows end-to-end to the new container. Both checks must pass before I mark the deployment successful. If either times out, I write back the old config file and leave the original container serving traffic."

---

## ADR-008: Server-Sent Events (SSE) vs. WebSockets for Real-Time Log Streaming

**Status:** Accepted — Phase 0 (implemented in Phase 5)

### Context
Clients need real-time streaming logs as builds and deployments execute. When a user navigates to a deployment page mid-flight or after completion, they must also see historical logs without missing lines or duplicating output.

### Options Considered

| Option | Pros | Cons |
|---|---|---|
| **HTTP Polling (`GET /logs`)** | Simplest | Wasteful, latency jitter, high database load under active streaming |
| **WebSockets (`ws://`)** | Full-duplex | Unnecessary bidirectional overhead, requires protocol upgrade headers (`Connection: Upgrade`), problematic through some proxies |
| **Server-Sent Events (`text/event-stream`) (chosen)** | Monodirectional, standard HTTP, native browser auto-reconnect, easy hybrid replay | Text-only (sufficient for logs), HTTP/1.1 connection limit if not on HTTP/2 |

### Decision: Server-Sent Events with Redis Pub/Sub Backing

Shipyard implements log streaming via **Server-Sent Events** (`GET /api/deployments/:id/logs/stream`).

**How Hybrid Replay + Real-Time Streaming Works:**
1. **Replay Phase:** When the SSE HTTP request connects, the API queries PostgreSQL for existing `LogLine` records ordered by `timestamp asc` and flushes them down the open stream.
2. **Terminal Guard:** If the deployment is already in a terminal state (`SUCCESS`, `FAILED`, `CANCELLED`), an `event: end` is written and the HTTP stream terminates cleanly.
3. **Live Phase:** If the deployment is active (`QUEUED`, `BUILDING`, `DEPLOYING`), the API creates a dedicated Redis Pub/Sub subscriber listening on `deployment:logs:${deploymentId}`.
4. **Heartbeat:** A 15-second keepalive comment (`: ping\n\n`) keeps the TCP connection alive through intermediate proxies (Traefik/Nginx) during quiet build steps.
5. **Clean Teardown:** When the browser closes the tab or navigates away, the Express `req.on('close')` hook immediately unsubscribes from Redis and stops the heartbeat timer.

### Interview Cheatsheet
> "I chose Server-Sent Events (SSE) over WebSockets because deployment logs are strictly unidirectional — the server streams stdout/stderr to the browser. SSE runs over standard HTTP, so it doesn't require WebSocket upgrade handshakes or special proxy tunneling. It also allowed a clean hybrid design: when a client connects, I first flush historical lines from PostgreSQL, then attach a Redis Pub/Sub listener for real-time lines on the exact same HTTP connection. When the build finishes, I emit an 'end' event and close the connection."

---

## ADR-009: Prometheus Instrumentation Strategy

**Status:** Accepted — Phase 6

### Context
Shipyard needs observability into three areas:
1. **API performance** — HTTP request latencies, error rates, SSE connection counts.
2. **Deployment pipeline health** — build durations, health check times, success/fail rates by stage.
3. **Queue backpressure** — BullMQ depth so operators know when to scale the worker.

The question is where to expose metrics, what naming to use, and how to control cardinality.

### Options Considered

| Option | Pros | Cons |
|---|---|---|
| **Single global prom-client registry** | Simple, one scrape target | Namespace collisions if libraries accidentally register; API and Worker metrics would intermingle |
| **One isolated registry per service (chosen)** | Clean namespace isolation; each service is independently scrapeable | Two separate Prometheus targets and two HTTP servers |
| **OpenTelemetry SDK** | Vendor-neutral, supports traces + metrics | Significant added complexity, requires an OTLP collector, hard to explain in an interview without deep OTEL knowledge |
| **Distributed tracing (Jaeger/Zipkin)** | Per-request trace spans, not just aggregates | High operational overhead; Prometheus + Grafana covers the portfolio project's needs adequately |

### Decision

**Separate, isolated `prom-client` Registry per service:**

- **API registry** (port 3001, `GET /metrics`): HTTP request durations, webhook counters, deployment enqueue counters, SSE gauge. Prefix: `shipyard_api_`.
- **Worker registry** (port 3002, standalone HTTP server, `GET /metrics`): Docker build durations, git checkout durations, health-check timings, Traefik verification durations, BullMQ queue-depth gauges, deployment outcome counters.

**Cardinality control:** HTTP route labels use Express's matched route pattern (e.g., `/api/projects/:projectId/deployments`), **not** the literal URL, to prevent cardinality explosion from GUIDs in path segments. The `/metrics` and `/health` endpoints are excluded from instrumentation entirely.

**BullMQ queue poller:** A 15-second interval poller queries BullMQ `getWaitingCount()`, `getActiveCount()`, `getDelayedCount()`, `getFailedCount()` and sets gauge values, matching Prometheus' default scrape interval.

**Grafana auto-provisioning:** Two dashboards are committed as JSON files in `monitoring/grafana/provisioning/dashboards/`. Grafana's file provider auto-loads them on startup with no manual import step.

### What the Dashboards Show

| Dashboard | Key Panels |
|---|---|
| **Shipyard — Platform Overview** | Deployment throughput (stats + rate), BullMQ depth, API req/s by route, P95 latency, error rate, webhook events |
| **Shipyard — Deployment Pipeline** | Build p50/p95, git checkout avg, health check avg, Traefik verification avg, failure stage breakdown, worker heap + event-loop lag |

### Trade-offs
- Two separate scrape targets requires two `job_name` entries in `prometheus.yml`. This is a negligible operational cost.
- Without distributed tracing, there's no per-request correlation across API → Worker → Docker. Prometheus gives aggregate histograms, not individual request traces. For the portfolio's scale this is acceptable; adding OpenTelemetry traces later would complement, not replace, these metrics.
- The BullMQ poller adds a Redis round-trip every 15s per worker process. This is negligible compared to the worker's actual workload.

### Interview Cheatsheet
> "I added Prometheus instrumentation in Phase 6 using isolated prom-client registries per service — one for the API, one for the Worker. The API exposes /metrics on its main HTTP port; the Worker runs a separate lightweight HTTP server on port 3002. For cardinality control, I normalise route labels using Express's matched route pattern, not literal URLs, which prevents GUIDs from creating thousands of unique time series. The Worker registry also includes a 15-second BullMQ queue-depth poller so I can see backpressure before it causes latency. Grafana is auto-provisioned with two dashboards from JSON files committed to the repo — no manual import step needed."

---

## ADR-010: AWS Cloud Infrastructure Design (Terraform IaC, Single-Host EC2, SSM, & Security Boundary)

**Status:** Accepted — Phase 7

### Context
To make Shipyard production-ready on AWS, we need Infrastructure as Code (IaC) that provisions the underlying network, compute, storage, and security resources predictably and reproducibly. The goal is to provide a deployable AWS environment while preserving the single-owner security boundary (ADR-003) and keeping infrastructure costs modest and interview-explainable.

### Options Considered

| Option | Pros | Cons |
|---|---|---|
| **Multi-Service Cloud Native (ECS Fargate + RDS + ElastiCache + ALB)** | Highly resilient, managed backups, automated horizontal autoscaling | Extreme complexity (20+ Terraform resources), expensive baseline costs ($150+/mo), diverges from local Docker Compose architecture |
| **Kubernetes (EKS)** | Industry standard for multi-tenant orchestration | Massive overhead ($73/mo control plane alone), excessive complexity for a single-owner portfolio platform |
| **Single EC2 Host via Terraform (chosen)** | Predictable low cost ($15–30/mo), identical topology to local Docker dev environment, easy to reason about and explain | Single point of failure (no multi-AZ redundancy), vertical scaling limits |

### Decision

**Single EC2 Host with Terraform Modular Architecture:**

1. **VPC Network Topology:**
   - Dedicated VPC (`10.0.0.0/16`) with DNS support and hostnames enabled.
   - Public Subnet (`10.0.1.0/24`) with an attached Internet Gateway and public Route Table.
   - Static Elastic IP (EIP) allocated and associated with the EC2 host to ensure DNS stability across instance restarts.

2. **Security Group & Boundary Enforcement (ADR-003):**
   - **Ingress 80 (HTTP):** Open to the internet (`0.0.0.0/0`) for Traefik edge routing and Let's Encrypt ACME HTTP-01 challenges.
   - **Ingress 443 (HTTPS):** Open to the internet (`0.0.0.0/0`) for TLS-terminated production traffic.
   - **Ingress 22 (SSH):** Scoped to `var.allowed_ssh_cidr` (preferred administrative access is keyless via SSM).
   - **Strict Isolation:** Database (5432), Redis (6379), Traefik Dashboard (8080), Prometheus (9090), Grafana (3100), and internal Node services (3000, 3001, 3002) are **not open** in the security group. They bind exclusively to `127.0.0.1` and communicate over Docker internal bridge networks.
   - **Egress:** Unrestricted outbound (`0.0.0.0/0`) to allow git cloning, npm dependency installs, Docker Hub base image pulls, and OS security patches.

3. **Keyless Administration via AWS Systems Manager (SSM):**
   - The EC2 instance profile attaches the AWS managed policy `AmazonSSMManagedInstanceCore`.
   - Operators can initiate an encrypted, audited, MFA-gated interactive shell session without managing SSH key pairs or opening port 22:
     ```bash
     aws ssm start-session --target <instance-id>
     ```

4. **Automated Host Bootstrapping (Cloud-Init):**
   - `user_data.sh` installs Docker Engine CE, Docker Compose plugin, Node.js 20 LTS, git, and jq.
   - Docker daemon is configured with JSON log rotation (`max-size: 10m`, `max-file: 3`) to prevent unconstrained disk consumption from application container stdout/stderr.
   - A dedicated system user `shipyard` is created and granted docker group permissions.
   - Directory structures (`/opt/shipyard`) and ACME certificate files are created with restrictive permissions (`chmod 600`).

5. **Private Artifact Storage (Optional ECR):**
   - An optional Amazon ECR repository with automated image vulnerability scanning on push and a lifecycle policy (expiring untagged/old images after 90 days) provides secure, immutable storage for verified application image tags.

### Trade-offs
- **Single point of failure:** A hardware degradation or AZ outage on AWS requires stopping and restarting the instance (or re-running Terraform). For a personal deployment platform, this trade-off is deliberate to avoid the 10x cost of multi-AZ load balancers and managed database clusters.
- **Local validation only in Phase 7:** In compliance with the project guidelines, Terraform configurations are verified with `terraform validate` and `terraform plan`, ensuring valid HCL and correct dependency graphs without incurring cloud billing during testing.

### Interview Cheatsheet
> "For Phase 7, I designed the AWS cloud infrastructure using Terraform to mirror Shipyard's local architecture. I provisioned a dedicated VPC, public subnet, and a gp3-backed EC2 instance with an Elastic IP. For security, I enforced strict isolation: only ports 80 and 443 are open to the internet for Traefik, while all database, cache, metrics, and API ports are blocked at the AWS Security Group layer. Instead of managing SSH keys, I attached an IAM role with AmazonSSMManagedInstanceCore so operators can open keyless, encrypted sessions via AWS Systems Manager. Finally, the EC2 user-data script handles the entire host bootstrap — installing Docker with log-rotation limits, Node.js 20, and setting up the directory structure for Let's Encrypt TLS certificates."

