$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot 'backend'
$frontendPath = Join-Path $repoRoot 'frontend'

Write-Host 'Restaurando ambiente local do SempreDesk...' -ForegroundColor Cyan
Write-Host ''

Write-Host '1. Instalando dependências do backend...' -ForegroundColor Yellow
Push-Location $backendPath
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências do backend.' }

Write-Host '2. Buildando backend...' -ForegroundColor Yellow
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falha no build do backend.' }
Pop-Location

Write-Host ''
Write-Host '3. Instalando dependências do frontend...' -ForegroundColor Yellow
Push-Location $frontendPath
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências do frontend.' }

Write-Host '4. Buildando frontend...' -ForegroundColor Yellow
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falha no build do frontend.' }
Pop-Location

Write-Host ''
Write-Host '5. Subindo containers backend e frontend...' -ForegroundColor Yellow
Push-Location $repoRoot
docker compose up -d --build backend frontend
if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir os containers backend/frontend.' }
Pop-Location

Write-Host ''
Write-Host 'Ambiente restaurado com sucesso.' -ForegroundColor Green
Write-Host 'Frontend local: http://localhost:3000' -ForegroundColor Cyan
Write-Host 'Backend local:  http://localhost:4000/api/v1' -ForegroundColor Cyan
