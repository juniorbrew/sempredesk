$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$publicKeyPath = Join-Path $repoRoot 'scripts\keys\sempredesk-vps.pub'

if (-not (Test-Path -LiteralPath $publicKeyPath)) {
  throw "Chave publica nao encontrada em $publicKeyPath. Rode primeiro scripts\\15-gerar-chave-vps.bat"
}

$content = Get-Content -LiteralPath $publicKeyPath -Raw
$content | Set-Clipboard

Write-Host 'Chave publica copiada para a area de transferencia.' -ForegroundColor Green
Write-Host 'Agora cole essa chave no arquivo ~/.ssh/authorized_keys do usuario edson no VPS.' -ForegroundColor Cyan
