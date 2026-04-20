# SempreDesk - Fluxo Local -> GitHub -> VPS

Este fluxo foi pensado para voce trabalhar com seguranca no PC de casa ou no notebook, sempre usando banco local durante o desenvolvimento e sem depender de mexer direto na producao.

## Objetivo

- Desenvolver localmente no PC ou notebook
- Usar banco local em cada maquina
- Versionar tudo no GitHub
- Publicar no VPS apenas quando estiver validado
- Evitar impacto na producao durante o desenvolvimento

## Regra principal

O codigo viaja pelo GitHub.

O banco nao deve viajar pelo OneDrive.

Cada maquina pode ter seu proprio banco local Docker para testes. Se voce quiser reaproveitar dados locais entre maquinas, use backup e restauracao do Postgres local.

## Fluxo recomendado no dia a dia

### 1. Em qualquer maquina, comece atualizando o codigo

1. Abra a pasta local do projeto
2. Atualize o repositorio pelo GitHub
3. Restaure o ambiente local
4. Aplique as migracoes locais
5. Valide o ambiente

Arquivos prontos para isso:

- `scripts/01-restaurar-ambiente-local.bat`
- `scripts/02-aplicar-migracoes-locais.bat`
- `scripts/03-validar-ambiente-local.bat`
- `scripts/05-check-git-local.bat`

## Sequencia local recomendada

1. `05-check-git-local.bat`
2. `01-restaurar-ambiente-local.bat`
3. `02-aplicar-migracoes-locais.bat`
4. `03-validar-ambiente-local.bat`

## Durante o desenvolvimento

- Trabalhe localmente no frontend e backend
- Teste tudo contra o banco local Docker
- Nao use o banco do VPS para desenvolver
- Nao altere a producao para testar codigo inacabado

## Quando terminar uma alteracao

1. Validar localmente
2. Commitar no Git
3. Subir para o GitHub
4. Atualizar o VPS
5. Rebuildar os servicos necessarios no VPS
6. Validar a producao

## Fluxo seguro de publicacao

### Etapa A - Local

1. Confirmar que o ambiente local esta OK
2. Confirmar que as migracoes novas foram aplicadas localmente
3. Fazer commit
4. Dar push para o GitHub

### Etapa B - VPS

1. Entrar no repositorio do VPS
2. `git pull --ff-only origin main`
3. Rodar rebuild somente do que mudou
4. Se houve mudanca de banco, aplicar migracoes correspondentes
5. Validar o sistema em producao

## Banco local em duas maquinas

Voce pode seguir de duas formas:

### Opcao 1 - Banco local independente em cada maquina

Melhor para estabilidade.

- PC tem seu Postgres local
- Notebook tem seu Postgres local
- O codigo e sincronizado por GitHub
- Cada maquina roda suas proprias migracoes

### Opcao 2 - Levar uma copia do banco local de uma maquina para outra

Melhor quando voce quer continuar um teste com os mesmos dados.

Use os scripts:

- `scripts/06-backup-banco-local.bat`
- `scripts/07-restaurar-banco-local.bat`

## O que nunca fazer

- Nao usar OneDrive para sincronizar `node_modules`, `.next`, `dist` ou volume de banco
- Nao usar o banco do VPS como banco de desenvolvimento
- Nao alterar codigo direto no VPS e depois esquecer de subir para o GitHub
- Nao publicar no VPS sem validar localmente antes

## Fechando o uso local

Quando terminar o trabalho na maquina:

1. Fazer commit e push do codigo que deve viajar
2. Se quiser levar dados locais para outra maquina, gerar backup do banco local
3. Rodar `scripts/04-limpar-onedrive-apos-uso.bat`

## Resumo pratico

PC ou notebook:

1. Atualizar codigo
2. Restaurar ambiente
3. Aplicar migracoes
4. Validar
5. Desenvolver localmente
6. Commitar e subir para GitHub
7. Publicar no VPS so depois

Esse e o modelo mais seguro para manter a producao estavel e permitir que voce trabalhe de qualquer lugar.
