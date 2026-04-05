# Rollout seguro — arquivamento e reativação de contatos (Etapa 9)

## Variável de ambiente

| Variável | Default | Valores que **desligam** a feature |
|----------|---------|--------------------------------------|
| `FEATURE_CONTACT_ARCHIVE` | habilitado (true) | `false`, `0`, `off`, `no`, `disabled` (case-insensitive) |

Com a feature **desligada**:

- `PATCH .../archive` e `PATCH .../unarchive` retornam **400** com mensagem explícita.
- A **reativação automática** ao receber WhatsApp (`resolveCanonicalWhatsappContact`, `findOrCreateByWhatsapp`) **não** roda; contatos permanecem `archived` até a flag voltar ou reativação manual (esta também bloqueada enquanto a flag estiver off).

**Listagem**, entidade `Contact` e esquema de BD **não** mudam.

---

## Checklist de deploy

### Antes

- [ ] Confirmar versão da API/backend no Git (tag/commit).
- [ ] Backup lógico do Postgres (ou snapshot) em janela acordada.
- [ ] Definir baseline de métricas: `GET /api/v1/monitoring/contact-archive-rollout` (super_admin) ou exportar contadores após deploy estável.
- [ ] Garantir ingestão de logs JSON (ex.: Datadog, Loki, CloudWatch) com busca por `scope` (`contact-archive-manual`, `contact-reactivation-auto`, etc.).
- [ ] Documentar valor inicial de `FEATURE_CONTACT_ARCHIVE` (recomendado: **omitir** ou `true`).

### Durante

- [ ] `cd /opt/suporte-tecnico` → `git pull` → `docker compose build` / `up` conforme processo do projeto.
- [ ] Não é necessária migration para esta feature.
- [ ] Após subir, validar `GET /api/v1/monitoring/health` → `rollout.contactArchiveFeatureEnabled` deve refletir o env.

### Depois

- [ ] Smoke: arquivar contato de teste → sumir da listagem padrão → `includeArchived=true` lista.
- [ ] Smoke: mensagem WhatsApp inbound em contato arquivado → reativação automática (se flag ligada).
- [ ] Verificar volume de logs `contact-reactivation-skipped` e `contact-archive-blocked` (não deve explodir sem causa).
- [ ] Comparar `processCountersSinceBoot` com baseline após 24–48 h.

---

## Plano de rollback

### Reversão segura (sem perda de dados)

1. **Código**: voltar ao commit anterior (`git revert` ou deploy da imagem anterior) — dados em `contacts.status` / `metadata` permanecem.
2. **Flag de emergência**: definir `FEATURE_CONTACT_ARCHIVE=false` no env do backend e reiniciar o container — desliga arquivo manual, desarquivo manual e reativação automática **sem** apagar linhas.
3. **Dados**: contatos já `archived` continuam arquivados; nenhum script destrutivo é exigido.

### Contatos já arquivados

- Não é obrigatório “desarquivar” em massa após rollback de código.
- Se a flag foi desligada durante incidente, ao religar a feature o estado no BD reflete a última operação bem-sucedida (arquivado/ativo).

---

## Métricas recomendadas

| Métrica | Fonte neste projeto |
|---------|---------------------|
| Total de arquivamentos manuais | `processCountersSinceBoot.archiveManual` (por processo; reinicia com o pod) |
| Total de desarquivamentos manuais | `processCountersSinceBoot.unarchiveManual` |
| Reativações automáticas (canonical) | `processCountersSinceBoot.autoReactivateCanonical` |
| Reativações automáticas (fallback findOrCreate) | `processCountersSinceBoot.autoReactivateFindOrCreateFallback` |
| Promoções inactive→active no fallback findByWhatsapp | `fallbackFindByWhatsappInactivePromoted` |
| Avisos de archived no fallback findByWhatsapp | `fallbackFindByWhatsappArchivedSkippedLog` |
| Promoções inactive→active no consolidate | `consolidateInactivePromotedToActive` |
| Contatos `archived` no banco | `database.totalArchivedContacts` |
| Contatos `active` com `reactivatedAt` nas últimas 24h | `database.activeWithReactivatedAtInLast24h` |

Endpoint: `GET /api/v1/monitoring/contact-archive-rollout` (JWT + role `super_admin`).

Para séries temporais em produção, encaminhe os **logs estruturados** (campo `scope`) para o seu agregador e crie dashboards a partir daí; os contadores em memória são complementares (úteis para taxa desde o último boot).

---

## Alertas recomendados (exemplos)

| Alerta | Heurística sugerida |
|--------|---------------------|
| Explosão de reativações automáticas | Soma de logs `scope=contact-reactivation-auto` / hora > N × baseline (ex.: 3× mediana 7d) |
| Explosão de arquivamentos | `archiveManual` / hora ou logs `contact-archive-manual` > limiar |
| Explosão de `contact-reactivation-skipped` com `FEATURE_CONTACT_ARCHIVE_DISABLED` | Indica flag off prolongada ou uso indevido do kill-switch |
| Possível duplicação de contatos | Não há métrica direta aqui; correlacionar picos de `findOrCreateByWhatsapp` + novos `contacts` + regras de identity no Datadog; revisar `fallbackFindByWhatsappInactivePromoted` |

---

## Logs estruturados (scopes)

- `contact-archive-manual` — arquivo concluído com sucesso  
- `contact-archive-blocked` — tentativa com `FEATURE_CONTACT_ARCHIVE` desligada  
- `contact-unarchive-manual` — desarquivo manual concluído  
- `contact-unarchive-blocked` — tentativa de desarquivo com flag off  
- `contact-reactivation-auto` — reativação inbound (paths: `resolveCanonicalWhatsappContact`, `findOrCreateByWhatsapp`)  
- `contact-reactivation-skipped` — flag off ou política (ex.: archived no fallback `findContactByWhatsapp`)  
- `contact-fallback-find-by-whatsapp` — ações no fallback (`reactivate-inactive` ou warn archived)  
- `consolidate-whatsapp-links-status` — promoção `inactive` → `active` dentro do consolidate  

Todos em JSON em uma linha (padrão Nest `Logger`).
