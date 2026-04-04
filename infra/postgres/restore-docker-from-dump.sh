#!/usr/bin/env bash
# Restaura um dump lógico (.sql ou .sql.gz) no container suporte_postgres.
# ATENÇÃO: apaga e recria a base PGDATABASE (dados locais atuais são perdidos).
#
# Pré-requisitos: docker; container suporte_postgres a correr (ex.: docker compose up -d postgres).
# Variáveis opcionais: PGUSER PGDATABASE (defaults: suporte / suporte_tecnico)
#
# Uso:
#   bash infra/postgres/restore-docker-from-dump.sh ./backups/suporte_tecnico_20260403.sql.gz
#
set -euo pipefail

DUMP="${1:?Uso: $0 <ficheiro.sql ou ficheiro.sql.gz>}"
PGUSER="${PGUSER:-suporte}"
PGDATABASE="${PGDATABASE:-suporte_tecnico}"

if ! docker ps --format '{{.Names}}' | grep -q '^suporte_postgres$'; then
  echo "Erro: container suporte_postgres não está a correr." >&2
  exit 1
fi

if [[ ! -f "$DUMP" ]]; then
  echo "Erro: ficheiro não encontrado: $DUMP" >&2
  exit 1
fi

echo "A terminar sessões na base ${PGDATABASE}..."
docker exec suporte_postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PGDATABASE}' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true

echo "A recriar base ${PGDATABASE}..."
docker exec suporte_postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS ${PGDATABASE} WITH (FORCE);"
docker exec suporte_postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${PGDATABASE} OWNER ${PGUSER};"

echo "A importar $DUMP ..."
case "$DUMP" in
  *.gz)
    gunzip -c "$DUMP" | docker exec -i suporte_postgres psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1
    ;;
  *)
    docker exec -i suporte_postgres psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 < "$DUMP"
    ;;
esac

echo "OK: restore concluído em ${PGDATABASE}."
