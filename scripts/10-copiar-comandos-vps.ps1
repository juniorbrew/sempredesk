$ErrorActionPreference = 'Stop'

$commands = @"
cd /opt/suporte-tecnico
git pull --ff-only origin main
docker compose up --build -d backend frontend
docker compose ps
"@

$commands | Set-Clipboard

Write-Host 'Comandos do VPS copiados para a area de transferencia.' -ForegroundColor Green
