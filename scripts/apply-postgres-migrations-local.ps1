# SempreDesk — aplicar migrações SQL no Postgres local (Docker Compose).
# Uso (na raiz do repo):  .\scripts\apply-postgres-migrations-local.ps1
#
# Pré-requisitos:
#   - .env na raiz com POSTGRES_USER / POSTGRES_DB (ex.: suporte / suporte_tecnico)
#   - Container a correr:  docker compose up -d postgres
#
# Não inclui 001_renumber_tickets (renumera tickets; só em cenários específicos).

$ErrorActionPreference = "Stop"
# Raiz do repo (pasta onde está docker-compose.yml)
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not (Test-Path (Join-Path $root "docker-compose.yml"))) {
  Write-Host "Erro: docker-compose.yml não encontrado em $root" -ForegroundColor Red
  exit 1
}

$pgUser = "suporte"
$pgDb = "suporte_tecnico"

$files = @(
  "infra/postgres/migrations/002_ticket_settings_color.sql",
  "infra/postgres/migrations/003_device_metrics_history.sql",
  "infra/postgres/migrations/004_users_role_varchar.sql",
  "infra/postgres/migrations/005_chatbot_tables.sql",
  "infra/postgres/migrations/006_ticket_assignment.sql",
  "infra/postgres/migrations/007_agent_presence.sql",
  "infra/postgres/migrations/008_contact_customers.sql",
  "infra/postgres/migrations/009_bot_evaluation_columns.sql",
  "infra/postgres/migrations/010_conversation_messages_external_id_unique.sql",
  "infra/postgres/migrations/011_tenant_licenses.sql",
  "infra/postgres/migrations/012_audit_logs.sql",
  "infra/postgres/migrations/013_tenants_cnpj.sql",
  "infra/postgres/migrations/014_ticket_reply_attachments.sql",
  "infra/postgres/migration_conversation_message_media.sql",
  "infra/postgres/migrations/20260402_ticket_reply_attachments.sql",
  "infra/postgres/migrations/015_perf_indexes.sql",
  "infra/postgres/migrations/016_whatsapp_multi_channel.sql",
  "infra/postgres/migrations/017_whatsapp_connection_meta_waba_id.sql"
)

Write-Host "Repo: $root" -ForegroundColor Cyan

foreach ($rel in $files) {
  $path = Join-Path $root $rel
  if (-not (Test-Path $path)) {
    Write-Host "SKIP (ficheiro inexistente): $rel" -ForegroundColor Yellow
    continue
  }
  Write-Host "`n=== $rel ===" -ForegroundColor Green
  Get-Content $path -Raw -Encoding UTF8 | docker compose exec -T postgres psql -U $pgUser -d $pgDb
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Falhou: $rel (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

Write-Host "`nConcluído. Verificar: docker compose exec -T postgres psql -U $pgUser -d $pgDb -c '\dt'" -ForegroundColor Cyan
