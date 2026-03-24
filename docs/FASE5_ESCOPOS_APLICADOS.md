# Fase 5 – Escopos por Empresa e Rede

## Análise do uso atual

### tenant_id
- **Origem**: JWT (user.tenantId) → `req.tenantId` via `JwtAuthGuard`
- **Decorator**: `@TenantId()` em controllers
- **Uso**: Filtro em todas as listagens e operações por id

### network_id
- **User**: Campo opcional em `users.network_id` – restringe escopo do agente
- **Client**: Campo em `clients.network_id` – agrupa clientes por rede
- **Uso**: Portal (contato primary vê clientes da mesma rede), validação de contato↔cliente

---

## Problemas encontrados e corrigidos

### 1. ContractsService.consumeHours (CRÍTICO)
- **Problema**: Buscava contrato apenas por `id`, sem `tenant_id`
- **Risco**: Consumo de horas de contrato de outro tenant
- **Correção**: Assinatura alterada para `consumeHours(tenantId, id, minutes)`; usa `getContractOrFail(tenantId, id)` antes de incrementar

### 2. InternalChatService.getConversations
- **Problema**: `userRepo.findOne({ where: { id: otherId } })` sem `tenantId`
- **Risco**: Em cenário de dados inconsistentes, poderia expor nome de usuário de outro tenant
- **Correção**: Adicionado `tenantId` ao where: `{ id: otherId, tenantId }`

### 3. TeamService.findTechnicians (escopo por rede)
- **Problema**: Não considerava `network_id` do usuário
- **Regra**: Supervisor com `network_id` deve ver apenas agentes da mesma rede
- **Correção**: Parâmetro opcional `networkId`; quando informado, filtra `(network_id = :networkId OR network_id IS NULL)`

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `contracts/contracts.service.ts` | `consumeHours(tenantId, id, minutes)` com validação de escopo |
| `tickets/tickets.service.ts` | Chamada a `consumeHours` atualizada com `tenantId` |
| `internal-chat/internal-chat.service.ts` | Lookup de usuário com `tenantId` |
| `team/team.service.ts` | `findTechnicians(tenantId, networkId?)` com filtro por rede |
| `team/team.controller.ts` | Passa `req.user?.networkId` para `findTechnicians` |
| `common/scope/scope.utils.ts` | Helper de escopo (base para futuras validações) |

---

## Módulos já com escopo correto (revisados)

- **Tickets**: `getTicketOrFail`, `assertClientBelongsToTenant`, `assertUserBelongsToTenant`
- **Customers**: `getClientOrFail`, `getContactOrFail`, `assertNetworkBelongsToTenant`
- **Contracts**: `getContractOrFail`, `assertClientBelongsToTenant`, `findByTenant`, `findOne`, `getExpiringSoon`
- **Networks**: `findOne`, `findAll`, `update`, `remove` com `tenantId`
- **Devices**: `findOne`, `findAll`, `getEvents`, `getOfflineDevices`, `assertClientBelongsToTenant`
- **Dashboard**: Todas as queries com `tenant_id`
- **Knowledge**: `getArticleOrFail`, `assertCategoryBelongsToTenant`
- **Conversations**: `findOne`, `getOrCreateForContact` com `tenantId`
- **Team**: `findOne`, `create`, `update`, `remove` com `tenantId`
- **Auth**: `findUsers`, `findOne`, `updateUser` com `tenantId`
- **Settings, TicketSettings, Webhooks, ApiKeys, RoutingRules**: Filtro por `tenantId`

---

## Testes manuais recomendados

1. **ConsumeHours**: Resolver ticket com contrato; verificar que horas são consumidas apenas do contrato do tenant correto
2. **Chat interno**: Enviar mensagem; verificar que conversas listam apenas usuários do tenant
3. **Team com network_id**: Usuário com `network_id` preenchido deve ver apenas agentes da mesma rede (ou com `network_id` null)
4. **Cross-tenant**: Usuário do tenant A não deve acessar registros do tenant B (busca por id retorna 404)

---

## Possíveis riscos

- **Team networkId**: Se `network_id` não estiver populado em usuários, o filtro não altera o comportamento (mostra todos do tenant)
- **Compatibilidade**: Alteração em `consumeHours` é breaking apenas para chamadas internas; a única chamada é de `tickets.service`, já atualizada
