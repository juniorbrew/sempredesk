$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$keysDir = Join-Path $repoRoot 'scripts\keys'
$privateKeyPath = Join-Path $keysDir 'sempredesk-vps.ppk'
$publicKeyPath = Join-Path $keysDir 'sempredesk-vps.pub'
$puttygenPath = 'C:\Program Files\PuTTY\puttygen.exe'

if (-not (Test-Path -LiteralPath $puttygenPath)) {
  throw "puttygen.exe nao encontrado em $puttygenPath"
}

New-Item -ItemType Directory -Path $keysDir -Force | Out-Null

if (Test-Path -LiteralPath $privateKeyPath) {
  Write-Host 'A chave privada ja existe.' -ForegroundColor Yellow
  Write-Host $privateKeyPath -ForegroundColor Cyan
  exit 0
}

Write-Host 'Gerando chave SSH do SempreDesk para o VPS...' -ForegroundColor Cyan

& $puttygenPath -t ed25519 -C "sempredesk-vps" -o $privateKeyPath
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao gerar a chave privada.'
}

& $puttygenPath $privateKeyPath -L | Set-Content -LiteralPath $publicKeyPath -Encoding ascii
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao exportar a chave publica.'
}

Write-Host ''
Write-Host 'Chaves geradas com sucesso.' -ForegroundColor Green
Write-Host "Privada: $privateKeyPath" -ForegroundColor Cyan
Write-Host "Publica: $publicKeyPath" -ForegroundColor Cyan
