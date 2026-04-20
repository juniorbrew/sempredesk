# SempreDesk - Checklist de Publicacao no VPS

Use este checklist antes de atualizar a producao.

## Antes de publicar

1. Validar localmente no PC ou notebook
2. Confirmar que o codigo correto foi commitado
3. Confirmar que o push para o GitHub foi feito
4. Confirmar se existem migracoes novas
5. Confirmar se a alteracao nao depende do banco local

## Fluxo correto

PC ou Notebook -> GitHub -> VPS

## No VPS

1. Entrar na pasta do projeto no VPS
2. Atualizar o repositorio com o codigo certo
3. Aplicar migracoes se necessario
4. Rebuildar apenas os servicos necessarios
5. Validar a aplicacao em producao

## Regras importantes

- Nao desenvolver direto no VPS
- Nao usar o banco do VPS para testes locais
- Nao publicar sem validar localmente antes
- Nao esquecer de checar se a alteracao depende de migration
