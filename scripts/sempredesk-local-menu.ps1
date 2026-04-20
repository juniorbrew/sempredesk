$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Run-Script {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath
  )

  Push-Location $repoRoot
  try {
    & $ScriptPath
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao executar $ScriptPath"
    }
  } finally {
    Pop-Location
  }
}

while ($true) {
  Clear-Host
  Write-Host 'SempreDesk - Menu Local' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '1. Check Git local'
  Write-Host '2. Restaurar ambiente local'
  Write-Host '3. Aplicar migracoes locais'
  Write-Host '4. Validar ambiente local'
  Write-Host '5. Backup do banco local'
  Write-Host '6. Restaurar backup do banco local'
  Write-Host '7. Mostrar ordem de uso'
  Write-Host '8. Limpar artefatos pesados do OneDrive'
  Write-Host '9. Sair'
  Write-Host ''

  $choice = Read-Host 'Escolha uma opcao'

  switch ($choice) {
    '1' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot '05-check-git-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '2' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot 'restore-local-dev.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '3' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot 'apply-postgres-migrations-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '4' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot '03-validar-ambiente-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '5' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot '06-backup-banco-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '6' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot '07-restaurar-banco-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '7' {
      Get-Content (Join-Path $PSScriptRoot '00-ORDEM-DE-USO.txt')
      Write-Host ''
      Read-Host 'Pressione Enter para voltar ao menu'
    }
    '8' {
      Run-Script -ScriptPath (Join-Path $PSScriptRoot 'cleanup-onedrive-local.ps1')
      Write-Host ''
      Read-Host 'Concluido. Pressione Enter para voltar ao menu'
    }
    '9' {
      break
    }
    default {
      Write-Host ''
      Write-Host 'Opcao invalida.' -ForegroundColor Yellow
      Start-Sleep -Seconds 1
    }
  }
}
