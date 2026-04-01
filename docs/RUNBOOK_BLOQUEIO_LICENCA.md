# Runbook — Bloqueio de licença / acesso (referência rápida)

Documento para **operador de suporte** (5–10 min). Detalhes completos: [SOP_ONBOARDING_TENANTS.md](./SOP_ONBOARDING_TENANTS.md) §8.

---

## Checklist do operador

1. [ ] Confirmar **empresa** (nome, slug ou CNPJ) e **quem contacta** (equipa vs contacto do portal).
2. [ ] No painel master (`super_admin`): **Empresas** → localizar tenant → ver **estado** e **fim da licença**.
3. [ ] Decidir acção:
   - [ ] **Renovar licença** (dias) — trial expirado ou renovação comercial.
   - [ ] **Reativar** — suspensão indevida ou regularização feita.
   - [ ] **Escalar** — dúvida comercial / jurídica / dados incorrectos no cadastro.
4. [ ] Após correcção: pedir **novo login** (botão “limpar sessão” na página de bloqueio, ou fechar sessão e voltar a entrar).
5. [ ] Registar no sistema interno: ticket/incidente, empresa, causa, acção, hora.

---

## O que o cliente vê (resumo)

| Origem | URL típica | Botão principal |
|--------|------------|-----------------|
| Equipa (suporte interno) | `/license-blocked?from=staff` | Login da equipa |
| Portal do cliente | `/license-blocked?from=portal` | Login do portal |

A mensagem técnica vem em `reason=` (pode citar ao interno; para o cliente use as macros abaixo).

---

## SQL rápido (substituir valores)

```sql
-- Tenant por slug
SELECT id, name, slug, status, email FROM tenants WHERE slug = 'SLUG_AQUI';

-- Licenças do tenant (últimas)
SELECT status, plan_slug, expires_at, created_at
FROM tenant_licenses
WHERE tenant_id = 'UUID_TENANT'
ORDER BY created_at DESC
LIMIT 5;
```

---

## Macros de resposta (copiar e colar)

Personalizar `[NOME]`, `[PRAZO]` e assinatura.

### A — Trial / licença expirada (vamos regularizar)

```
Olá [NOME],

O acesso ao portal/painel da empresa ficou indisponível porque o período de avaliação ou a licença chegou ao fim.

Estamos a tratar da renovação e prevemos regularizar até [PRAZO]. Assim que estiver activo, faça novamente o login. Se aparecer uma página a pedir para “limpar a sessão”, use esse botão e entre outra vez.

Qualquer dúvida, estamos à disposição.

[Assinatura]
```

### B — Já renovado / corrigido agora

```
Olá [NOME],

Já renovámos / reactivámos a licença da empresa. Por favor:

1) Saia da conta ou use a opção para limpar a sessão na página de aviso, se a vir.
2) Entre novamente em [link do portal ou painel conforme o caso].

Se ainda não conseguir, diga-nos qual o e-mail com que entra e o horário aproximado da tentativa.

[Assinatura]
```

### C — Suspensão administrativa (genérico, sem culpar)

```
Olá [NOME],

O acesso da empresa ao serviço está temporariamente suspenso. Para mais informações sobre reactivação, o nosso equipa comercial/suporte acompanha o caso.

Referência interna: [ticket ou ID se existir].

[Assinatura]
```

### D — Resposta curta (chat / WhatsApp)

```
Licença em pausa ou expirada. Já estamos a ver no sistema — tenta novo login daqui a [X] min/horas. Se aparecer tela de bloqueio, usa “limpar sessão” e entra de novo.
```

---

## Links úteis (produção típica)

- Master: `https://adminpanel.sempredesk.com.br/admin/tenants`
- Auditoria: `https://adminpanel.sempredesk.com.br/admin/audit-logs`
- Equipa: `https://suporte.sempredesk.com.br/auth/login`
- Portal cliente: `https://cliente.sempredesk.com.br/portal/login`

(Ajuste domínios se o ambiente for outro.)

---

## Versão

- Alinhado ao código: bloqueio com código `TENANT_LICENSE_BLOCKED`, página `/license-blocked`, lembretes trial `SAAS_SMTP_*`.
