# Auditoria final — arquivamento e reativação automática de contatos (Etapa 12)

Documento de auditoria técnica **somente leitura**, baseado no código do repositório (`customers.service.ts`, `contact-archive-rollout.service.ts`, `whatsapp.service.ts`, `chatbot.service.ts`, `monitoring.service.ts`, frontend da ficha do cliente e criação de ticket). Não substitui testes nem operação em produção.

---

# 1. Visão geral

A feature permite **arquivar** contatos manualmente (`active` → `archived`), com efeitos colaterais controlados (fecho de conversas WhatsApp ativas, remoção de sessão de chatbot). Contatos **arquivados** saem da listagem padrão de contatos por cliente, mas podem ser listados com `includeArchived=true`. Ao receber **mensagem WhatsApp inbound** (com `FEATURE_CONTACT_ARCHIVE` habilitada), o sistema **reativa automaticamente** o contato arquivado em dois caminhos principais: `resolveCanonicalWhatsappContact` (preferencial) e `findOrCreateByWhatsapp` (quando o primeiro não materializa contato mas o segundo reutiliza registro existente arquivado). O fallback `findContactByWhatsapp` **não** reativa arquivados (apenas log, consolidação de vínculos e política distinta para `inactive`). A variável **`FEATURE_CONTACT_ARCHIVE`** atua como kill-switch: desliga arquivo/desarquivo manual **e** reativação automática nos dois caminhos citados, sem alterar esquema de BD.

---

# 2. Auditoria de estados

## 2.1 `active`

- **Significado:** contato operacional na UI e nos fluxos normais de atendimento.
- **Listagem:** incluído em `GET .../contacts` com `includeArchived=false` (default).
- **Quem altera:** operadores via CRUD; sistema via reativação automática, fallback `inactive`→`active`, `unarchiveContact`, consolidação em casos específicos.

## 2.2 `archived`

- **Significado:** arquivado explicitamente pelo usuário (trilha com `metadata.archivedAt`).
- **Listagem:** excluído com `includeArchived=false`; incluído com `includeArchived=true` (filtro SQL: `status != 'inactive'`).
- **Quem altera:** `archiveContact` (manual), `unarchiveContact` (manual), `resolveCanonicalWhatsappContact` / `findOrCreateByWhatsapp` (automático, se flag on), **não** `consolidateWhatsappContactLinks` (comentário explícito no código).

## 2.3 `inactive`

- **Significado:** remoção/mesclagem pelo sistema (ex.: `removeContact`); não é “arquivamento de produto”.
- **Listagem:** **nunca** retornado por `findContacts`, mesmo com `includeArchived=true`.
- **Quem altera:** fluxos de remoção do sistema; pode ser promovido a `active` em `findContactByWhatsapp` (fallback) ou em `consolidateWhatsappContactLinks` quando o alvo consolidado é `inactive`.

## 2.4 Transições permitidas (resumo)

| De | Para | Mecanismo |
|----|------|-----------|
| `active` | `archived` | `archiveContact` (flag on) |
| `archived` | `active` | `unarchiveContact` (flag on); inbound WhatsApp em `resolveCanonicalWhatsappContact` ou `findOrCreateByWhatsapp` (flag on) |
| `inactive` | `active` | `findContactByWhatsapp` (fallback); `consolidateWhatsappContactLinks` (target inactive) |

## 2.5 Transições proibidas ou não suportadas

- `archived` → `active` via **`findContactByWhatsapp`** (política: não atualizar status; evitar auditoria inconsistente).
- `inactive` → `archived` via arquivo manual (`archiveContact` rejeita se `status !== 'active'`).
- `archived` → `inactive` diretamente pelo fluxo de arquivo (não é o desenho; inativo é outro fluxo).

## 2.6 Quem pode alterar cada estado (camada)

- **Manual (API autenticada):** `PATCH .../archive` e `PATCH .../unarchive` no `customers.controller`, delegando a `CustomersService` (validação tenant + flag).
- **Automático (WhatsApp):** `WhatsappService` chama `resolveCanonicalWhatsappContact` e, se necessário, `findOrCreateByWhatsapp`; reativação de `archived` ocorre apenas nesses métodos quando a flag está habilitada.
- **Fallback legado:** `findContactByWhatsapp` — promove `inactive`, **não** `archived`.
- **Consolidação:** `consolidateWhatsappContactLinks` — une `contact_customers`, metadados LID; pode promover `inactive`→`active`, **não** reativa `archived`.

## 2.7 Impacto da feature flag (`FEATURE_CONTACT_ARCHIVE`)

- **Off:** `archiveContact` / `unarchiveContact` → HTTP 400 + logs `contact-archive-blocked` / `contact-unarchive-blocked`.
- **Off:** ramos de reativação automática em `resolveCanonicalWhatsappContact` e `findOrCreateByWhatsapp` → log `contact-reactivation-skipped` (`reason: FEATURE_CONTACT_ARCHIVE_DISABLED`), **sem** `UPDATE` para `active`.
- **Listagem e entidade:** inalteradas pela flag (conforme documentação de rollout).
- **Observabilidade:** `GET /monitoring/health` expõe `rollout.contactArchiveFeatureEnabled`.

---

# 3. Auditoria de fluxos

Para cada fluxo: entrada, saída, efeitos colaterais, logs, métricas, consistência, riscos, garantias.

## 3.1 Arquivamento manual

- **Entrada:** `PATCH /api/v1/customers/:clientId/contacts/:contactId/archive` (autenticação/guardas do controller).
- **Saída:** contato persistido `status: archived`, `metadata.archivedAt` ISO; corpo com entidade atualizada; ou 400/404 conforme validação.
- **Efeitos colaterais:** `UPDATE conversations SET status='closed'` para conversas `active` daquele `contact_id` + tenant; `DELETE FROM chatbot_sessions` onde `identifier = contact.whatsapp` (se houver).
- **Logs:** `contact-archive-blocked` (flag off); `contact-archive-manual` com `outcome: archived`, `archivedAt`.
- **Métricas:** `incrArchiveManual()` → contador `archiveManual` (por processo).
- **Consistência:** transação implícita em múltiplas queries; ordem: validação → update contact → fechar conversas → apagar sessão bot.
- **Riscos:** janela mínima entre passos; conversas de outros canais não citadas neste `UPDATE` (apenas WhatsApp-like `conversations` com esse contact).
- **Garantias:** não arquiva se não `active`; não arquiva se flag off.

## 3.2 Desarquivamento manual

- **Entrada:** `PATCH .../unarchive`.
- **Saída:** `status: active`, `metadata.archivedAt: null`, `metadata.reactivatedAt` ISO.
- **Efeitos colaterais:** nenhum fecho de conversa ou delete de sessão explícito neste método (diferente do arquivo).
- **Logs:** `contact-unarchive-blocked`; `contact-unarchive-manual` com `outcome: active`, `reactivatedAt`.
- **Métricas:** `unarchiveManual`.
- **Consistência:** metadata mesclado preservando outros campos.
- **Riscos:** conversas antigas permanecem fechadas até novo fluxo de abertura.
- **Garantias:** só aceita `archived`; flag off bloqueia.

## 3.3 Reativação automática via `resolveCanonicalWhatsappContact`

- **Entrada:** opções com `normalizedWhatsapp` / `rawWhatsapp` / `lid` / `clientId` / `direction` (tipicamente `inbound` a partir de `WhatsappService`).
- **Saída:** `safeContact` pode ser o mesmo registro já **reativado** (`active`) antes do retorno ao chamador; metadata com `archivedAt: null`, `reactivatedAt` definido quando reativou.
- **Efeitos colaterais:** `persistWhatsappRuntimeIdentifiers` (best-effort) antes da reativação; atualização de `contacts` quando `safeContact.status === 'archived'` e flag on.
- **Logs:** `contact-reactivation-skipped` ou `contact-reactivation-auto` (`path: resolveCanonicalWhatsappContact`, `reason: inbound-whatsapp-message`); `canonical-contact-resolution`; possível `whatsapp-identity-guard` se candidato técnico bloqueado.
- **Métricas:** `autoReactivateCanonical`.
- **Consistência:** comentário no código: reativar **antes** do retorno para `handleIncomingMessage` operar com contato já `active` (chatbot / conversas).
- **Riscos:** dependência da escolha “safe” do contato canônico; identificadores técnicos podem bloquear reuso (`safeContact` null).
- **Garantias:** `inactive` não é reativado neste bloco; apenas `archived` tratado.

## 3.4 Reativação automática via `findOrCreateByWhatsapp`

- **Entrada:** telefone/LID normalizado, `displayName`, `isLid`, opts com `direction` / `clientId` / `rawInput`.
- **Saída:** contato existente sanitizado e consolidado; se estava `archived` e flag on → `active` + metadata de reativação.
- **Efeitos colaterais:** `consolidateWhatsappContactLinks` após ramo de existente; criação de novo contato só se não existir equivalente e não for identificador técnico bloqueado.
- **Logs:** `contact-reactivation-skipped` / `contact-reactivation-auto` (`path: findOrCreateByWhatsapp`, `reason: inbound-whatsapp-message-fallback`); `contact-resolution`, `contact-create`, possivelmente `whatsapp-identity-guard`.
- **Métricas:** `autoReactivateFindOrCreateFallback`.
- **Consistência:** alinhado ao comentário “fallback quando resolveCanonical retornou null” mas ainda há contato existente por `findContactByWhatsappOrLid`.
- **Riscos:** picos de criação se resolução canônica falhar repetidamente (monitorar `contact-create` + negócio).
- **Garantias:** não reativa `inactive` neste bloco de arquivo; arquivado só sobe com flag on.

## 3.5 Fallback de `findContactByWhatsapp`

- **Entrada:** tenant, whatsapp normalizado, opts opcionais.
- **Saída:** contato ou `null`; se só existir candidato inativo/arquivado via segunda busca (`buildWhatsappContactsQuery` com `includeInactive: true`), comportamento difere por status.
- **Efeitos colaterais:** `inactive` → `UPDATE` para `active` + `consolidateWhatsappContactLinks`; `archived` → **sem** mudança de status + consolidação + warn estruturado.
- **Logs:** `contact-fallback-find-by-whatsapp` com `action: reactivate-inactive` ou `reason: archived-contact-in-findContactByWhatsapp-fallback`; `contact-unknown-status-in-fallback` para status inesperado; `contact-resolution` em vários estágios.
- **Métricas:** `fallbackFindByWhatsappInactivePromoted`, `fallbackFindByWhatsappArchivedSkippedLog`.
- **Consistência:** preserva trilha de auditoria para arquivados (não limpa `archivedAt` sem decisão explícita nas camadas superiores).
- **Riscos:** chatbot ou outros consumidores deste método podem ver contato ainda `archived` enquanto WhatsApp inbound já teria reativado por outro caminho — ordem de chamadas importa.
- **Garantias:** política explícita no código para não reativar `archived` aqui.

## 3.6 `consolidateWhatsappContactLinks`

- **Entrada:** `tenantId`, `targetContactId`, `normalized` WhatsApp/LID.
- **Saída:** inserções em `contact_customers` (ON CONFLICT DO NOTHING); possível atualização de `metadata` (ex.: `whatsappLid`); possível `isPrimary`; possível promoção `inactive`→`active`.
- **Efeitos colaterais:** unificação de vínculos cliente↔contato para todos os `client_id` encontrados nos matches.
- **Logs:** `consolidate-whatsapp-links-status` com `action: promote-inactive-to-active` quando aplicável.
- **Métricas:** `consolidateInactivePromotedToActive`.
- **Consistência:** comentário longo no código: **não** reativar `archived` aqui.
- **Riscos:** múltiplos matches com dados divergentes — mitigado por escolha de target e ordens prévias.
- **Garantias:** archived permanece archived após consolidate isolado.

## 3.7 Listagem com `includeArchived`

- **Entrada:** `GET .../contacts?includeArchived=true|false` (`ParseBoolPipe`, default false).
- **Saída:** lista sanitizada (`sanitizeTechnicalContactIdentifiers`); SQL: se false só `status = 'active'`; se true `status != 'inactive'` (inclui `archived`).
- **Efeitos colaterais:** nenhum persistido.
- **Logs:** não específicos desta feature na listagem.
- **Métricas:** agregados SQL em `contactArchiveRolloutStats` (total arquivados, reativados 24h) não dependem só desta rota.
- **Consistência:** `filterVisibleContactsForClient` espelha regra para arrays já carregados.
- **Riscos:** clientes aninhados em outros endpoints podem continuar a trazer só ativos (documentado na spec).
- **Garantias:** `inactive` nunca listado.

## 3.8 Integração frontend (ficha do cliente)

- **Entrada:** utilizador autenticado na rota `dashboard/customers/[id]`; toggle “Mostrar arquivados”; ações de arquivo/desarquivo por linha.
- **Saída:** `getContacts(id, includeArchived)`; PATCH archive/unarchive via API; toast em erro.
- **Efeitos colaterais:** apenas via backend (ver fluxos 3.1–3.2).
- **Logs/métricas:** lado servidor; cliente gera tráfego HTTP auditável em WAF/gateway.
- **Consistência:** `loadArchiveFeature` tenta rollout admin e cai para `getMonitoringHealth` — paridade com criação de ticket.
- **Riscos:** operador sem `super_admin` não lê endpoint de rollout detalhado, mas health cobre boolean.
- **Garantias:** botões de ação condicionados a `archiveFeatureEnabled` (UI).

## 3.9 Integração frontend (criação de ticket)

- **Entrada:** seleção de cliente; toggle “Mostrar arquivados”; `getContacts(clientId, includeArchived)`.
- **Saída:** `<select>` com sufixo `(Arquivado)` e badge visual quando selecionado arquivado; `contactId` limpo se sumir da lista ao desligar toggle.
- **Efeitos colaterais:** nenhum arquivo/desarquivo nesta tela.
- **Logs/métricas:** idem backend.
- **Consistência:** mesmo padrão de flag + fallback health.
- **Riscos:** ticket aberto com contato arquivado visível só com toggle — aceitável pelo desenho.
- **Garantias:** refetch sem reload de página; toast em falha de lista.

## 3.10 Conversas e histórico

- **Entrada:** arquivo manual dispara fecho de conversas `active` ligadas ao contato.
- **Saída:** conversas passam a `closed`; novas mensagens inbound após reativação seguem fluxo WhatsApp normal (nova conversa conforme regras do `ConversationsService` / WhatsApp).
- **Efeitos colaterais:** histórico antigo permanece no BD; não há apagamento de mensagens nesta feature.
- **Logs:** indiretos (conversas podem ter logs próprios fora do escopo deste documento).
- **Métricas:** não dedicadas no rollout service.
- **Consistência:** evita fila humana com conversa “ativa” para contato arquivado.
- **Riscos:** agente pode esperar thread aberta após arquivo — comportamento é fechamento explícito.
- **Garantias:** SQL de fecho restrito a `tenant_id`, `contact_id`, `status = 'active'`.

## 3.11 Chatbot

- **Entrada:** mensagens Meta com possível execução de chatbot **antes** da resolução completa em alguns ramos; uso de `resolveCanonicalWhatsappContact` para decidir skip por conversa humana ativa; em outros pontos `findContactByWhatsapp` (session / identifier).
- **Saída:** arquivo remove sessão em `chatbot_sessions` pelo `identifier` = whatsapp do contato.
- **Efeitos colaterais:** próxima interação pós-arquivo inicia sessão “do zero” após reativação + novo fluxo.
- **Logs:** falhas warn no WhatsApp service; chatbot service usa resolução de contato com `.catch(() => null)` em alguns caminhos.
- **Métricas:** não específicas.
- **Consistência:** alinhado ao objetivo de não manter estado de bot para contato arquivado.
- **Riscos:** condição de corrida entre verificação de conversa humana e reativação automática — mitigada pela ordem documentada em `resolveCanonicalWhatsappContact`.
- **Garantias:** delete de sessão só se `contact.whatsapp` truthy no arquivo.

## 3.12 WhatsApp inbound

- **Entrada:** webhook / pipeline `WhatsappService.handleIncomingMessage` (e variantes Meta/Baileys conforme módulo).
- **Saída:** contato resolvido (reativado se arquivado + flag on); conversa/mensagens criadas conforme restante do serviço.
- **Efeitos colaterais:** reativação automática + `consolidateWhatsappContactLinks` nos caminhos de criação/reuso; materialização com `findOrCreateByWhatsapp` quando canônico nulo e política de LID/resolver digits.
- **Logs:** `contact-resolution`, `canonical-contact-resolution`, logs do próprio `WhatsappService`.
- **Métricas:** contadores de auto-reativação e fallbacks.
- **Consistência:** inbound é a fonte de verdade para “cliente voltou a falar”.
- **Riscos:** flag off prolongado deixa contatos arquivados sem reativação automática apesar de mensagens chegando — mensagens ainda podem ser processadas com lógica que tolera contato arquivado dependendo do caminho (ver fallback).
- **Garantias:** com flag on, código pretende que `handleIncomingMessage` receba contato `active` após `resolveCanonicalWhatsappContact` quando aplicável.

---

# 4. Auditoria de logs (Etapa 9 — escopos principais)

Logs estruturados em JSON via `Logger` (campo `scope`). Monitoração recomendada: busca por `scope` no agregador (Datadog, Loki, CloudWatch, etc.).

| Scope | Quando dispara | Payload esperado (campos relevantes) | Como monitorar |
|-------|----------------|----------------------------------------|----------------|
| `contact-archive-blocked` | Tentativa de arquivo com flag off | `reason: FEATURE_CONTACT_ARCHIVE_DISABLED`, `tenantId`, `contactId` | Alerta se volume alto inesperado |
| `contact-archive-manual` | Arquivo concluído | `tenantId`, `contactId`, `outcome: archived`, `archivedAt` | Auditoria / relatórios |
| `contact-unarchive-blocked` | Desarquivo com flag off | `reason`, `tenantId`, `contactId` | Igual ao blocked de arquivo |
| `contact-unarchive-manual` | Desarquivo concluído | `tenantId`, `contactId`, `outcome: active`, `reactivatedAt` | Auditoria |
| `contact-reactivation-skipped` | Arquivado detectado mas flag off | `reason: FEATURE_CONTACT_ARCHIVE_DISABLED`, `path`, `tenantId`, `contactId` | Correlacionar com kill-switch |
| `contact-reactivation-auto` | Reativação automática inbound | `path` (`resolveCanonicalWhatsappContact` \| `findOrCreateByWhatsapp`), `reason` (mensagem), `tenantId`, `contactId` | Baseline + picos |
| `contact-fallback-find-by-whatsapp` | Fallback por status | `action: reactivate-inactive` **ou** `reason: archived-contact-in-findContactByWhatsapp-fallback` + ids / normalized | Distinguir promoção inactive vs skip archived |
| `contact-unknown-status-in-fallback` | Status não esperado no fallback | `status`, `contactId`, `tenantId` | Investigar dados legados |
| `consolidate-whatsapp-links-status` | Promoção inactive durante consolidate | `action: promote-inactive-to-active`, `normalizedWhatsapp`, ids | Volume baixo esperado |

**Logs adjacentes (não exclusivos da Etapa 9 mas críticos na cadeia):** `canonical-contact-resolution`, `contact-resolution`, `whatsapp-identity-guard`, `contact-create` — úteis para diagnosticar por que auto-reativação não ocorreu.

---

# 5. Auditoria de métricas

## 5.1 Contadores em memória (`ContactArchiveRolloutService`, por processo)

| Chave (em `getCounters`) | Incremento |
|--------------------------|------------|
| `archiveManual` | Sucesso em `archiveContact` |
| `unarchiveManual` | Sucesso em `unarchiveContact` |
| `autoReactivateCanonical` | Reativação em `resolveCanonicalWhatsappContact` |
| `autoReactivateFindOrCreateFallback` | Reativação em `findOrCreateByWhatsapp` |
| `fallbackFindByWhatsappInactivePromoted` | Promoção inactive no fallback |
| `fallbackFindByWhatsappArchivedSkippedLog` | Arquivado encontrado no fallback sem reativação |
| `consolidateInactivePromotedToActive` | Promoção inactive em `consolidateWhatsappContactLinks` |

## 5.2 Métricas derivadas / SQL (`contactArchiveRolloutStats`)

- **`totalArchivedContacts`:** `COUNT(*)` onde `status = 'archived'` (global na query atual — atenção multi-tenant se o painel exigir filtro; auditar implementação ao usar em produção).
- **`activeWithReactivatedAtInLast24h`:** contatos `active` com `metadata.reactivatedAt` nas últimas 24h — proxy de volume de reativações recentes (manual + automático).

## 5.3 Interpretação e anomalias

- **Ratio:** `archiveManual` vs `unarchiveManual + autoReactivate*` — desbalanceamento pode indicar uso operacional ou problema de resolução.
- **Pico:** `autoReactivateCanonical + autoReactivateFindOrCreateFallback` acima do baseline — campanha de marketing ou regressão de identidade.
- **`fallbackFindByWhatsappArchivedSkippedLog`:** alto pode indicar consumidores usando `findContactByWhatsapp` em cenários onde só inbound deveria reativar — revisar chamadores (ex.: chatbot).
- **Duplicação:** não há contador direto; correlacionar com criação de contatos e regras WhatsApp (hint já presente em `monitoring.service`).

---

# 6. Auditoria de segurança

| Risco | Avaliação |
|-------|-----------|
| Duplicação de contatos | Mitigada por `findContactByWhatsappOrLid` + consolidação; risco residual em cenários LID/técnico e falhas de match |
| Inconsistência metadata | Reativação automática sempre limpa `archivedAt` e seta `reactivatedAt`; fallback archived não altera metadata de arquivo |
| Reativação indevida | Política: só caminhos explícitos + flag; risco residual se flag on e spoofing de número (fora do escopo deste doc — confiar no provedor WhatsApp) |
| Arquivamento indevido | Exige permissões da API e contato `active`; flag off bloqueia |
| Perda de vínculo `clientId` | Consolidação **adiciona** linhas em `contact_customers`; não remove `clientId` no arquivo |
| Quebra fluxo WhatsApp | Com flag off, contato pode permanecer arquivado mas pipeline ainda tenta seguir — necessidade de testes de integração para mensagens sem contato resolvido |

---

# 7. Auditoria de UX

- **Consistência:** mesma semântica de “Mostrar arquivados” e mesma origem da flag (rollout → health) na ficha do cliente e na criação de ticket.
- **Flag off:** backend bloqueia ações manuais; frontend esconde botões de arquivo na ficha; toggles de listagem continuam úteis; mensagem contextual na criação de ticket quando aplicável.
- **Toggle:** refetch apenas da lista; na criação de ticket limpa `contactId` se o contato deixar de aparecer.
- **Contato arquivado selecionado:** badge e label no select; utilizador pode abrir ticket se o produto permitir — dependente de validação no submit (auditar endpoint de criação de ticket se restrição for desejada no futuro).

---

# 8. Edge cases

| Caso | Análise |
|------|---------|
| Contato arquivado recebendo mensagem | Com flag on: reativação em `resolveCanonicalWhatsappContact` ou `findOrCreateByWhatsapp`. Com flag off: permanece archived; logs `contact-reactivation-skipped`. |
| Arquivado selecionado e toggle desligado (novo ticket) | Lista refetch sem arquivados; `contactId` resetado se ID não existir na nova lista. |
| Contato inactive recebendo mensagem | Pode ser promovido a `active` no fallback `findContactByWhatsapp` ou consolidate; **não** confundir com archived. |
| Cliente sem contatos | Lista vazia; toggle não altera resultado. |
| Cliente só com arquivados | Sem toggle: lista vazia na UI default; com toggle: exibe arquivados. |
| Troca de cliente na criação de ticket | `showArchived` resetado; carga inicial só ativos. |
| Flag desligada em produção | Arquivo/desarquivo 400; auto-reativação desligada; possível acúmulo de archived com tráfego WhatsApp ativo. |
| Flag ligada após período off | Reativação automática volta; operadores podem desarquivar manualmente; contadores por processo resetam em restart. |

---

# 9. Riscos residuais

1. **Multi-instância:** contadores em memória não são globais — interpretação apenas por pod/processo.
2. **`contactArchiveRolloutStats`:** agregados SQL podem ser globais conforme implementação atual — validar `tenant_id` antes de uso em painéis multi-tenant.
3. **Ordem chatbot vs resolução:** edge cases em Meta com mensagem vazia vs chatbot podem diferir do fluxo Baileys.
4. **Consumidores legados de `findContactByWhatsapp`:** podem expor UX inconsistente (contato ainda arquivado) face ao inbound.
5. **Conversas fechadas no arquivo:** reabertura depende de regras downstream — possível expectativa operacional não alinhada.

---

# 10. Recomendações finais

1. **Melhorias futuras:** métricas por `tenant_id`; dashboard dedicado; teste E2E cobrindo flag off + inbound; opcional bloqueio na criação de ticket para contato arquivado se política de negócio exigir.
2. **Observabilidade:** alertas em `contact-reactivation-skipped` com razão de flag; baseline de auto-reativação; revisão periódica de `whatsapp-identity-guard`.
3. **Manutenção:** manter alinhamento entre `contact-archive-full-spec.md`, `rollout-contact-archive.md` e este relatório após mudanças em `CustomersService` / WhatsApp.
4. **Documentação:** checklist de deploy já em rollout; incluir referência cruzada a testes `customers.contact-lifecycle.spec.ts` e `customers.e2e-spec.ts` para regressão.

---

*Fim do relatório — Etapa 12 (auditoria final).*
