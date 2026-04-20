$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $repoRoot 'scripts\keys\sempredesk-vps.ppk'
$pageantPath = 'C:\Program Files\PuTTY\pageant.exe'

if (-not (Test-Path -LiteralPath $pageantPath)) {
  throw "pageant.exe nao encontrado em $pageantPath"
}

if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Chave privada nao encontrada em $privateKeyPath. Rode primeiro scripts\\15-gerar-chave-vps.bat"
}

Start-Process -FilePath $pageantPath -ArgumentList "`"$privateKeyPath`""

Write-Host 'Pageant iniciado com a chave do VPS.' -ForegroundColor Green
Write-Host 'Se a chave tiver passphrase, o Pageant pode pedir a senha uma vez.' -ForegroundColor Cyan
