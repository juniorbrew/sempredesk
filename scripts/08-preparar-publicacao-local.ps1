$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Run-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  Write-Host ''
  Write-Host "=== $Label ===" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Falha em: $Label"
  }
}

Push-Location $repoRoot

try {
  Write-Host 'SempreDesk - Preparar Publicacao Local' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Esta rotina prepara a publicacao com seguranca antes do VPS.' -ForegroundColor Yellow
  Write-Host ''

  Run-Step -Label '1. Check Git local' -Action {
    & powershell -ExecutionPolicy Bypass -File ".\scripts\05-check-git-local.ps1"
  }

  Run-Step -Label '2. Validar ambiente local' -Action {
    & powershell -ExecutionPolicy Bypass -File ".\scripts\03-validar-ambiente-local.ps1"
  }

  Write-Host ''
  $openChecklist = Read-Host 'Deseja abrir o checklist do VPS agora? (S/N)'
  if ($openChecklist -match '^(S|s)$') {
    Start-Process -FilePath (Join-Path $repoRoot 'docs\checklist-publicacao-vps.md') | Out-Null
  }

  Write-Host ''
  Write-Host 'Preparacao local concluida.' -ForegroundColor Green
  Write-Host 'Proximo passo: revisar commit/push e so depois atualizar o VPS.' -ForegroundColor Cyan
} finally {
  Pop-Location
}
