# Análise e Plano de Melhoria – SempreDesk

**Data:** 2025-03-19  
**Objetivo:** Evoluir o módulo de agentes, permissões e status para base mais profissional e escalável.

---

## 1. ANÁLISE DA ESTRUTURA ATUAL

### 1.1 Usuários/Agentes

| Local | Descrição |
|-------|-----------|
| `backend/src/modules/auth/user.entity.ts` | Entidade User: id, tenant_id, name, email, password, role, status, phone, avatar, last_login, settings |
| `backend/src/modules/team/team.service.ts` | CRUD de membros (usa User) |
| `backend/src/modules/auth/auth.service.ts` | Login, refresh, createUser, findUsers |

**Roles atuais:** `super_admin`, `admin`, `manager`, `technician`, `viewer`, `client_contact`  
**Status:** `active`, `inactive`, `suspended`

**Problemas identificados:**
- Sem `network_id` em users (visão por rede não suportada para agentes)
- Permissões baseadas apenas em role string, sem granularidade

### 1.2 Autenticação

| Local | Descrição |
|-------|-----------|
| `backend/src/modules/auth/strategies/jwt.strategy.ts` | JWT Bearer, payload: sub, email, role, tenantId, name |
| `backend/src/modules/auth/guards/jwt-auth.guard.ts` | AuthGuard('jwt'), @Public(), preenche req.user |
| `frontend/src/store/auth.store.ts` | Zustand persist, setAuth/clearAuth |

**Funcionando:** Login, refresh, logout, clock-in automático.

### 1.3 Permissões

| Local | Descrição |
|-------|-----------|
| `backend/src/common/guards/roles.guard.ts` | Verifica `user.role` contra `@Roles(...)` |
| `backend/src/common/decorators/roles.decorator.ts` | `@Roles('admin','super_admin')` |

**Problemas:**
- Sem RBAC (Role-Based Access Control)
- Sem permissões granulares (ticket.view, customer.edit, etc.)
- Lógica frágil: apenas checagem de role

### 1.4 Listagem de Agentes

| Local | Descrição |
|-------|-----------|
| `frontend/src/app/dashboard/team/page.tsx` | Lista agentes, filtros, modal criar/editar |
| `GET /api/v1/team` | TeamService.findTechnicians(tenantId) |

**Problemas:**
- Reload completo ao salvar
- Sem paginação
- Sem quantidade de tickets ativos por agente
- Sem última atividade (last_seen)

### 1.5 Status Online/Offline

| Local | Descrição |
|-------|-----------|
| `backend/src/modules/realtime/realtime-presence.service.ts` | Map em memória: tenantId -> userId -> Set<socketId> |
| `backend/src/modules/realtime/realtime.gateway.ts` | join-tenant, leave-tenant, handleDisconnect |
| `frontend/src/components/PresenceProvider.tsx` | Socket.IO, join-tenant, internal-chat:presence |
| `GET /api/v1/internal-chat/online` | Fallback REST |

**Problemas:**
- Apenas ONLINE/OFFLINE (sem AWAY, BUSY)
- Presença em memória (não escala com múltiplas instâncias)
- Sem Redis
- Sem heartbeat explícito
- Sem last_seen persistido

### 1.6 Filtros Empresa/Rede

| Conceito | Implementação |
|----------|---------------|
| Empresa | `tenant_id` em todas as entidades |
| Rede | `network_id` em clients, networks; filtro em customers |
| Agentes | Apenas `tenant_id`, sem `network_id` |

**Problemas:**
- Agente não pode ser restrito a uma rede específica

### 1.7 Banco de Dados

- **ORM:** TypeORM
- **Sincronização:** `synchronize: true` (cuidado em produção)
- **Redis:** ioredis no package.json, não utilizado no código

---

## 2. DIAGNÓSTICO DOS PROBLEMAS

| Área | Problema | Impacto |
|------|----------|---------|
| Permissões | Apenas roles, sem granularidade | Risco de over-permission, difícil evoluir |
| Agentes | Sem network_id | Não suporta escopo por rede |
| Presença | Memória, só online/offline | Não escala, sem AWAY/BUSY |
| Frontend | Reload completo | UX ruim, perde posição |
| Arquitetura | Permissões espalhadas | Manutenção difícil |

---

## 3. PLANO DE MELHORIA INCREMENTAL

### Fase 1 – RBAC e Estrutura de Permissões (prioridade máxima)
1. Criar entidades: `Permission`, `Role`, `RolePermission`
2. Seed de roles (admin, supervisor, agente, viewer) e permissions
3. `PermissionsGuard` + decorator `@RequirePermission()`
4. Mapear roles atuais para novo sistema
5. Manter `RolesGuard` funcionando (compatibilidade)

### Fase 2 – Estrutura de Agentes
1. Adicionar `network_id` (nullable) em users
2. Garantir campos: id, nome, email, senha, telefone, avatar, role, tenant_id, network_id, status, last_login, created_at, updated_at

### Fase 3 – Presença Avançada
1. Integrar Redis para presença (opcional, fallback em memória)
2. Estados: ONLINE, AWAY, BUSY, OFFLINE
3. Heartbeat a cada 15s
4. last_seen em Redis/cache

### Fase 4 – Frontend Estável
1. Atualização parcial da lista (apenas item alterado)
2. Manter paginação e filtros
3. Indicadores visuais: verde, vermelho, amarelo, azul

### Fase 5 – Organização e Escalabilidade
1. Separar módulo de permissões
2. Documentar fluxos
3. Preparar para migrações (desligar synchronize em prod)

---

## 4. ESTRATÉGIA DE COMPATIBILIDADE

- **Login:** Sem alteração
- **JWT:** Sem alteração
- **RolesGuard:** Continua funcionando; novos endpoints podem usar `@RequirePermission()`
- **user.role:** Mantido; mapeamento interno para RBAC
- **Rotas:** Sem alteração de paths
- **Frontend:** Melhorias incrementais sem quebrar fluxos

---

## 5. IMPLEMENTAÇÃO FASE 1 (CONCLUÍDA)

### 5.1 Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `backend/src/modules/permissions/entities/permission.entity.ts` | Entidade Permission (code, name, module) |
| `backend/src/modules/permissions/entities/role.entity.ts` | Entidade Role (slug, name) |
| `backend/src/modules/permissions/entities/role-permission.entity.ts` | Tabela N:N role_permissions |
| `backend/src/modules/permissions/permissions.constants.ts` | Códigos de permissão e mapeamento |
| `backend/src/modules/permissions/permissions.service.ts` | hasPermission, getPermissionsByRole, seed |
| `backend/src/modules/permissions/permissions.module.ts` | Módulo + seed no onModuleInit |
| `backend/src/common/decorators/require-permission.decorator.ts` | @RequirePermission(...) |
| `backend/src/common/guards/permissions.guard.ts` | PermissionsGuard |

### 5.2 Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `backend/src/app.module.ts` | Import PermissionsModule |
| `backend/src/modules/auth/auth.module.ts` | Import PermissionsModule |
| `backend/src/modules/auth/auth.controller.ts` | PermissionsService, me() com permissions, GET /auth/permissions |
| `backend/src/modules/auth/auth.service.ts` | setPermissionsService, login retorna permissions |
| `backend/src/modules/auth/user.entity.ts` | Campo network_id (nullable) |
| `frontend/src/lib/api.ts` | getPermissions() |

### 5.3 Permissões disponíveis

- dashboard.view, ticket.view, ticket.create, ticket.reply, ticket.transfer, ticket.close, ticket.reopen
- customer.view, customer.create, customer.edit
- agent.view, agent.create, agent.edit, agent.delete
- settings.manage, reports.view
- knowledge.view, knowledge.edit
- contracts.view, contracts.edit
- networks.view, networks.edit
- devices.view
- alerts.view, alerts.manage

### 5.4 Roles e permissões (seed)

- **super_admin / admin**: todas as permissões
- **manager (supervisor)**: tickets, customers, agents (view), reports, knowledge, contracts, networks, devices, alerts
- **technician (agente)**: tickets (view/create/reply/close), customers (view), agents (view), knowledge, contracts, devices, alerts
- **viewer**: apenas visualização (dashboard, tickets, customers, agents, reports, knowledge, contracts, devices, alerts)

### 5.5 Uso do PermissionsGuard

```ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('agent.create')
@Post()
create(...) { ... }
```

### 5.6 Impacto técnico

- Novas tabelas: `permissions`, `roles`, `role_permissions`
- Nova coluna: `users.network_id` (nullable)
- Login e /auth/me retornam `permissions: string[]`
- RolesGuard continua funcionando; PermissionsGuard é opcional

---

## 6. TESTES MANUAIS RECOMENDADOS

1. **Login**: Fazer login e verificar que `user.permissions` vem no response
2. **GET /auth/me**: Verificar que retorna permissions
3. **GET /auth/permissions**: Verificar array de códigos
4. **Equipe**: Criar/editar membros (admin) – deve continuar funcionando
5. **Tickets**: Abrir, responder, fechar – fluxos inalterados
6. **Banco**: Verificar criação de tabelas permissions, roles, role_permissions

---

## 7. PRÓXIMOS PASSOS

1. Aplicar `@RequirePermission()` em endpoints críticos (substituir gradualmente @Roles)
2. Frontend: usar `user.permissions` para esconder botões/menus
3. Fase 2: Presença com Redis (ONLINE/AWAY/BUSY/OFFLINE)
4. Fase 3: Frontend estável (atualização parcial da lista de agentes)
