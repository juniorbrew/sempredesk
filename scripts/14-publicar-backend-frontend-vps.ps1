$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'vps-publish.shared.ps1')

$config = Get-VpsAutomationConfig -RepoRoot $repoRoot
$remoteCommand = New-VersionedRemoteCommand -RepoPath $config.repoPath -ComposeCommand 'docker compose up --build -d backend frontend && docker compose ps'

Invoke-VpsCommand -RepoRoot $repoRoot -CommandLabel 'Publicar backend e frontend no VPS' -RemoteCommand $remoteCommand -RequireConfirmation
