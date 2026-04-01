# Sequência pós-deploy (Edge, TLS, smoke tests, operação)

Ordem sugerida após um deploy ou quando validar produção.

---

## 1) Browser Edge — “Não seguro” só no Edge

- [ ] Abrir o **mesmo** URL que noutro browser (copiar `https://...` da barra).
- [ ] Testar **InPrivate** com extensões desligadas.
- [ ] **Definições → Privacidade → Segurança na Web**: temporariamente **Básico** ou **Desligado** (em vez de Estrito).
- [ ] Limpar **dados do site** para o domínio (cookies e cache guardados).
- Se noutro browser o cadeado está correto: tratar como **perfil Edge**; não é regressão da app.

---

## 2) TLS — certificado e nome do host

- [ ] Produção deve ser acedida com **`https://`** (não `http://` nem só IP na porta 80, salvo ambiente de teste).
- [ ] Ver SAN do certificado (exemplo; ajustar hostname):

```bash
echo | openssl s_client -connect cliente.sempredesk.com.br:443 -servername cliente.sempredesk.com.br 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
```

- [ ] O certificado apresentado para `cliente.sempredesk.com.br` tem de incluir **`DNS:cliente.sempredesk.com.br`** (ou wildcard adequado). Caso contrário, emitir cert com `-d` correcto no certbot e actualizar `ssl_certificate` no `infra/nginx/nginx.conf`, depois reload do nginx.

---

## 3) Smoke tests funcionais

- [ ] Health da API (rápido, a partir da pasta do repo):
  - O **Deploy para Servidor** (GitHub Actions) já corre `scripts/smoke-public.sh` na VPS após o `compose up`.
  - Manual: `BASE_URL=http://127.0.0.1:4000 bash scripts/smoke-public.sh` (host com porto 4000), ou `BASE_URL=https://suporte.sempredesk.com.br ...` (via nginx).
- [ ] `GET /api/v1/health` manual (equivalente ao script acima).
- [ ] Login **painel suporte** (`suporte.*`).
- [ ] Login **portal cliente** (`cliente.*`).
- [ ] Login **painel master** (`adminpanel.*`), se aplicável.
- [ ] Abrir um ticket / lista de tickets (confirma API + sessão).
- [ ] Chat interno ou notificações (confirma **Socket.IO** sem erro na consola **da app** — ignorar erros `chrome-extension://`).

---

## 4) Operação e documentação

- [ ] Equipa de suporte com acesso a [RUNBOOK_BLOQUEIO_LICENCA.md](./RUNBOOK_BLOQUEIO_LICENCA.md).
- [ ] Onboarding completo: [SOP_ONBOARDING_TENANTS.md](./SOP_ONBOARDING_TENANTS.md).

---

## 5) Deploy CI falhou — rede, nome de container ou dependência Compose

Mensagens típicas: `network with name suporte_network already exists`, `container name ... already in use`, `postgres-exporter is missing dependency postgres`.

Na VPS, como utilizador com acesso ao Docker:

```bash
cd /opt/suporte-tecnico
docker compose down --remove-orphans || true
sleep 2
for c in suporte_postgres suporte_redis suporte_rabbitmq suporte_backend suporte_frontend suporte_nginx suporte_certbot suporte_prometheus suporte_grafana suporte_node_exporter suporte_postgres_exporter suporte_redis_exporter; do
  docker stop "$c" 2>/dev/null || true
  docker rm -f "$c" 2>/dev/null || true
done
for id in $(docker ps -aq --filter "label=com.docker.compose.project=suporte-tecnico" 2>/dev/null); do docker rm -f "$id" 2>/dev/null || true; done
for id in $(docker ps -aq --filter "name=suporte" 2>/dev/null); do docker rm -f "$id" 2>/dev/null || true; done
docker network rm suporte_network 2>/dev/null || true
docker compose up -d postgres redis rabbitmq
for i in $(seq 1 90); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' suporte_postgres 2>/dev/null || echo none)
  [ "$st" = "healthy" ] && break
  sleep 2
done
docker compose up -d
```

Depois confirmar `docker compose ps` e o smoke (§3).

---

## Fluxo do projecto

LOCAL → GITHUB → VPS (deploy via Actions + `git` na VPS).
