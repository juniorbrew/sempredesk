$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$repoRoot = Split-Path -Parent $PSScriptRoot
$tabs = $null

function Start-LocalScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  $fullPath = Join-Path $repoRoot $RelativePath

  if (-not (Test-Path -LiteralPath $fullPath)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Arquivo nao encontrado:`r`n$fullPath",
      'SempreDesk',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return
  }

  Start-Process -FilePath $fullPath | Out-Null
}

function Start-LocalScriptAndWait {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  $fullPath = Join-Path $repoRoot $RelativePath

  if (-not (Test-Path -LiteralPath $fullPath)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Arquivo nao encontrado:`r`n$fullPath",
      'SempreDesk',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return $false
  }

  $process = Start-Process -FilePath $fullPath -PassThru
  if ($null -eq $process) {
    return $false
  }

  $process.WaitForExit()
  return $true
}

function Open-LocalFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  $fullPath = Join-Path $repoRoot $RelativePath

  if (-not (Test-Path -LiteralPath $fullPath)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Arquivo nao encontrado:`r`n$fullPath",
      'SempreDesk',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return
  }

  Start-Process -FilePath $fullPath | Out-Null
}

function Show-InfoBox {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

function Invoke-GuidedSequence {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Scripts,
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $result = [System.Windows.Forms.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OKCancel,
    [System.Windows.Forms.MessageBoxIcon]::Information
  )

  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    return
  }

  foreach ($script in $Scripts) {
    $completed = Start-LocalScriptAndWait $script
    if (-not $completed) {
      break
    }
  }
}

function New-SectionTitle {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Control]$Parent,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [Parameter(Mandatory = $true)]
    [int]$Top
  )

  $label = New-Object System.Windows.Forms.Label
  $label.Left = 24
  $label.Top = $Top
  $label.Width = 820
  $label.Height = 34
  $label.Text = $Text
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
  $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#12233d')
  $Parent.Controls.Add($label)
  return $label
}

function New-SectionText {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Control]$Parent,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [Parameter(Mandatory = $true)]
    [int]$Top,
    [Parameter(Mandatory = $true)]
    [int]$Height
  )

  $label = New-Object System.Windows.Forms.Label
  $label.Left = 24
  $label.Top = $Top
  $label.Width = 840
  $label.Height = $Height
  $label.Text = $Text
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#526173')
  $Parent.Controls.Add($label)
  return $label
}

function New-FullButton {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Control]$Parent,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [Parameter(Mandatory = $true)]
    [int]$Top,
    [Parameter(Mandatory = $true)]
    [string]$BackColor,
    [Parameter(Mandatory = $true)]
    [scriptblock]$OnClick
  )

  $button = New-Object System.Windows.Forms.Button
  $button.Left = 24
  $button.Top = $Top
  $button.Width = 820
  $button.Height = 42
  $button.Text = $Text
  $button.Anchor = 'Top,Left'
  $button.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  $button.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $button.BackColor = [System.Drawing.ColorTranslator]::FromHtml($BackColor)
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $button.Add_Click($OnClick)
  $Parent.Controls.Add($button)
  return $button
}

function Add-HomeButton {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Control]$Parent
  )

  $button = New-Object System.Windows.Forms.Button
  $button.Left = 24
  $button.Top = 18
  $button.Width = 220
  $button.Height = 34
  $button.Text = 'Voltar ao Fluxo Principal'
  $button.Anchor = 'Top,Left'
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  $button.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
  $button.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#e7eef7')
  $button.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#12233d')
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $button.Add_Click({
    if ($script:tabs -ne $null) {
      $script:tabs.SelectedIndex = 0
    }
  })
  $Parent.Controls.Add($button)
  return $button
}

function New-GuideBlock {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Control]$Parent,
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Body,
    [Parameter(Mandatory = $true)]
    [int]$Top,
    [Parameter(Mandatory = $true)]
    [string]$AccentColor,
    [Parameter(Mandatory = $true)]
    [string]$ModeText,
    [Parameter(Mandatory = $true)]
    [string]$ExecText,
    [Parameter(Mandatory = $true)]
    [string]$ButtonText,
    [Parameter(Mandatory = $true)]
    [scriptblock]$ButtonAction
  )

  $panel = New-Object System.Windows.Forms.Panel
  $panel.Left = 20
  $panel.Top = $Top
  $panel.Width = 920
  $panel.Height = 170
  $panel.Anchor = 'Top,Left'
  $panel.BackColor = [System.Drawing.Color]::White
  $panel.BorderStyle = 'FixedSingle'
  $Parent.Controls.Add($panel)

  $accent = New-Object System.Windows.Forms.Panel
  $accent.Left = 0
  $accent.Top = 0
  $accent.Width = 10
  $accent.Height = 162
  $accent.BackColor = [System.Drawing.ColorTranslator]::FromHtml($AccentColor)
  $panel.Controls.Add($accent)

  $titleLabel = New-Object System.Windows.Forms.Label
  $titleLabel.Left = 24
  $titleLabel.Top = 14
  $titleLabel.Width = 560
  $titleLabel.Height = 28
  $titleLabel.Text = $Title
  $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $titleLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#12233d')
  $panel.Controls.Add($titleLabel)

  $modeLabel = New-Object System.Windows.Forms.Label
  $modeLabel.Left = 24
  $modeLabel.Top = 38
  $modeLabel.Width = 560
  $modeLabel.Height = 18
  $modeLabel.Text = $ModeText
  $modeLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $modeLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($AccentColor)
  $panel.Controls.Add($modeLabel)

  $actionButton = New-Object System.Windows.Forms.Button
  $actionButton.Left = 700
  $actionButton.Top = 14
  $actionButton.Width = 180
  $actionButton.Height = 38
  $actionButton.Anchor = 'Top,Left'
  $actionButton.Text = $ButtonText
  $actionButton.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $actionButton.FlatStyle = 'Flat'
  $actionButton.FlatAppearance.BorderSize = 1
  $actionButton.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
  $actionButton.UseVisualStyleBackColor = $false
  $actionButton.BackColor = [System.Drawing.ColorTranslator]::FromHtml($AccentColor)
  $actionButton.ForeColor = [System.Drawing.Color]::White
  $actionButton.Cursor = [System.Windows.Forms.Cursors]::Hand
  $actionButton.Add_Click($ButtonAction)
  $panel.Controls.Add($actionButton)

  $bodyLabel = New-Object System.Windows.Forms.Label
  $bodyLabel.Left = 24
  $bodyLabel.Top = 58
  $bodyLabel.Width = 850
  $bodyLabel.Height = 72
  $bodyLabel.Text = $Body
  $bodyLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $bodyLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#405063')
  $panel.Controls.Add($bodyLabel)

  $execLabel = New-Object System.Windows.Forms.Label
  $execLabel.Left = 24
  $execLabel.Top = 134
  $execLabel.Width = 850
  $execLabel.Height = 20
  $execLabel.Text = $ExecText
  $execLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Italic)
  $execLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#5b6b7d')
  $panel.Controls.Add($execLabel)

  return $panel
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'SempreDesk - Painel Local'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1360, 920)
$form.MinimumSize = New-Object System.Drawing.Size(1180, 820)
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#eaf0f7')
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.AutoScaleMode = 'Dpi'

$root = New-Object System.Windows.Forms.Panel
$root.Dock = 'Fill'
$root.Padding = New-Object System.Windows.Forms.Padding(16)
$root.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#eaf0f7')
$form.Controls.Add($root)

$hero = New-Object System.Windows.Forms.Panel
$hero.Dock = 'Top'
$hero.Height = 108
$hero.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#12233d')
$hero.Padding = New-Object System.Windows.Forms.Padding(24, 18, 24, 14)
$root.Controls.Add($hero)

$heroTop = New-Object System.Windows.Forms.Label
$heroTop.Left = 0
$heroTop.Top = 8
$heroTop.Width = 980
$heroTop.Height = 24
$heroTop.Text = 'Use seu PC ou notebook com banco local, publique pelo GitHub e atualize o VPS so depois de validar.'
$heroTop.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$heroTop.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#d6e1f0')
$hero.Controls.Add($heroTop)

$heroTitle = New-Object System.Windows.Forms.Label
$heroTitle.Left = 0
$heroTitle.Top = 42
$heroTitle.Width = 980
$heroTitle.Height = 38
$heroTitle.Text = 'SempreDesk - Painel Local'
$heroTitle.Font = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$heroTitle.ForeColor = [System.Drawing.Color]::White
$hero.Controls.Add($heroTitle)

$script:tabs = New-Object System.Windows.Forms.TabControl
$script:tabs.Dock = 'Fill'
$script:tabs.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$root.Controls.Add($script:tabs)
$script:tabs.BringToFront()

$tabPrincipal = New-Object System.Windows.Forms.TabPage
$tabPrincipal.Text = '1. Fluxo Principal'
$tabPrincipal.BackColor = [System.Drawing.Color]::White
$script:tabs.TabPages.Add($tabPrincipal)

$tabAcoes = New-Object System.Windows.Forms.TabPage
$tabAcoes.Text = '2. Acoes Rapidas'
$tabAcoes.BackColor = [System.Drawing.Color]::White
$script:tabs.TabPages.Add($tabAcoes)

$tabBanco = New-Object System.Windows.Forms.TabPage
$tabBanco.Text = '3. Banco Local'
$tabBanco.BackColor = [System.Drawing.Color]::White
$script:tabs.TabPages.Add($tabBanco)

$tabGuia = New-Object System.Windows.Forms.TabPage
$tabGuia.Text = '4. Guia'
$tabGuia.BackColor = [System.Drawing.Color]::White
$script:tabs.TabPages.Add($tabGuia)

New-SectionTitle -Parent $tabPrincipal -Text 'Fluxo Principal' -Top 24 | Out-Null
New-SectionText -Parent $tabPrincipal -Text 'Comece por aqui quando atualizar codigo ou religar o ambiente local.' -Top 62 -Height 28 | Out-Null

New-FullButton -Parent $tabPrincipal -Text 'Executar sequencia local guiada' -Top 108 -BackColor '#233247' -OnClick {
  Invoke-GuidedSequence -Scripts @(
    'scripts\04-atualizar-codigo-github.bat',
    'scripts\05-check-git-local.bat',
    'scripts\01-restaurar-ambiente-local.bat',
    'scripts\02-aplicar-migracoes-locais.bat',
    'scripts\03-validar-ambiente-local.bat'
  ) -Title 'SempreDesk' -Message "Sequencia recomendada:`r`n`r`n1. Atualizar codigo pelo GitHub`r`n2. Check Git local`r`n3. Restaurar ambiente local`r`n4. Aplicar migracoes locais`r`n5. Validar ambiente local`r`n`r`nDeseja abrir cada passo em sequencia?"
} | Out-Null
New-FullButton -Parent $tabPrincipal -Text '0. Atualizar codigo pelo GitHub' -Top 160 -BackColor '#7f3fbf' -OnClick { Start-LocalScript 'scripts\04-atualizar-codigo-github.bat' } | Out-Null
New-FullButton -Parent $tabPrincipal -Text '1. Check Git local' -Top 212 -BackColor '#6c7b8a' -OnClick { Start-LocalScript 'scripts\05-check-git-local.bat' } | Out-Null
New-FullButton -Parent $tabPrincipal -Text '2. Restaurar ambiente local' -Top 264 -BackColor '#2457d6' -OnClick { Start-LocalScript 'scripts\01-restaurar-ambiente-local.bat' } | Out-Null
New-FullButton -Parent $tabPrincipal -Text '3. Aplicar migracoes locais' -Top 316 -BackColor '#12805c' -OnClick { Start-LocalScript 'scripts\02-aplicar-migracoes-locais.bat' } | Out-Null
New-FullButton -Parent $tabPrincipal -Text '4. Validar ambiente local' -Top 368 -BackColor '#1f3b57' -OnClick { Start-LocalScript 'scripts\03-validar-ambiente-local.bat' } | Out-Null
New-FullButton -Parent $tabPrincipal -Text 'Ir para Guia Assistida' -Top 420 -BackColor '#7f3fbf' -OnClick {
  if ($script:tabs -ne $null) {
    $script:tabs.SelectedIndex = 3
  }
} | Out-Null
New-SectionText -Parent $tabPrincipal -Text 'Fluxo recomendado: Atualizar codigo -> Check Git local -> Restaurar ambiente -> Aplicar migracoes -> Validar ambiente. Para nao se atrapalhar, use a aba Guia.' -Top 488 -Height 44 | Out-Null

Add-HomeButton -Parent $tabAcoes | Out-Null
New-SectionTitle -Parent $tabAcoes -Text 'Acoes Rapidas' -Top 64 | Out-Null
New-SectionText -Parent $tabAcoes -Text 'Atalhos avulsos. No dia a dia, prefira a aba Guia e use os botoes de sequencia automatica.' -Top 102 -Height 42 | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Atualizar codigo desta maquina' -Top 148 -BackColor '#7f3fbf' -OnClick { Start-LocalScript 'scripts\04-atualizar-codigo-github.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir ordem de uso' -Top 200 -BackColor '#7f8c8d' -OnClick { Open-LocalFile 'scripts\00-ORDEM-DE-USO.txt' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir fluxo local para VPS' -Top 252 -BackColor '#7f8c8d' -OnClick { Open-LocalFile 'docs\fluxo-local-vps.md' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir explicacao GitHub Actions x VPS' -Top 304 -BackColor '#7f8c8d' -OnClick { Open-LocalFile 'scripts\workflow-deploy-explicacao.md' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Preparar publicacao local' -Top 356 -BackColor '#7f3fbf' -OnClick { Start-LocalScript 'scripts\08-preparar-publicacao-local.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Publicar tudo no GitHub' -Top 408 -BackColor '#2457d6' -OnClick {
  Show-InfoBox -Title 'Fluxo recomendado' -Message "Este botao adiciona tudo que estiver pendente, cria commit e faz push para o GitHub.`r`n`r`nDepois acompanhe a aba Actions para ver o deploy automatico."
  Start-LocalScript 'scripts\09-publicar-tudo-github.bat'
} | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir comandos de publicacao no VPS' -Top 460 -BackColor '#7f8c8d' -OnClick { Open-LocalFile 'docs\comandos-publicacao-vps.md' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Copiar comandos do VPS' -Top 512 -BackColor '#7f8c8d' -OnClick { Start-LocalScript 'scripts\10-copiar-comandos-vps.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Configurar automacao do VPS' -Top 564 -BackColor '#7f3fbf' -OnClick { Start-LocalScript 'scripts\11-configurar-automacao-vps.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Gerar chave SSH do VPS' -Top 616 -BackColor '#7f8c8d' -OnClick { Start-LocalScript 'scripts\15-gerar-chave-vps.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Copiar chave publica do VPS' -Top 668 -BackColor '#7f8c8d' -OnClick { Start-LocalScript 'scripts\16-copiar-chave-publica-vps.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Iniciar Pageant com a chave do VPS' -Top 720 -BackColor '#7f8c8d' -OnClick { Start-LocalScript 'scripts\17-iniciar-pageant-vps.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir guia de chave SSH do VPS' -Top 772 -BackColor '#7f8c8d' -OnClick { Open-LocalFile 'docs\configurar-chave-ssh-vps.md' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Publicar backend no VPS' -Top 824 -BackColor '#2457d6' -OnClick {
  Show-InfoBox -Title 'Acompanhar deploy' -Message "Este botao executa deploy manual direto no VPS via SSH.`r`n`r`nAcompanhe pelo terminal desta execucao.`r`nNao e a tela principal do GitHub Actions."
  Start-LocalScript 'scripts\12-publicar-backend-vps.bat'
} | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Publicar frontend no VPS' -Top 876 -BackColor '#12805c' -OnClick {
  Show-InfoBox -Title 'Acompanhar deploy' -Message "Este botao executa deploy manual direto no VPS via SSH.`r`n`r`nAcompanhe pelo terminal desta execucao.`r`nNao e a tela principal do GitHub Actions."
  Start-LocalScript 'scripts\13-publicar-frontend-vps.bat'
} | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Publicar backend + frontend no VPS' -Top 928 -BackColor '#7f3fbf' -OnClick {
  Show-InfoBox -Title 'Acompanhar deploy' -Message "Este botao executa deploy manual direto no VPS via SSH.`r`n`r`nAcompanhe pelo terminal desta execucao.`r`nNao e a tela principal do GitHub Actions."
  Start-LocalScript 'scripts\14-publicar-backend-frontend-vps.bat'
} | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir menu interativo' -Top 980 -BackColor '#7f8c8d' -OnClick { Start-LocalScript 'scripts\00-menu-sequencia.bat' } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Abrir pasta do repositorio' -Top 1032 -BackColor '#7f8c8d' -OnClick { Start-Process -FilePath $repoRoot | Out-Null } | Out-Null
New-FullButton -Parent $tabAcoes -Text 'Fechar painel' -Top 1084 -BackColor '#b04c4c' -OnClick { $form.Close() } | Out-Null

Add-HomeButton -Parent $tabBanco | Out-Null
New-SectionTitle -Parent $tabBanco -Text 'Banco Local' -Top 64 | Out-Null
New-SectionText -Parent $tabBanco -Text 'Use banco local no PC e no notebook. Se quiser levar dados de teste de uma maquina para outra, gere backup e depois restaure.' -Top 102 -Height 42 | Out-Null
New-FullButton -Parent $tabBanco -Text 'Gerar backup do banco local' -Top 160 -BackColor '#12805c' -OnClick { Start-LocalScript 'scripts\06-backup-banco-local.bat' } | Out-Null
New-FullButton -Parent $tabBanco -Text 'Restaurar backup do banco local' -Top 212 -BackColor '#c97b14' -OnClick { Start-LocalScript 'scripts\07-restaurar-banco-local.bat' } | Out-Null
New-SectionText -Parent $tabBanco -Text 'O banco e local em cada maquina. O codigo viaja pelo GitHub. O banco local viaja por backup somente quando voce quiser continuar o mesmo teste em outra maquina.' -Top 264 -Height 80 | Out-Null

Add-HomeButton -Parent $tabGuia | Out-Null
New-SectionTitle -Parent $tabGuia -Text 'Guia de Uso' -Top 64 | Out-Null
New-SectionText -Parent $tabGuia -Text 'Use esta aba como caminho principal. Escolha a subaba abaixo e clique no botao da sequencia automatica.' -Top 102 -Height 42 | Out-Null

$guideTabs = New-Object System.Windows.Forms.TabControl
$guideTabs.Left = 16
$guideTabs.Top = 144
$guideTabs.Width = 980
$guideTabs.Height = 700
$guideTabs.Anchor = 'Top,Left,Right,Bottom'
$guideTabs.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$tabGuia.Controls.Add($guideTabs)

$guidePc = New-Object System.Windows.Forms.TabPage
$guidePc.Text = 'PC'
$guidePc.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#f6f9fc')
$guidePc.AutoScroll = $true
$guideTabs.TabPages.Add($guidePc)

$guideNotebook = New-Object System.Windows.Forms.TabPage
$guideNotebook.Text = 'Notebook'
$guideNotebook.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#f6f9fc')
$guideNotebook.AutoScroll = $true
$guideTabs.TabPages.Add($guideNotebook)

$guidePublish = New-Object System.Windows.Forms.TabPage
$guidePublish.Text = 'Publicacao'
$guidePublish.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#f6f9fc')
$guidePublish.AutoScroll = $true
$guideTabs.TabPages.Add($guidePublish)

New-GuideBlock -Parent $guidePc -Title 'Estou no PC e vou comecar o trabalho' -Top 16 -AccentColor '#2457d6' -ModeText 'Este botao executa scripts automaticamente' -ExecText 'Executa: 04-atualizar-codigo-github -> 05-check-git-local -> 01-restaurar -> 02-migracoes -> 03-validar' -ButtonText 'Executar inicio no PC' -ButtonAction {
  Invoke-GuidedSequence -Scripts @(
    'scripts\04-atualizar-codigo-github.bat',
    'scripts\05-check-git-local.bat',
    'scripts\01-restaurar-ambiente-local.bat',
    'scripts\02-aplicar-migracoes-locais.bat',
    'scripts\03-validar-ambiente-local.bat'
  ) -Title 'Iniciar no PC' -Message "Vou abrir a sequencia recomendada para comecar no PC:`r`n`r`n1. Atualizar codigo pelo GitHub`r`n2. Check Git local`r`n3. Restaurar ambiente local`r`n4. Aplicar migracoes locais`r`n5. Validar ambiente local"
} -Body "1. Abrir a pasta local do SempreDesk.`r`n2. Atualizar o codigo pelo GitHub.`r`n3. Rodar: Check Git local -> Restaurar ambiente -> Aplicar migracoes -> Validar ambiente.`r`n4. Trabalhar normalmente com o banco local do PC." | Out-Null

New-GuideBlock -Parent $guidePc -Title 'Terminei o trabalho no PC' -Top 196 -AccentColor '#12805c' -ModeText 'Este botao executa scripts automaticamente' -ExecText 'Executa: 06-backup-banco-local' -ButtonText 'Executar fim no PC' -ButtonAction {
  Invoke-GuidedSequence -Scripts @(
    'scripts\06-backup-banco-local.bat'
  ) -Title 'Encerrar no PC' -Message "Vou abrir a sequencia de encerramento no PC:`r`n`r`n1. Backup do banco local`r`n`r`nUse o backup quando quiser levar seus dados de teste para outra maquina."
} -Body "1. Validar se tudo funcionou localmente.`r`n2. Fazer commit e push.`r`n3. Gerar backup se quiser continuar o mesmo teste em outra maquina." | Out-Null

New-GuideBlock -Parent $guideNotebook -Title 'Estou no notebook e vou comecar o trabalho' -Top 16 -AccentColor '#c97b14' -ModeText 'Este botao executa scripts automaticamente' -ExecText 'Executa: 04-atualizar-codigo-github -> 05-check-git-local -> 01-restaurar -> 02-migracoes -> 03-validar' -ButtonText 'Executar inicio no notebook' -ButtonAction {
  Invoke-GuidedSequence -Scripts @(
    'scripts\04-atualizar-codigo-github.bat',
    'scripts\05-check-git-local.bat',
    'scripts\01-restaurar-ambiente-local.bat',
    'scripts\02-aplicar-migracoes-locais.bat',
    'scripts\03-validar-ambiente-local.bat'
  ) -Title 'Usar no notebook' -Message "Vou abrir a sequencia recomendada para trabalhar no notebook:`r`n`r`n1. Atualizar codigo pelo GitHub`r`n2. Check Git local`r`n3. Restaurar ambiente local`r`n4. Aplicar migracoes locais`r`n5. Validar ambiente local`r`n`r`nSe voce trouxe um backup .sql do PC, restaure depois pela aba Banco Local."
} -Body "1. Clonar ou atualizar o repositorio no notebook.`r`n2. Abrir o painel local.`r`n3. Rodar: Check Git local -> Restaurar ambiente -> Aplicar migracoes -> Validar ambiente.`r`n4. Se quiser, restaurar um backup .sql do PC.`r`n5. Trabalhar com o banco local do notebook." | Out-Null

New-GuideBlock -Parent $guideNotebook -Title 'Terminei o trabalho no notebook' -Top 196 -AccentColor '#8a5a14' -ModeText 'Este botao executa scripts automaticamente' -ExecText 'Executa: 06-backup-banco-local' -ButtonText 'Executar fim no notebook' -ButtonAction {
  Invoke-GuidedSequence -Scripts @(
    'scripts\06-backup-banco-local.bat'
  ) -Title 'Encerrar no notebook' -Message "Vou abrir a sequencia de encerramento no notebook:`r`n`r`n1. Backup do banco local`r`n`r`nUse o backup quando quiser continuar os mesmos testes no PC."
} -Body "1. Validar localmente no notebook.`r`n2. Fazer commit e push.`r`n3. Gerar backup se quiser continuar no PC." | Out-Null

New-GuideBlock -Parent $guidePublish -Title 'Quero publicar no GitHub (recomendado)' -Top 16 -AccentColor '#2457d6' -ModeText 'Este botao executa a sequencia recomendada para publicar' -ExecText 'Executa: 08-preparar-publicacao-local -> 09-publicar-tudo-github' -ButtonText 'Executar publicacao GitHub' -ButtonAction {
  Invoke-GuidedSequence -Scripts @(
    'scripts\08-preparar-publicacao-local.bat',
    'scripts\09-publicar-tudo-github.bat'
  ) -Title 'Publicar no GitHub' -Message "Vou abrir a sequencia recomendada para publicar com seguranca:`r`n`r`n1. Preparar publicacao local`r`n2. Publicar tudo no GitHub`r`n`r`nDepois acompanhe a aba Actions para ver o deploy automatico."
} -Body "1. Validar localmente antes de publicar.`r`n2. Rodar a preparacao local.`r`n3. Criar commit e dar push para o GitHub.`r`n4. Acompanhar a aba Actions ate o workflow ficar verde." | Out-Null

New-GuideBlock -Parent $guidePublish -Title 'Quero publicar no VPS manualmente' -Top 196 -AccentColor '#7f3fbf' -ModeText 'Use somente como contingencia. O fluxo principal deve passar pelo GitHub.' -ExecText 'Abre: checklist-publicacao-vps.md, comandos-publicacao-vps.md e workflow-deploy-explicacao.md' -ButtonText 'Abrir checklist do VPS' -ButtonAction {
  Open-LocalFile 'docs\checklist-publicacao-vps.md'
  Start-Sleep -Milliseconds 300
  Open-LocalFile 'docs\comandos-publicacao-vps.md'
  Start-Sleep -Milliseconds 300
  Open-LocalFile 'scripts\workflow-deploy-explicacao.md'
} -Body "1. Publicar somente depois de validar localmente.`r`n2. Confirmar que o codigo correto esta no GitHub.`r`n3. Atualizar o VPS apenas depois disso.`r`n4. O fluxo correto e sempre: PC ou Notebook -> GitHub -> VPS." | Out-Null

$statusBar = New-Object System.Windows.Forms.StatusStrip
$statusBar.Dock = 'Bottom'
$statusBar.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#dfe8f3')

$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = 'Fluxo sugerido: PC/Notebook -> GitHub -> VPS'
$statusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$statusBar.Items.Add($statusLabel) | Out-Null
$form.Controls.Add($statusBar)

$form.Add_Shown({
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Maximized
  $form.BringToFront()
  $form.Activate()
})

[void]$form.ShowDialog()
