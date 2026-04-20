$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$targets = @(
  (Join-Path $repoRoot 'frontend\.next'),
  (Join-Path $repoRoot 'backend\dist'),
  (Join-Path $repoRoot 'frontend\node_modules'),
  (Join-Path $repoRoot 'backend\node_modules')
)

Write-Host 'Limpando artefatos locais pesados do SempreDesk...' -ForegroundColor Cyan

foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) {
    $resolved = (Resolve-Path -LiteralPath $target).Path
    if ($resolved -ne $target) {
      throw "Resolved path mismatch: $resolved"
    }

    Write-Host "Removendo $target" -ForegroundColor Yellow
    Remove-Item -LiteralPath $target -Recurse -Force
  } else {
    Write-Host "Já ausente: $target" -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host 'Limpeza concluída. O código-fonte foi preservado.' -ForegroundColor Green
Write-Host ''
Write-Host 'Para reativar o ambiente depois:' -ForegroundColor Cyan
Write-Host "1. cd $repoRoot\backend"
Write-Host '   npm.cmd install'
Write-Host '   npm.cmd run build'
Write-Host ''
Write-Host "2. cd $repoRoot\frontend"
Write-Host '   npm.cmd install'
Write-Host '   npm.cmd run build'
Write-Host ''
Write-Host "3. cd $repoRoot"
Write-Host '   docker compose up -d --build backend frontend'
