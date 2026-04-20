# Deploy para Servidor

## Quando olhar o GitHub Actions

Voce acompanha a tela do GitHub Actions logo depois de fazer:

```powershell
git push origin main
```

Ao entrar codigo novo na branch `main`, o workflow `.github/workflows/deploy.yml` dispara sozinho.

## O que o workflow faz

O workflow `Deploy para Servidor` executa esta sequencia:

1. Conecta no VPS via SSH.
2. Entra em `/opt/suporte-tecnico`.
3. Atualiza o codigo remoto com `git fetch origin main` e `git reset --hard origin/main`.
4. Faz build de `backend` e `frontend`.
5. Para e remove containers antigos.
6. Sobe primeiro `postgres`, `redis` e `rabbitmq`.
7. Espera o Postgres ficar `healthy`.
8. Sobe o restante dos servicos.
9. Espera o backend responder em `http://127.0.0.1:4000/api/v1/health`.
10. Executa o smoke test `scripts/smoke-public.sh`.

## Em que momento acompanhar cada lugar

### Se voce fez somente `git push`

- Acompanhe em: GitHub Actions
- Momento: imediatamente depois do push
- Sinal de sucesso: workflow verde

### Se voce rodou `12`, `13` ou `14`

- Acompanhe em: terminal do script local
- Momento: durante toda a execucao
- Sinal de sucesso: containers recriados e servicos subindo

### Se fizer os dois

1. Primeiro acompanhe o GitHub Actions depois do `push`
2. Depois, se rodar deploy manual, acompanhe o terminal do script

## Resumo pratico

- `git push` para `main` -> olhar GitHub Actions
- `12-publicar-backend-vps.bat` -> olhar terminal local
- `13-publicar-frontend-vps.bat` -> olhar terminal local
- `14-publicar-backend-frontend-vps.bat` -> olhar terminal local
