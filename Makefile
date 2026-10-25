# =============================================================================
# Shipyard — Developer Makefile
#
# All commands are documented so they can be explained in interviews.
# Run `make help` to see all available targets.
# =============================================================================

.PHONY: help infra-up infra-down infra-logs infra-ps wait-infra \
        install typecheck build test \
        local-dns-check verify-infra clean \
        tf-init tf-fmt tf-validate tf-plan

# ── Default target ────────────────────────────────────────────────────────────
help: ## Show this help message
	@echo "Shipyard — Developer Commands"
	@echo "============================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Local dev setup ───────────────────────────────────────────────────────────
setup: ## One-time local setup: copy .env, install deps
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅  Created .env from .env.example — fill in your values."; \
	else \
		echo "ℹ️   .env already exists. Skipping copy."; \
	fi
	npm install

# ── Infrastructure ────────────────────────────────────────────────────────────
infra-up: ## Start backing infrastructure (Postgres, Redis, Traefik, Prometheus, Grafana)
	docker compose -f docker-compose.infra.yml up -d

infra-down: ## Stop and remove infrastructure containers (data volumes preserved)
	docker compose -f docker-compose.infra.yml down

infra-destroy: ## Stop infrastructure and DELETE all data volumes (irreversible)
	@echo "⚠️  This will delete all local database and Redis data."
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ]
	docker compose -f docker-compose.infra.yml down -v

infra-logs: ## Tail logs from all infrastructure containers
	docker compose -f docker-compose.infra.yml logs -f

infra-ps: ## Show running infrastructure containers and their health status
	docker compose -f docker-compose.infra.yml ps

# ── Health verification ───────────────────────────────────────────────────────
wait-infra: ## Block until all infra health checks pass (used in CI)
	@echo "Waiting for Postgres..."
	@until docker exec shipyard-postgres pg_isready -U shipyard -d shipyard > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "✅  Postgres healthy"
	@echo "Waiting for Redis..."
	@until docker exec shipyard-redis redis-cli ping | grep -q PONG; do \
		sleep 1; \
	done
	@echo "✅  Redis healthy"
	@echo "Waiting for Traefik..."
	@until curl -sf http://localhost:8080/ping > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "✅  Traefik healthy"
	@echo ""
	@echo "All infrastructure services are healthy."

verify-infra: infra-up wait-infra ## Start infra and verify all services pass health checks
	@echo ""
	@echo "📊 Prometheus: http://localhost:9090"
	@echo "📊 Grafana:    http://localhost:3100  (admin / admin)"
	@echo "🔀 Traefik:    http://localhost:8080  (dashboard)"
	@echo ""
	@$(MAKE) infra-ps

# ── TypeScript ────────────────────────────────────────────────────────────────
install: ## Install all npm workspace dependencies
	npm install

typecheck: ## Run tsc --noEmit across all workspaces
	npm run typecheck --workspaces --if-present

build: ## Compile TypeScript across all workspaces
	npm run build --workspaces --if-present

# ── Tests ─────────────────────────────────────────────────────────────────────
test: ## Run all unit and integration tests
	npm run test --workspaces --if-present

# ── Local DNS ─────────────────────────────────────────────────────────────────
local-dns-check: ## Check that *.shipyard.local resolves to localhost (macOS: needs /etc/hosts entry)
	@echo "Checking if shipyard.local resolves..."
	@if ping -c 1 -W 1 test.shipyard.local > /dev/null 2>&1; then \
		echo "✅  *.shipyard.local resolves correctly"; \
	else \
		echo "❌  *.shipyard.local does not resolve."; \
		echo "    Add this line to /etc/hosts (requires sudo):"; \
		echo "    127.0.0.1  shipyard.local"; \
		echo "    For wildcard support on macOS, install dnsmasq:"; \
		echo "    brew install dnsmasq"; \
		echo "    echo 'address=/.shipyard.local/127.0.0.1' >> /usr/local/etc/dnsmasq.conf"; \
		echo "    sudo brew services start dnsmasq"; \
	fi

# ── Terraform (Phase 7) ────────────────────────────────────────────────────────
tf-init: ## Initialize Terraform provider plugins
	@mkdir -p /tmp/shipyard-terraform && cp -r terraform/* /tmp/shipyard-terraform/
	docker run --rm -v /tmp/shipyard-terraform:/workspace -w /workspace hashicorp/terraform:latest init

tf-fmt: ## Format Terraform configuration files
	@mkdir -p /tmp/shipyard-terraform && cp -r terraform/* /tmp/shipyard-terraform/
	docker run --rm -v /tmp/shipyard-terraform:/workspace -w /workspace hashicorp/terraform:latest fmt
	@cp -r /tmp/shipyard-terraform/*.tf terraform/

tf-validate: tf-init ## Validate Terraform configuration syntax and integrity
	@mkdir -p /tmp/shipyard-terraform && cp -r terraform/* /tmp/shipyard-terraform/
	docker run --rm -v /tmp/shipyard-terraform:/workspace -w /workspace hashicorp/terraform:latest validate

tf-plan: tf-init ## Run terraform plan in offline validation mode (no cloud resources created)
	@mkdir -p /tmp/shipyard-terraform && cp -r terraform/* /tmp/shipyard-terraform/
	docker run --rm -v /tmp/shipyard-terraform:/workspace -w /workspace \
		-e AWS_ACCESS_KEY_ID=mock -e AWS_SECRET_ACCESS_KEY=mock -e AWS_DEFAULT_REGION=us-east-1 \
		hashicorp/terraform:latest plan \
		-var="ami_id=ami-0123456789abcdef0" \
		-var="skip_credentials_validation=true" \
		-var="skip_requesting_account_id=true"

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean: ## Remove all build artifacts and node_modules
	find . -name "dist" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
	find . -name "node_modules" -type d -maxdepth 3 -exec rm -rf {} + 2>/dev/null || true
	@echo "✅  Cleaned dist/ and node_modules/ directories"
