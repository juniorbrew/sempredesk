$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host 'SempreDesk - Validar Ambiente Local' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

Push-Location $repoRoot

try {
  Write-Host '1. Status dos containers:' -ForegroundColor Yellow
  docker compose ps
  Write-Host ''

  Write-Host '2. Teste frontend local (http://localhost:3000):' -ForegroundColor Yellow
  try {
    $frontend = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000'
    Write-Host "Frontend OK - status $($frontend.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "Frontend com problema: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''

  Write-Host '3. Teste backend health (http://localhost:4000/api/v1/health):' -ForegroundColor Yellow
  try {
    $backend = Invoke-WebRequest -UseBasicParsing 'http://localhost:4000/api/v1/health'
    Write-Host "Backend OK - status $($backend.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "Backend com problema: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''

  Write-Host '4. Teste login demo pelo frontend (http://localhost:3000/api/v1/auth/login):' -ForegroundColor Yellow
  try {
    $loginBody = '{"email":"admin@demo.com","password":"Admin@123"}'
    $login = Invoke-WebRequest -Method Post -UseBasicParsing 'http://localhost:3000/api/v1/auth/login' -ContentType 'application/json' -Body $loginBody
    Write-Host "Login demo OK - status $($login.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "Login demo com problema: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''

  Write-Host '5. Portas locais:' -ForegroundColor Yellow
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3000, 4000, 5432, 6379, 5672 } |
    Select-Object LocalAddress, LocalPort, OwningProcess |
    Sort-Object LocalPort
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Validacao concluida.' -ForegroundColor Cyan
