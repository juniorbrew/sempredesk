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

- [ ] `GET /api/v1/health` (ou URL equivalente atrás do proxy).
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

## Fluxo do projecto

LOCAL → GITHUB → VPS (deploy via Actions + `git` na VPS).
