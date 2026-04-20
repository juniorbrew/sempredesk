$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host 'SempreDesk - Check Git Local' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

Push-Location $repoRoot

try {
  Write-Host '1. Branch atual:' -ForegroundColor Yellow
  git branch --show-current
  Write-Host ''

  Write-Host '2. Ultimo commit local:' -ForegroundColor Yellow
  git log --oneline --max-count=1
  Write-Host ''

  Write-Host '3. Estado local:' -ForegroundColor Yellow
  git status --short
  Write-Host ''

  Write-Host '4. Lembrete de fluxo:' -ForegroundColor Yellow
  Write-Host '   PC/Notebook -> GitHub -> VPS'
  Write-Host '   Desenvolva com banco local e publique no VPS apenas depois de validar.'
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Check concluido.' -ForegroundColor Cyan
