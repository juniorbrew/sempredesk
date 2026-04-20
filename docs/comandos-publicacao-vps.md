# SempreDesk - Comandos de Publicacao no VPS

Use estes comandos como base no VPS, sempre depois de validar localmente e confirmar que o codigo correto esta no GitHub.

## Fluxo

1. Entrar na pasta do projeto no VPS
2. Atualizar o repositorio
3. Aplicar migracoes se necessario
4. Rebuildar apenas o que mudou
5. Validar a aplicacao

## Comandos base

```bash
cd /opt/suporte-tecnico
git pull --ff-only origin main
docker compose up --build -d backend
docker compose ps
```

## Quando houver frontend

```bash
cd /opt/suporte-tecnico
git pull --ff-only origin main
docker compose up --build -d frontend
docker compose ps
```

## Quando houver backend e frontend

```bash
cd /opt/suporte-tecnico
git pull --ff-only origin main
docker compose up --build -d backend frontend
docker compose ps
```

## Regras

- Nao publicar sem validar localmente
- Nao usar `docker cp` manual
- Se houver migracao, aplicar com cuidado antes ou junto do processo correto do projeto
- Validar no navegador e nos logs depois do deploy
