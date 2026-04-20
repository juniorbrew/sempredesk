$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'vps-publish.shared.ps1')

$configPath = Get-VpsAutomationConfigPath -RepoRoot $repoRoot
$defaultHostKey = 'ssh-ed25519 255 SHA256:o2Ml1hshlP6VJ+d+ddGRPlU04cLfpOvCEweZ0N8eTyU'
$defaultRepoPath = '/opt/suporte-tecnico'
$defaultPlink = 'C:\Program Files\PuTTY\plink.exe'
$defaultPort = 22

$current = $null
if (Test-Path -LiteralPath $configPath) {
  $current = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

Write-Host 'Configurar automacao do VPS' -ForegroundColor Cyan
Write-Host ''

$sshAliasInput = Read-Host ("Alias SSH do Windows" + $(if ($current -and $current.sshAlias) { " [$($current.sshAlias)]" } else { ' [vazio para usar host/porta]' }))
if (-not $sshAliasInput) { $sshAliasInput = if ($current -and $current.sshAlias) { $current.sshAlias } else { '' } }

$vpsHostInput = Read-Host ("Host/IP do VPS" + $(if ($current -and $current.host) { " [$($current.host)]" } else { '' }))
if (-not $vpsHostInput) { $vpsHostInput = if ($current) { $current.host } else { '' } }

$sshUserInput = Read-Host ("Usuario SSH" + $(if ($current -and $current.user) { " [$($current.user)]" } else { ' [root]' }))
if (-not $sshUserInput) { $sshUserInput = if ($current) { $current.user } else { '' } }
if (-not $sshUserInput) { $sshUserInput = 'root' }

if ($vpsHostInput -match '^(?<user>[^@]+)@(?<host>.+)$') {
  if (-not $sshUserInput -or $sshUserInput -eq 'root') {
    $sshUserInput = $Matches.user
  }
  $vpsHostInput = $Matches.host
}

$sshPortInput = Read-Host ("Porta SSH" + $(if ($current -and $current.port) { " [$($current.port)]" } else { " [$defaultPort]" }))
if (-not $sshPortInput) { $sshPortInput = if ($current -and $current.port) { $current.port } else { $defaultPort } }

$repoPath = Read-Host ("Caminho do repo no VPS" + $(if ($current -and $current.repoPath) { " [$($current.repoPath)]" } else { " [$defaultRepoPath]" }))
if (-not $repoPath) { $repoPath = if ($current) { $current.repoPath } else { '' } }
if (-not $repoPath) { $repoPath = $defaultRepoPath }

$hostKey = Read-Host ("Host key do VPS" + $(if ($current -and $current.hostKey) { " [$($current.hostKey)]" } else { " [$defaultHostKey]" }))
if (-not $hostKey) { $hostKey = if ($current) { $current.hostKey } else { '' } }
if (-not $hostKey) { $hostKey = $defaultHostKey }

$plinkPath = Read-Host ("Caminho do plink.exe" + $(if ($current -and $current.plinkPath) { " [$($current.plinkPath)]" } else { " [$defaultPlink]" }))
if (-not $plinkPath) { $plinkPath = if ($current) { $current.plinkPath } else { '' } }
if (-not $plinkPath) { $plinkPath = $defaultPlink }

$config = [ordered]@{
  sshAlias = $sshAliasInput
  host = $vpsHostInput
  user = $sshUserInput
  port = [int]$sshPortInput
  repoPath = $repoPath
  hostKey = $hostKey
  plinkPath = $plinkPath
}

$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host ''
Write-Host 'Configuracao salva com sucesso.' -ForegroundColor Green
Write-Host $configPath -ForegroundColor Cyan
