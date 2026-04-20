$ErrorActionPreference = 'Stop'

function Get-VpsAutomationConfigPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  return Join-Path $RepoRoot 'scripts\vps-automation.local.json'
}

function Get-VpsAutomationConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $configPath = Get-VpsAutomationConfigPath -RepoRoot $RepoRoot
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Configuracao do VPS nao encontrada em $configPath. Rode primeiro scripts\\11-configurar-automacao-vps.bat"
  }

  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $hasAlias = $config.PSObject.Properties.Name -contains 'sshAlias' -and [string]::IsNullOrWhiteSpace([string]$config.sshAlias) -eq $false
  $hasPlinkTarget = [string]::IsNullOrWhiteSpace([string]$config.host) -eq $false -and [string]::IsNullOrWhiteSpace([string]$config.user) -eq $false

  if ((-not $hasAlias) -and (-not $hasPlinkTarget)) {
    throw 'Configuracao do VPS incompleta. Revise o arquivo local de automacao.'
  }

  if ([string]::IsNullOrWhiteSpace([string]$config.repoPath)) {
    throw 'Configuracao do VPS sem repoPath. Revise o arquivo local de automacao.'
  }

  if (-not $config.port) {
    $config | Add-Member -NotePropertyName port -NotePropertyValue 22
  }

  return $config
}

function Get-PlinkPathFromConfig {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Config
  )

  $configured = [string]$Config.plinkPath
  if ($configured -and (Test-Path -LiteralPath $configured)) {
    return $configured
  }

  $cmd = Get-Command plink.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw 'plink.exe nao encontrado. Instale o PuTTY ou ajuste plinkPath na configuracao local.'
}

function Invoke-VpsCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$CommandLabel,
    [Parameter(Mandatory = $true)]
    [string]$RemoteCommand,
    [switch]$RequireConfirmation
  )

  $config = Get-VpsAutomationConfig -RepoRoot $RepoRoot
  $hasAlias = $config.PSObject.Properties.Name -contains 'sshAlias' -and [string]::IsNullOrWhiteSpace([string]$config.sshAlias) -eq $false

  Write-Host ''
  Write-Host "SempreDesk - $CommandLabel" -ForegroundColor Cyan
  if ($hasAlias) {
    Write-Host "Destino SSH alias: $($config.sshAlias)" -ForegroundColor Yellow
  } else {
    Write-Host "Destino: $($config.user)@$($config.host):$($config.port)" -ForegroundColor Yellow
  }
  Write-Host "Repo VPS: $($config.repoPath)" -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Comando remoto:' -ForegroundColor Yellow
  Write-Host $RemoteCommand -ForegroundColor Gray

  if ($RequireConfirmation) {
    Write-Host ''
    $confirm = Read-Host 'Digite PUBLICAR para continuar'
    if ($confirm -ne 'PUBLICAR') {
      throw 'Publicacao cancelada pelo usuario.'
    }
  }

  if ($hasAlias) {
    $sshCmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if (-not $sshCmd) {
      throw 'ssh.exe nao encontrado. O alias SSH depende do OpenSSH do Windows.'
    }

    & $sshCmd.Source $config.sshAlias $RemoteCommand
  } else {
    $plinkPath = Get-PlinkPathFromConfig -Config $config
    $target = "$($config.user)@$($config.host)"
    $plinkArgs = @()
    if ($config.hostKey) {
      $plinkArgs += '-hostkey'
      $plinkArgs += [string]$config.hostKey
    }
    if ($config.port) {
      $plinkArgs += '-P'
      $plinkArgs += [string]$config.port
    }
    $plinkArgs += $target
    $plinkArgs += $RemoteCommand
    & $plinkPath @plinkArgs
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar comando remoto ($CommandLabel)."
  }
}

function New-VersionedRemoteCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,
    [Parameter(Mandatory = $true)]
    [string]$ComposeCommand
  )

  $template = @'
cd __REPO_PATH__ && git pull --ff-only origin main && APP_BASE_VERSION="1.0.0" && APP_GIT_SHA=$(git rev-parse HEAD) && APP_GIT_SHORT_SHA=$(git rev-parse --short HEAD) && APP_VERSION="v${APP_BASE_VERSION}+manual.$(date +%Y%m%d%H%M)-${APP_GIT_SHORT_SHA}" && APP_BUILD_SOURCE="manual-ssh" && export APP_VERSION APP_GIT_SHA APP_GIT_SHORT_SHA APP_BUILD_SOURCE NEXT_PUBLIC_APP_VERSION="$APP_VERSION" NEXT_PUBLIC_APP_GIT_SHA="$APP_GIT_SHORT_SHA" && echo "Release: $APP_VERSION ($APP_GIT_SHORT_SHA)" && __COMPOSE_COMMAND__
'@

  return $template.Replace('__REPO_PATH__', $RepoPath).Replace('__COMPOSE_COMMAND__', $ComposeCommand)
}
