# Revisão Final de Segurança – Escopos SempreDesk

## Resumo Executivo

Revisão completa dos escopos `tenant_id` e `network_id` em todos os módulos sensíveis. Correções aplicadas em brechas identificadas. Regra de equipe por rede validada como segura.

---

## Correções Aplicadas Nesta Revisão

### 1. Internal Chat – Validação de destinatário (CRÍTICO)
- **Problema**: `sendMessage` e `getMessages` aceitavam qualquer `recipientId` sem validar se pertence ao tenant
- **Risco**: Envio de mensagem para usuário de outro tenant; possível vazamento de metadados
- **Correção**: `assertRecipientInTenant(tenantId, recipientId)` antes de enviar/listar mensagens

### 2. Monitoring – Endpoints globais (CRÍTICO)
- **Problema**: `GET /monitoring/global` e `GET /monitoring/suspicious` acessíveis por qualquer usuário autenticado
- **Risco**: Exposição de totais e tickets de todos os tenants
- **Correção**: `@Roles('super_admin')` em ambos os endpoints

### 3. Portal Login – Escopo por tenant (MÉDIO)
- **Problema**: Busca de contato por e-mail sem filtro de tenant
- **Risco**: Login em tenant incorreto quando o mesmo e-mail existe em múltiplos tenants
- **Correção**: Parâmetros opcionais `tenantId` e `tenantSlug`; quando informados, filtram a busca
- **Compatibilidade**: Sem `tenantId`/`tenantSlug`, mantém comportamento anterior (primeiro match)

### 4. Scope Utils – Documentação
- Documentada regra `TEAM_NETWORK_SCOPE` para referência futura

---

## Regra da Equipe por Rede – Validação

**Regra atual**: `(network_id = :networkId OR network_id IS NULL)`

**Análise**:
- Usuários com `network_id = NULL`: visibilidade tenant-wide (admins, gerentes)
- Supervisor da rede X vê: usuários da rede X + usuários com NULL
- Supervisor da rede X **não** vê: usuários da rede Y
- **Seguro**: não há vazamento entre redes
- **Decisão de negócio**: NULL = perfil tenant-wide, necessário para atribuição de tickets a admins

**Conclusão**: Regra mantida. Compatível com produção.

---

## Matriz de Proteção por Módulo

| Módulo | Listagem | Detalhe | Edição | Exclusão | Joins | Observações |
|--------|----------|---------|--------|----------|-------|-------------|
| **Tickets** | ✅ tenant_id | ✅ getTicketOrFail | ✅ tenant_id | ✅ tenant_id | ✅ client, contact, user, contract validados | findAll, getStats, getMessages, assign, resolve, close, cancel – todos com tenant |
| **Customers** | ✅ tenant_id + networkId opcional | ✅ getClientOrFail, getContactOrFail | ✅ tenant_id | ✅ tenant_id | ✅ assertNetworkBelongsToTenant | findClientAndContactByEmail com tenant |
| **Team** | ✅ tenant_id + networkId (supervisor) | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | N/A | Regra network: X ou NULL |
| **Contracts** | ✅ tenant_id | ✅ getContractOrFail | ✅ tenant_id | N/A (sem delete) | ✅ assertClientBelongsToTenant | consumeHours com tenant_id |
| **Dashboard** | N/A | N/A | N/A | N/A | ✅ tenant_id em todas as queries | getSummary, getTicketsByPriority, getTicketTrend, getSlaReport |
| **Internal Chat** | ✅ tenant_id | ✅ assertRecipientInTenant | ✅ assertRecipientInTenant | N/A | ✅ messages com tenant_id | sendMessage e getMessages validam recipient |
| **Networks** | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | N/A | findAll, findOne, update, remove |
| **Devices** | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | N/A | ✅ assertClientBelongsToTenant | processHeartbeat por token (device já tem tenant) |
| **Alerts** | N/A | N/A | N/A | N/A | N/A | Apenas envio; sem listagem de dados |
| **Knowledge** | ✅ tenant_id | ✅ getArticleOrFail | ✅ tenant_id | ✅ tenant_id | ✅ assertCategoryBelongsToTenant | findArticles, findOne, update, delete |
| **Conversations** | ✅ tenant_id | ✅ findOne tenant_id | ✅ tenant_id | N/A | ✅ ticket, client validados | getOrCreateForContact, linkTicket, addMessage |
| **Auth** | ✅ tenant_id (findUsers) | ✅ tenant_id (findOne) | ✅ tenant_id | N/A | N/A | portalLogin: tenantId/tenantSlug opcionais |
| **Settings** | N/A | ✅ tenant_id | ✅ tenant_id | N/A | N/A | findByTenant, update |
| **Ticket Settings** | ✅ tenant_id | ✅ getOrFail | ✅ tenant_id | ✅ tenant_id | ✅ parent/child com tenant_id | findTree, findDepartmentsList |
| **Webhooks** | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | ✅ tenant_id | N/A | fire usa tenant_id |
| **Api Keys** | ✅ tenant_id | N/A | N/A | ✅ tenant_id | N/A | validate por key (global); retorna apiKey com tenantId |
| **Monitoring** | N/A | N/A | N/A | N/A | N/A | tenantStats: tenant_id; global/suspicious: super_admin |

---

## Onde Havia Risco

| Módulo | Risco | Status |
|--------|-------|--------|
| Internal Chat | recipientId sem validação | ✅ Corrigido |
| Monitoring | global/suspicious sem role | ✅ Corrigido |
| Portal Login | contato sem tenant | ✅ Corrigido (opcional) |
| Contracts | consumeHours sem tenant | ✅ Corrigido (Fase 5) |

---

## O Que Já Estava Correto

- Tickets: getTicketOrFail, assertClientBelongsToTenant, assertUserBelongsToTenant, assertContractBelongsToTenant
- Customers: getClientOrFail, getContactOrFail, assertNetworkBelongsToTenant, findClientAndContactByEmail
- Contracts: getContractOrFail, findByTenant, findOne, getExpiringSoon, getConsumption
- Networks, Devices, Knowledge, Conversations: filtros por tenant_id
- Dashboard: todas as queries com tenant_id
- Webhooks, ApiKeys, RoutingRules, TicketSettings, Settings, Attendance: tenant_id em operações

---

## O Que Ainda Depende de Decisão de Negócio

1. **Portal Login sem tenantId/tenantSlug**: Mantém primeiro match. Se o frontend puder enviar tenant (ex.: subdomínio, slug na URL), recomenda-se usar.
2. **Email único em User**: Atualmente global. Se quiser email por tenant, exige mudança de schema.
3. **Monitoring global/suspicious**: Restrito a super_admin. Se outros perfis precisarem, definir regra explícita.

---

## Testes Manuais Prioritários

1. **Internal Chat**: Enviar mensagem para userId de outro tenant → deve retornar 400
2. **Monitoring**: Usuário comum em GET /monitoring/global → deve retornar 403
3. **Portal Login**: Com tenantId no body → deve filtrar por tenant
4. **Team**: Usuário com network_id → listar equipe → apenas rede + NULL
5. **Tickets**: Buscar ticket por id de outro tenant → 404
6. **Customers**: Buscar cliente por id de outro tenant → 404

---

## Arquivos Alterados

| Arquivo | Alteração |
|---------|-----------|
| `internal-chat/internal-chat.service.ts` | assertRecipientInTenant; validação em sendMessage e getMessages |
| `monitoring/monitoring.controller.ts` | @Roles('super_admin') em global e suspicious |
| `auth/auth.controller.ts` | portalLogin com tenantId, tenantSlug |
| `auth/auth.service.ts` | portalLogin com filtro opcional por tenant |
| `common/scope/scope.utils.ts` | TEAM_NETWORK_SCOPE documentado |
