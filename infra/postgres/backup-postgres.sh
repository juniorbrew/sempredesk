#!/usr/bin/env bash
# Backup lógico do Postgres (SempreDesk). Uso manual ou cron no host/VPS.
#
# Variáveis (opcional):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
#   BACKUP_DIR  — diretório de saída (default: ./backups)
#   RETAIN_DAYS — apagar dumps .sql.gz mais antigos que N dias (default: 14)
#
# Exemplo Docker (serviço suporte_postgres na rede do compose):
#   docker exec suporte_postgres sh -c 'pg_dump -U suporte -d suporte_tecnico | gzip -c' > "./backups/suporte_$(date +%Y%m%d_%H%M%S).sql.gz"
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/suporte_tecnico_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^suporte_postgres$'; then
  echo "Dump via container suporte_postgres -> $OUT"
  docker exec suporte_postgres sh -c 'pg_dump -U "${PGUSER:-suporte}" -d "${PGDATABASE:-suporte_tecnico}" --no-owner' | gzip -c > "$OUT"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "Dump local pg_dump -> $OUT"
  export PGHOST="${PGHOST:-127.0.0.1}"
  export PGPORT="${PGPORT:-5432}"
  export PGUSER="${PGUSER:-suporte}"
  export PGDATABASE="${PGDATABASE:-suporte_tecnico}"
  pg_dump --no-owner | gzip -c > "$OUT"
else
  echo "Erro: instale PostgreSQL client (pg_dump) ou suba o container suporte_postgres." >&2
  exit 1
fi

echo "OK: $(du -h "$OUT" | cut -f1)"

if [[ "${RETAIN_DAYS}" =~ ^[0-9]+$ ]] && [ "${RETAIN_DAYS}" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'suporte_tecnico_*.sql.gz' -type f -mtime "+${RETAIN_DAYS}" -delete 2>/dev/null || true
  echo "Retenção: removidos dumps mais antigos que ${RETAIN_DAYS} dias (se find disponível)."
fi
