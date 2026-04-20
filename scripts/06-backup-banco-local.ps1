$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups\local-db'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputFile = Join-Path $backupDir ("sempredesk-local-" + $timestamp + ".sql")

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Write-Host 'Gerando backup do banco local do SempreDesk...' -ForegroundColor Cyan
Write-Host "Arquivo: $outputFile" -ForegroundColor Yellow

Push-Location $repoRoot

try {
  docker compose exec -T postgres pg_dump -U suporte -d suporte_tecnico > $outputFile
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao gerar backup do banco local.'
  }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Backup concluido com sucesso.' -ForegroundColor Green
Write-Host $outputFile -ForegroundColor Cyan
