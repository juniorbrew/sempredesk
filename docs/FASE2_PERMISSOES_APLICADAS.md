# Fase 2 – Permissões Aplicadas nos Endpoints

**Data:** 2025-03-19

## Resumo

Permissões reais foram aplicadas nos endpoints críticos do SempreDesk usando `@RequirePermission()` e `PermissionsGuard`, mantendo `RolesGuard` onde já existia.

## Alterações no PermissionsGuard

- **Bypass para portal:** Usuários com `user.isPortal === true` passam automaticamente (controle de acesso feito nos services).

## Novas Permissões

- `ticket.edit` – editar ticket (Put)
- `devices.edit` – criar/editar dispositivos

## Rotas Protegidas por Permissão

### Agentes / Team
| Rota | Método | Permissão |
|------|--------|-----------|
| /team | GET | agent.view |
| /team | POST | agent.create |
| /team/:id | GET | agent.view |
| /team/:id | PUT | agent.edit |
| /team/:id | DELETE | agent.delete |

### Auth (users)
| Rota | Método | Permissão |
|------|--------|-----------|
| /auth/users | POST | agent.create |
| /auth/users | GET | agent.view |
| /auth/users/:id | PUT | agent.edit |

### Tickets
| Rota | Método | Permissão |
|------|--------|-----------|
| /tickets | POST | ticket.create |
| /tickets | GET | ticket.view |
| /tickets/stats | GET | ticket.view |
| /tickets/conversations | GET | ticket.view |
| /tickets/by-number/:number | GET | ticket.view |
| /tickets/:id | GET | ticket.view |
| /tickets/:id | PUT | ticket.edit |
| /tickets/:id/assign | POST | ticket.transfer |
| /tickets/:id/resolve | POST | ticket.close |
| /tickets/:id/close | POST | ticket.close |
| /tickets/:id/cancel | POST | ticket.close |
| /tickets/:id/escalate | POST | ticket.transfer |
| /tickets/:id/messages | GET | ticket.view |
| /tickets/:id/messages | POST | ticket.reply |

### Clientes
| Rota | Método | Permissão |
|------|--------|-----------|
| /customers | POST | customer.create |
| /customers | GET | customer.view |
| /customers/:id | GET | customer.view |
| /customers/:id | PUT | customer.edit |
| /customers/:id | DELETE | customer.edit |
| /customers/:id/contacts | POST | customer.edit |
| /customers/:id/contacts | GET | customer.view |
| /customers/:id/contacts/:cid | PUT | customer.edit |
| /customers/:id/contacts/:cid | DELETE | customer.edit |

### Contratos
| Rota | Método | Permissão |
|------|--------|-----------|
| /contracts | POST | contracts.edit |
| /contracts | GET | contracts.view |
| /contracts/expiring | GET | contracts.view |
| /contracts/:id | GET | contracts.view |
| /contracts/:id/consumption | GET | contracts.view |
| /contracts/:id | PUT | contracts.edit |

### Redes
| Rota | Método | Permissão |
|------|--------|-----------|
| /networks | POST | networks.edit |
| /networks | GET | networks.view |
| /networks/:id | GET | networks.view |
| /networks/:id | PUT | networks.edit |
| /networks/:id | DELETE | networks.edit |

### Dispositivos
| Rota | Método | Permissão |
|------|--------|-----------|
| /devices | POST | devices.edit |
| /devices | GET | devices.view |
| /devices/summary | GET | devices.view |
| /devices/offline | GET | devices.view |
| /devices/:id | GET | devices.view |
| /devices/:id | PUT | devices.edit |
| /devices/:id/events | GET | devices.view |
| /devices/:id/heartbeat | POST | (sem permissão – dispositivo) |

### Configurações
| Rota | Método | Permissão |
|------|--------|-----------|
| /settings | GET | settings.manage |
| /settings | PUT | settings.manage |
| /settings/test-smtp | POST | settings.manage |

### Ticket Settings
| Rota | Método | Permissão |
|------|--------|-----------|
| /ticket-settings | POST | settings.manage |
| /ticket-settings | GET | settings.manage |
| /ticket-settings/tree | GET | settings.manage |
| /ticket-settings/departments | GET | settings.manage |
| /ticket-settings/:id | GET | settings.manage |
| /ticket-settings/:id | PUT | settings.manage |
| /ticket-settings/:id | DELETE | settings.manage |

### Base de Conhecimento
| Rota | Método | Permissão |
|------|--------|-----------|
| /knowledge/search | GET | knowledge.view |
| /knowledge/categories | GET | knowledge.view |
| /knowledge/categories | POST | knowledge.edit |
| /knowledge | GET | knowledge.view |
| /knowledge | POST | knowledge.edit |
| /knowledge/:id | GET | knowledge.view |
| /knowledge/:id | PUT | knowledge.edit |
| /knowledge/:id | DELETE | knowledge.edit |

### Dashboard
| Rota | Método | Permissão |
|------|--------|-----------|
| /dashboard/summary | GET | dashboard.view |
| /dashboard/tickets-by-priority | GET | dashboard.view |
| /dashboard/ticket-trend | GET | dashboard.view |
| /dashboard/sla-report | GET | reports.view |

### Alertas
| Rota | Método | Permissão |
|------|--------|-----------|
| /alerts/test | POST | alerts.manage |

### Chat Interno
| Rota | Método | Permissão |
|------|--------|-----------|
| /internal-chat/users | GET | agent.view |
| /internal-chat/online | GET | agent.view |
| /internal-chat/messages/:recipientId | GET | ticket.view |
| /internal-chat/messages | POST | ticket.reply |

## Arquivos Alterados

| Arquivo | Alteração |
|---------|-----------|
| `permissions.constants.ts` | ticket.edit, devices.edit |
| `permissions.guard.ts` | Bypass para user.isPortal |
| `permissions.service.ts` | ticket.edit, devices.edit, networks.edit nos roles |
| `team.controller.ts` | PermissionsGuard + RequirePermission |
| `team.module.ts` | Import PermissionsModule |
| `auth.controller.ts` | PermissionsGuard + RequirePermission em users |
| `tickets.controller.ts` | PermissionsGuard + RequirePermission em todos |
| `tickets.module.ts` | Import PermissionsModule |
| `customers.controller.ts` | PermissionsGuard + RequirePermission |
| `customers.module.ts` | Import PermissionsModule |
| `contracts.controller.ts` | PermissionsGuard + RequirePermission |
| `contracts.module.ts` | Import PermissionsModule |
| `networks.controller.ts` | PermissionsGuard + RequirePermission |
| `networks.module.ts` | Import PermissionsModule |
| `devices.controller.ts` | PermissionsGuard + RequirePermission |
| `devices.module.ts` | Import PermissionsModule |
| `settings.controller.ts` | PermissionsGuard + RequirePermission |
| `settings.module.ts` | Import PermissionsModule |
| `knowledge.controller.ts` | PermissionsGuard + RequirePermission |
| `knowledge.module.ts` | Import PermissionsModule |
| `dashboard.controller.ts` | PermissionsGuard + RequirePermission |
| `dashboard.module.ts` | Import PermissionsModule |
| `alerts.controller.ts` | PermissionsGuard + RequirePermission |
| `alerts.module.ts` | Import PermissionsModule |
| `ticket-settings.controller.ts` | PermissionsGuard + RequirePermission |
| `ticket-settings.module.ts` | Import PermissionsModule |
| `internal-chat.controller.ts` | PermissionsGuard + RequirePermission |
| `internal-chat.module.ts` | Import PermissionsModule |

## Impacto

- Usuários com role sem permissão recebem 403 Forbidden.
- Portal continua funcionando (bypass de permissões).
- RolesGuard e PermissionsGuard atuam em conjunto onde ambos são usados.

## Testes Manuais

1. Login como admin – verificar acesso a todas as rotas.
2. Login como technician – verificar bloqueio em agent.create, agent.edit, agent.delete, settings.manage.
3. Login como viewer – verificar bloqueio em create/edit/delete em todos os módulos.
4. Portal – login e acesso a tickets do cliente.
5. Chat interno – verificar acesso a agentes e mensagens.
