# =============================================================================
# SempreDesk — Makefile (alinhado à arquitetura dev/prod até c2ce39c)
#
# PRODUÇÃO: apenas docker-compose.yml + infra/nginx/nginx.conf (sem override/.dev/.local).
# DESENVOLVIMENTO: ENV=dev (padrão). O Docker Compose funde docker-compose.override.yml
#   se existir (make setup-dev copia docker-compose.dev.example.yml → override).
#
# Requer: GNU Make + Bash (Git Bash / WSL / Linux / macOS).
# Este Makefile NÃO modifica docker-compose.yml nem infra/nginx/nginx.conf.
# =============================================================================

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

.DEFAULT_GOAL := help

# =============================================================================
# Variables
# =============================================================================
ENV                     ?= dev
COMPOSE_FILE            := docker-compose.yml
# Produção: forçar só o ficheiro base (ignora override/.dev/.local no disco)
COMPOSE_PROD            := docker compose -f $(COMPOSE_FILE)
# Dev: merge automático de override.yml quando presente — nunca usar nos alvos prod-*
COMPOSE_DEV             := docker compose

COMPOSE_PROJECT_NAME    ?= $(notdir $(CURDIR))
# Se o volume real for outro: make db-reset POSTGRES_VOLUME=nome_real_postgres_data
POSTGRES_VOLUME         ?= $(COMPOSE_PROJECT_NAME)_postgres_data
POSTGRES_CONTAINER      := suporte_postgres
BACKEND_CONTAINER       := suporte_backend
FRONTEND_CONTAINER      := suporte_frontend
NGINX_CONTAINER         := suporte_nginx

ENV_EXAMPLE             := .env.example
ENV_LOCAL               := .env
BACKEND_ENV_EXAMPLE     := backend/.env.example
BACKEND_ENV_LOCAL       := backend/.env
COMPOSE_DEV_EXAMPLE     := docker-compose.dev.example.yml
COMPOSE_OVERRIDE        := docker-compose.override.yml
NGINX_DEV_EXAMPLE       := infra/nginx/nginx.dev.conf.example
NGINX_DEV_LOCAL         := infra/nginx/nginx.dev.conf

# =============================================================================
# Helpers
# =============================================================================
.PHONY: help
help: ## Mostra esta ajuda
	@grep -hE '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

.PHONY: _confirm-prod
_confirm-prod:
	@read -p "Confirmar produção (yes)? " ans; [ "$$ans" = "yes" ] || { echo "Cancelado."; exit 1; }

.PHONY: _guard-dev-env
_guard-dev-env:
ifeq ($(ENV),prod)
	$(error ENV=prod: use alvos prod-* (ex.: make prod-up). Desenvolvimento: ENV=dev (padrão) ou omita ENV.)
endif

.PHONY: _require-dev-compose-files
_require-dev-compose-files:
	@if [ ! -f "$(COMPOSE_OVERRIDE)" ] && [ ! -f docker-compose.dev.yml ] && [ ! -f docker-compose.local.yml ]; then \
		echo "Aviso: sem docker-compose.override.yml nem .dev.yml/.local.yml — make setup-dev"; \
	fi
	@if [ ! -f "$(NGINX_DEV_LOCAL)" ]; then \
		echo "Aviso: sem $(NGINX_DEV_LOCAL) — make setup-dev"; \
	fi

# =============================================================================
# Dev — Docker (nunca usa só $(COMPOSE_FILE) isolado como em prod)
# =============================================================================
.PHONY: up
up: _guard-dev-env _require-dev-compose-files ## Sobe stack (dev; merge override se existir)
	$(COMPOSE_DEV) up -d

.PHONY: down
down: _guard-dev-env ## Para stack (dev)
	$(COMPOSE_DEV) down

.PHONY: restart
restart: _guard-dev-env ## Reinicia serviços (dev)
	$(COMPOSE_DEV) restart

.PHONY: logs
logs: _guard-dev-env ## Logs (dev)
	$(COMPOSE_DEV) logs -f --tail=200

.PHONY: rebuild
rebuild: _guard-dev-env ## Rebuild imagens + up (dev)
	$(COMPOSE_DEV) build --pull
	$(COMPOSE_DEV) up -d

.PHONY: sh-backend
sh-backend: _guard-dev-env ## Shell no backend (dev)
	$(COMPOSE_DEV) exec $(BACKEND_CONTAINER) sh

.PHONY: sh-frontend
sh-frontend: _guard-dev-env ## Shell no frontend (dev)
	$(COMPOSE_DEV) exec $(FRONTEND_CONTAINER) sh

.PHONY: sh-nginx
sh-nginx: _guard-dev-env ## Shell no nginx (dev; config local nginx.dev.conf se setup-dev)
	$(COMPOSE_DEV) exec $(NGINX_CONTAINER) sh

# =============================================================================
# Produção — APENAS $(COMPOSE_FILE); nunca override / nginx.dev / .local
# =============================================================================
.PHONY: prod-up
prod-up: _confirm-prod ## Produção: up -d (só docker-compose.yml)
	$(COMPOSE_PROD) up -d

.PHONY: prod-down
prod-down: _confirm-prod ## Produção: down
	$(COMPOSE_PROD) down

.PHONY: prod-restart
prod-restart: _confirm-prod ## Produção: restart
	$(COMPOSE_PROD) restart

.PHONY: prod-logs
prod-logs: _confirm-prod ## Produção: logs
	$(COMPOSE_PROD) logs -f --tail=200

.PHONY: prod-rebuild
prod-rebuild: _confirm-prod ## Produção: build + up
	$(COMPOSE_PROD) build --pull
	$(COMPOSE_PROD) up -d

.PHONY: prod-backup-db
prod-backup-db: _confirm-prod ## Produção: pg_dump → backups/pg_*.sql
	@mkdir -p backups
	$(COMPOSE_PROD) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > backups/pg_$$(date +%Y%m%d_%H%M%S).sql
	@echo "Backup em backups/"

.PHONY: prod-restore-db
prod-restore-db: _confirm-prod ## Produção: restore — FILE=caminho/backup.sql (obrigatório)
	@test -n "$(FILE)" || { echo "Uso: make prod-restore-db FILE=backups/pg_....sql"; exit 1; }
	@test -f "$(FILE)" || { echo "Ficheiro não encontrado: $(FILE)"; exit 1; }
	@read -p "SOBRESCREVER BD em produção com $(FILE) (yes)? " a; [ "$$a" = "yes" ] || { echo "Cancelado."; exit 1; }
	$(COMPOSE_PROD) exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1' < "$(FILE)"
	@echo "Restore concluído."

# =============================================================================
# Onboarding
# =============================================================================
.PHONY: setup-dev
setup-dev: ## Copia .example → .env, backend/.env, override.yml, nginx.dev.conf (se não existirem)
	@if [ -f "$(ENV_EXAMPLE)" ] && [ ! -f "$(ENV_LOCAL)" ]; then \
		cp "$(ENV_EXAMPLE)" "$(ENV_LOCAL)" && echo "Criado $(ENV_LOCAL)."; \
	elif [ ! -f "$(ENV_LOCAL)" ]; then \
		echo "Sem $(ENV_EXAMPLE); $(ENV_LOCAL) não criado."; \
	else \
		echo "$(ENV_LOCAL) já existe."; \
	fi
	@if [ -f "$(BACKEND_ENV_EXAMPLE)" ] && [ ! -f "$(BACKEND_ENV_LOCAL)" ]; then \
		cp "$(BACKEND_ENV_EXAMPLE)" "$(BACKEND_ENV_LOCAL)" && echo "Criado $(BACKEND_ENV_LOCAL)."; \
	elif [ -f "$(BACKEND_ENV_LOCAL)" ]; then \
		echo "$(BACKEND_ENV_LOCAL) já existe."; \
	fi
	@if [ -f "$(COMPOSE_DEV_EXAMPLE)" ] && [ ! -f "$(COMPOSE_OVERRIDE)" ]; then \
		cp "$(COMPOSE_DEV_EXAMPLE)" "$(COMPOSE_OVERRIDE)" && echo "Criado $(COMPOSE_OVERRIDE)."; \
	else \
		echo "$(COMPOSE_OVERRIDE) já existe ou modelo em falta."; \
	fi
	@if [ -f "$(NGINX_DEV_EXAMPLE)" ] && [ ! -f "$(NGINX_DEV_LOCAL)" ]; then \
		cp "$(NGINX_DEV_EXAMPLE)" "$(NGINX_DEV_LOCAL)" && echo "Criado $(NGINX_DEV_LOCAL)."; \
	else \
		echo "$(NGINX_DEV_LOCAL) já existe ou modelo em falta."; \
	fi
	@echo "Próximo passo: editar $(ENV_LOCAL), depois make up"

# =============================================================================
# DB (somente desenvolvimento)
# =============================================================================
.PHONY: db-shell
db-shell: _guard-dev-env ## psql no Postgres (dev; usa credenciais do contentor)
	$(COMPOSE_DEV) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

.PHONY: db-reset
db-reset: _guard-dev-env ## Apaga volume Postgres LOCAL e recria (irreversível; só dev)
	@read -p "APAGAR volume local $(POSTGRES_VOLUME) (yes)? " a; [ "$$a" = "yes" ] || { echo "Cancelado."; exit 1; }
	$(COMPOSE_DEV) stop postgres || true
	-docker rm -f $(POSTGRES_CONTAINER)
	@if docker volume inspect "$(POSTGRES_VOLUME)" >/dev/null 2>&1; then \
		docker volume rm "$(POSTGRES_VOLUME)" && echo "Volume removido."; \
	else \
		echo "Volume $(POSTGRES_VOLUME) inexistente (ajuste POSTGRES_VOLUME=... se necessário)."; \
	fi
	$(COMPOSE_DEV) up -d postgres
	@echo "Postgres a iniciar; depois make up para a stack completa."

# =============================================================================
# Lint / Format
# =============================================================================
.PHONY: lint lint-frontend lint-backend
lint: _guard-dev-env lint-frontend lint-backend ## next lint + tsc --noEmit (backend)

lint-frontend: _guard-dev-env
	cd frontend && npm run lint

lint-backend: _guard-dev-env
	cd backend && npx tsc --noEmit

.PHONY: format
format: _guard-dev-env ## next lint --fix (frontend)
	cd frontend && npx next lint --fix || true
	@echo "Backend: sem formatador no package.json — use IDE ou adicione Prettier."

# =============================================================================
# Nginx — lembretes (não altera ficheiros versionados de produção)
# =============================================================================
.PHONY: nginx-info
nginx-info: ## Resume nginx prod vs dev (.conf versionado vs .dev.conf local)
	@echo "PRODUÇÃO: infra/nginx/nginx.conf (SSL) — usar com make prod-* na VPS."
	@echo "DEV: infra/nginx/nginx.dev.conf (gitignored), modelo .example + setup-dev."
	@echo "Nunca montar nginx.dev.conf / nginx.local.conf em produção."
