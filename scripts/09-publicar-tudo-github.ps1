$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot

try {
  Write-Host 'SempreDesk - Publicar Tudo no GitHub' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Este fluxo adiciona todas as alteracoes pendentes, cria um commit e faz push para a branch atual.' -ForegroundColor Yellow
  Write-Host ''

  $branch = git branch --show-current
  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel identificar a branch atual.'
  }

  Write-Host "Branch atual: $branch" -ForegroundColor Yellow
  Write-Host ''
  git status --short
  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel ler o status do Git.'
  }

  Write-Host ''
  $message = Read-Host 'Mensagem do commit'
  if ([string]::IsNullOrWhiteSpace($message)) {
    $message = 'feat(agenda): publish pending local changes'
    Write-Host "Mensagem padrao aplicada: $message" -ForegroundColor DarkYellow
  }

  Write-Host ''
  $confirm = Read-Host 'Digite GITHUB para adicionar, commitar e dar push'
  if ($confirm -ne 'GITHUB') {
    throw 'Publicacao no GitHub cancelada pelo usuario.'
  }

  Write-Host ''
  Write-Host 'Adicionando alteracoes...' -ForegroundColor Cyan
  git add -A
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao adicionar alteracoes no Git.'
  }

  Write-Host ''
  Write-Host 'Criando commit...' -ForegroundColor Cyan
  git commit -m $message
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar commit. Verifique se existem alteracoes reais para commitar.'
  }

  Write-Host ''
  Write-Host "Enviando para origin/$branch..." -ForegroundColor Cyan
  git push origin $branch
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao enviar alteracoes para o GitHub.'
  }

  Write-Host ''
  Write-Host 'Publicacao no GitHub concluida com sucesso.' -ForegroundColor Green
  Write-Host 'Agora acompanhe a aba Actions para ver o deploy automatico.' -ForegroundColor Cyan
} finally {
  Pop-Location
}
