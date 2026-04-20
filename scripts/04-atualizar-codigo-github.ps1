$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot

try {
  Write-Host '==========================================' -ForegroundColor Cyan
  Write-Host 'SempreDesk - Atualizar Codigo pelo GitHub' -ForegroundColor Cyan
  Write-Host '==========================================' -ForegroundColor Cyan
  Write-Host ''

  $branch = git branch --show-current
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw 'Nao foi possivel identificar a branch atual.'
  }

  Write-Host "Branch atual: $branch" -ForegroundColor Yellow
  Write-Host ''

  $statusLines = git status --short
  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel verificar o estado local do Git.'
  }

  if ($statusLines) {
    Write-Host 'Seu repositorio local tem alteracoes pendentes:' -ForegroundColor Red
    $statusLines | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    Write-Host ''
    Write-Host 'Para nao misturar trabalho local com atualizacao do GitHub, finalize, commit ou guarde essas alteracoes antes de atualizar.' -ForegroundColor Yellow
    throw 'Atualizacao cancelada porque existem alteracoes locais pendentes.'
  }

  Write-Host 'Buscando atualizacoes do GitHub...' -ForegroundColor Cyan
  git fetch origin
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao buscar atualizacoes no GitHub.'
  }

  Write-Host ''
  Write-Host "Aplicando git pull --ff-only origin $branch ..." -ForegroundColor Cyan
  git pull --ff-only origin $branch
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao atualizar o codigo local. Verifique conflitos ou o estado da branch.'
  }

  Write-Host ''
  Write-Host 'Codigo local atualizado com sucesso.' -ForegroundColor Green
  Write-Host 'Agora siga com o fluxo local desta maquina.' -ForegroundColor Cyan
} finally {
  Pop-Location
}
