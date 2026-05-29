SHELL := /bin/bash
.DEFAULT_GOAL := dev

ANVIL_HOST ?= 127.0.0.1
ANVIL_PORT ?= 8545
RPC_URL ?= http://$(ANVIL_HOST):$(ANVIL_PORT)
CHAIN_ID ?= 31337
API_HOST ?= 127.0.0.1
API_PORT ?= 8788
API_BASE_URL ?= http://$(API_HOST):$(API_PORT)/api
API_BIND ?= $(API_HOST):$(API_PORT)
API_HEALTH_URL ?= http://$(API_HOST):$(API_PORT)/api/health
API_STARTUP_WAIT_SECONDS ?= 20
ANVIL_LOG_FILE ?= .anvil.log
ANVIL_PID_FILE ?= .anvil.pid
API_LOG_FILE ?= .api.log
API_PID_FILE ?= .api.pid
DEV_DB_DIR ?= .dev-data
CONTRACTS_DIR := contracts
FRONTEND_DIR := frontend
BACKEND_DIR := backend

-include .env

ANVIL_PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ifeq ($(strip $(PRIVATE_KEY)),)
DEPLOYER_PRIVATE_KEY := $(ANVIL_PRIVATE_KEY)
else
DEPLOYER_PRIVATE_KEY := $(PRIVATE_KEY)
endif

ifeq ($(strip $(DEPLOYMENT_ID)),)
EFFECTIVE_DEPLOYMENT_ID := local-goldminer-diamond-rush
else
EFFECTIVE_DEPLOYMENT_ID := $(DEPLOYMENT_ID)
endif
DEFAULT_DATABASE_URL = sqlite://$(abspath $(DEV_DB_DIR))/goldminer-$(EFFECTIVE_DEPLOYMENT_ID).sqlite

.PHONY: help dev anvil ensure-anvil restart-anvil deploy build-levels build-contracts \
	api restart-api web frontend-install test-frontend test-backend test clean

help:
	@echo "Targets:"
	@echo "  make dev             # anvil + deploy + api + web"
	@echo "  make anvil           # start local anvil"
	@echo "  make deploy          # deploy contracts and sync local runtime config"
	@echo "  make api             # start Rust backend in foreground"
	@echo "  make restart-api     # start Rust backend in background"
	@echo "  make web             # start frontend dev server"
	@echo "  make build-levels    # rebuild ranked level manifest"
	@echo "  make build-contracts # forge build and sync ABI"
	@echo "  make test            # contracts + backend + frontend checks"
	@echo "  make clean           # remove local build artifacts"

dev: restart-anvil deploy restart-api web

anvil:
	@anvil --host $(ANVIL_HOST) --port $(ANVIL_PORT) --chain-id $(CHAIN_ID)

ensure-anvil:
	@set -e; \
	if lsof -iTCP:$(ANVIL_PORT) -sTCP:LISTEN -n -P >/dev/null 2>&1; then \
		echo "Anvil already running on port $(ANVIL_PORT)."; \
	else \
		echo "Starting Anvil..."; \
		nohup anvil --host $(ANVIL_HOST) --port $(ANVIL_PORT) --chain-id $(CHAIN_ID) > $(ANVIL_LOG_FILE) 2>&1 < /dev/null & \
		echo $$! > $(ANVIL_PID_FILE); \
		sleep 1; \
	fi

restart-anvil:
	@set -e; \
	PIDS=$$(lsof -tiTCP:$(ANVIL_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$PIDS" ]; then \
		echo "Stopping Anvil on port $(ANVIL_PORT)..."; \
		kill $$PIDS || true; \
	fi; \
	rm -f $(ANVIL_PID_FILE); \
	sleep 1; \
	echo "Starting Anvil..."; \
	nohup anvil --host $(ANVIL_HOST) --port $(ANVIL_PORT) --chain-id $(CHAIN_ID) > $(ANVIL_LOG_FILE) 2>&1 < /dev/null & \
	echo $$! > $(ANVIL_PID_FILE); \
	sleep 1

build-levels:
	@node scripts/build-ranked-manifest.js

build-contracts: build-levels
	@cd $(CONTRACTS_DIR) && forge clean
	@cd $(CONTRACTS_DIR) && forge build
	@node scripts/sync-contract.js --chain-id $(CHAIN_ID) --api-base-url $(API_BASE_URL) --deployment-id $(EFFECTIVE_DEPLOYMENT_ID)

deploy: ensure-anvil build-levels
	@cd $(CONTRACTS_DIR) && forge clean
	@cd $(CONTRACTS_DIR) && forge build
	@cd $(CONTRACTS_DIR) && forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url $(RPC_URL) --private-key $(DEPLOYER_PRIVATE_KEY) --sig "run(string)" "$(EFFECTIVE_DEPLOYMENT_ID)"
	@node scripts/register-ranked-levels.js \
		--rpc-url $(RPC_URL) \
		--private-key $(DEPLOYER_PRIVATE_KEY) \
		--catalog $$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('contracts/out/deployment.json','utf8'));process.stdout.write(d.goldMinerLevelCatalog)") \
		--scoreboard $$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('contracts/out/deployment.json','utf8'));process.stdout.write(d.goldMinerScoreboard)")
	@node scripts/sync-contract.js --chain-id $(CHAIN_ID) --api-base-url $(API_BASE_URL) --deployment-id $(EFFECTIVE_DEPLOYMENT_ID)

api:
	@mkdir -p $(DEV_DB_DIR)
	@GOLDMINER_API_BIND=$(API_BIND) \
	GOLDMINER_DATABASE_URL=$${GOLDMINER_DATABASE_URL:-$(DEFAULT_DATABASE_URL)} \
	GOLDMINER_RPC_URL=$${GOLDMINER_RPC_URL:-$(RPC_URL)} \
	GOLDMINER_CHAIN_ID=$${GOLDMINER_CHAIN_ID:-$(CHAIN_ID)} \
	GOLDMINER_DEPLOYMENT_ID=$${GOLDMINER_DEPLOYMENT_ID:-$(EFFECTIVE_DEPLOYMENT_ID)} \
	GOLDMINER_RELAYER_PRIVATE_KEY=$${GOLDMINER_RELAYER_PRIVATE_KEY:-$(DEPLOYER_PRIVATE_KEY)} \
	GOLDMINER_VERIFIER_PRIVATE_KEY=$${GOLDMINER_VERIFIER_PRIVATE_KEY:-$(DEPLOYER_PRIVATE_KEY)} \
	GOLDMINER_SESSION_TTL_SECONDS=$${GOLDMINER_SESSION_TTL_SECONDS:-7200} \
	GOLDMINER_SESSION_MAX_RUNS=$${GOLDMINER_SESSION_MAX_RUNS:-10} \
	GOLDMINER_MAX_BATCH_RUNS=$${GOLDMINER_MAX_BATCH_RUNS:-8} \
	GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS=$${GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS:-45} \
	GOLDMINER_INDEXER_POLL_INTERVAL_MS=$${GOLDMINER_INDEXER_POLL_INTERVAL_MS:-3000} \
	GOLDMINER_INDEXER_CONFIRMATIONS=$${GOLDMINER_INDEXER_CONFIRMATIONS:-0} \
	cargo run --manifest-path $(BACKEND_DIR)/Cargo.toml -p goldminer-api

restart-api:
	@set -euo pipefail; \
	PORT_PIDS=$$(lsof -tiTCP:$(API_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	FILE_PID=$$(cat $(API_PID_FILE) 2>/dev/null || true); \
	ALL_PIDS="$$PORT_PIDS"; \
	if [ -n "$$FILE_PID" ]; then \
		ALL_PIDS="$$ALL_PIDS $$FILE_PID"; \
	fi; \
	ALL_PIDS=$$(printf '%s\n' $$ALL_PIDS | awk 'NF && !seen[$$1]++'); \
	if [ -n "$$ALL_PIDS" ]; then \
		echo "Stopping API on port $(API_PORT)..."; \
		kill $$ALL_PIDS 2>/dev/null || true; \
		for _ in $$(seq 1 20); do \
			if ! lsof -iTCP:$(API_PORT) -sTCP:LISTEN -n -P >/dev/null 2>&1; then \
				break; \
			fi; \
			sleep 0.25; \
		done; \
	fi; \
	if lsof -iTCP:$(API_PORT) -sTCP:LISTEN -n -P >/dev/null 2>&1; then \
		echo "API port $(API_PORT) is still busy after shutdown attempt."; \
		lsof -iTCP:$(API_PORT) -sTCP:LISTEN -n -P; \
		exit 1; \
	fi; \
	rm -f $(API_PID_FILE); \
	mkdir -p $(DEV_DB_DIR); \
	cargo build --manifest-path $(BACKEND_DIR)/Cargo.toml -p goldminer-api >/dev/null; \
	GOLDMINER_API_BIND=$(API_BIND) \
	GOLDMINER_DATABASE_URL=$${GOLDMINER_DATABASE_URL:-$(DEFAULT_DATABASE_URL)} \
	GOLDMINER_RPC_URL=$${GOLDMINER_RPC_URL:-$(RPC_URL)} \
	GOLDMINER_CHAIN_ID=$${GOLDMINER_CHAIN_ID:-$(CHAIN_ID)} \
	GOLDMINER_DEPLOYMENT_ID=$${GOLDMINER_DEPLOYMENT_ID:-$(EFFECTIVE_DEPLOYMENT_ID)} \
	GOLDMINER_RELAYER_PRIVATE_KEY=$${GOLDMINER_RELAYER_PRIVATE_KEY:-$(DEPLOYER_PRIVATE_KEY)} \
	GOLDMINER_VERIFIER_PRIVATE_KEY=$${GOLDMINER_VERIFIER_PRIVATE_KEY:-$(DEPLOYER_PRIVATE_KEY)} \
	GOLDMINER_SESSION_TTL_SECONDS=$${GOLDMINER_SESSION_TTL_SECONDS:-7200} \
	GOLDMINER_SESSION_MAX_RUNS=$${GOLDMINER_SESSION_MAX_RUNS:-10} \
	GOLDMINER_MAX_BATCH_RUNS=$${GOLDMINER_MAX_BATCH_RUNS:-8} \
	GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS=$${GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS:-45} \
	GOLDMINER_INDEXER_POLL_INTERVAL_MS=$${GOLDMINER_INDEXER_POLL_INTERVAL_MS:-3000} \
	GOLDMINER_INDEXER_CONFIRMATIONS=$${GOLDMINER_INDEXER_CONFIRMATIONS:-0} \
	nohup $(BACKEND_DIR)/target/debug/goldminer-api > $(API_LOG_FILE) 2>&1 < /dev/null & \
	API_PID=$$!; \
	echo $$API_PID > $(API_PID_FILE); \
	for _ in $$(seq 1 $(API_STARTUP_WAIT_SECONDS)); do \
		if curl -fsS $(API_HEALTH_URL) >/dev/null 2>&1; then \
			echo "Gold Miner API is healthy on $(API_BIND)."; \
			exit 0; \
		fi; \
		if ! kill -0 $$API_PID 2>/dev/null; then \
			echo "Gold Miner API exited before becoming healthy."; \
			tail -n 60 $(API_LOG_FILE) 2>/dev/null || true; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "Gold Miner API failed to become healthy within $(API_STARTUP_WAIT_SECONDS)s."; \
	tail -n 60 $(API_LOG_FILE) 2>/dev/null || true; \
	exit 1

frontend-install:
	@cd $(FRONTEND_DIR) && if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi

web: frontend-install
	@cd $(FRONTEND_DIR) && npm run dev

test-frontend: frontend-install
	@cd $(FRONTEND_DIR) && npm run typecheck && npm run test && npm run build
	@node scripts/run-frontend-smoke.mjs

test-backend:
	@cargo test --manifest-path $(BACKEND_DIR)/Cargo.toml

test: build-contracts test-backend test-frontend
	@cd $(CONTRACTS_DIR) && forge test

clean:
	@rm -rf .dev-data
	@rm -f $(ANVIL_PID_FILE) $(API_PID_FILE) $(ANVIL_LOG_FILE) $(API_LOG_FILE)
	@rm -f frontend/public/contract-config.json frontend/public/ranked-level-manifest.json frontend/public/ranked-challenge-manifest.json frontend/public/adventure-level-manifest.json
