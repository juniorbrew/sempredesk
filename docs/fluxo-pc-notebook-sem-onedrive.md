# SempreDesk - Fluxo PC e Notebook sem OneDrive

## Regra principal

- O repositorio ativo fica fora do OneDrive.
- O codigo sincroniza somente pelo GitHub.
- O banco fica local em cada maquina.
- Backup do banco so e usado quando voce quiser continuar o mesmo teste em outra maquina.

## Pasta recomendada

- PC: `C:\Projetos\sempredesk`
- Notebook: `C:\Projetos\sempredesk`

## Fluxo no PC

1. Abrir `C:\Projetos\sempredesk\scripts\00-abrir-painel-local.vbs`
2. Ir para a aba `Guia`
3. Clicar em `Executar inicio no PC`
4. Trabalhar normalmente
5. Quando terminar, clicar em `Executar fim no PC`
6. Se for publicar codigo, clicar em `Executar publicacao GitHub`
7. Acompanhar o deploy em `GitHub Actions`

## Fluxo no notebook

1. Instalar Docker Desktop
2. Criar a pasta `C:\Projetos`
3. Clonar o repositorio em `C:\Projetos\sempredesk`
4. Configurar os `.env` locais necessarios
5. Abrir `C:\Projetos\sempredesk\scripts\00-abrir-painel-local.vbs`
6. Ir para a aba `Guia`
7. Clicar em `Executar inicio no notebook`
8. Trabalhar normalmente
9. Quando terminar, clicar em `Executar fim no notebook`
10. Se for publicar codigo, clicar em `Executar publicacao GitHub`
11. Acompanhar o deploy em `GitHub Actions`

## Quando usar backup do banco

- Use backup apenas se quiser continuar no notebook exatamente os testes do PC
- Ou se quiser voltar para o PC com os mesmos dados de teste do notebook

Fluxo:

1. Na maquina atual, gerar backup do banco local
2. Levar o arquivo `.sql` para a outra maquina
3. Na outra maquina, restaurar o backup do banco local

## Quando apagar a pasta antiga do OneDrive

Voce pode apagar a pasta antiga depois que:

1. Confirmar que esta usando `C:\Projetos\sempredesk`
2. Confirmar que o painel abre pela pasta nova
3. Confirmar que nao vai mais trabalhar em `OneDrive\Documentos\GitHub\sempredesk`

Pasta antiga:

- `C:\Users\junio\OneDrive\Documentos\GitHub\sempredesk`

## Fluxo oficial do projeto

`PC ou Notebook -> GitHub -> VPS`
