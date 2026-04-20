$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups\local-db'

Write-Host 'Restaurar banco local do SempreDesk' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $backupDir)) {
  throw "Pasta de backups nao encontrada: $backupDir"
}

$files = Get-ChildItem -LiteralPath $backupDir -Filter '*.sql' | Sort-Object LastWriteTime -Descending

if (-not $files) {
  throw 'Nenhum backup .sql encontrado na pasta backups\local-db.'
}

Write-Host 'Backups disponiveis:' -ForegroundColor Yellow
for ($i = 0; $i -lt $files.Count; $i++) {
  Write-Host "$($i + 1). $($files[$i].Name)"
}

Write-Host ''
$choice = Read-Host 'Digite o numero do backup que deseja restaurar'

$parsedChoice = 0
if (-not [int]::TryParse($choice, [ref]$parsedChoice)) {
  throw 'Opcao invalida.'
}

$index = $parsedChoice - 1

if ($index -lt 0 -or $index -ge $files.Count) {
  throw 'Opcao fora da lista.'
}

$selectedFile = $files[$index].FullName

Write-Host ''
Write-Host 'ATENCAO: esta operacao apaga e recria o banco local suporte_tecnico.' -ForegroundColor Yellow
$confirm = Read-Host 'Digite RESTAURAR para continuar'

if ($confirm -ne 'RESTAURAR') {
  throw 'Operacao cancelada pelo usuario.'
}

Push-Location $repoRoot

try {
  docker compose exec -T postgres psql -U suporte -d postgres -c "DROP DATABASE IF EXISTS suporte_tecnico;"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao apagar banco local.' }

  docker compose exec -T postgres psql -U suporte -d postgres -c "CREATE DATABASE suporte_tecnico;"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao recriar banco local.' }

  Get-Content -LiteralPath $selectedFile -Raw | docker compose exec -T postgres psql -U suporte -d suporte_tecnico
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar backup.' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Banco local restaurado com sucesso.' -ForegroundColor Green
