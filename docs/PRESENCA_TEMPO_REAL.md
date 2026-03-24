# Presença em Tempo Real – Arquitetura

## Visão Geral

Status de presença dos agentes: **ONLINE**, **OFFLINE**, **AWAY**, **BUSY**.

- **Canal principal**: WebSocket (Socket.io, namespace `/realtime`)
- **Armazenamento**: Redis (quando configurado) ou memória (fallback)
- **Heartbeat**: 15 segundos
- **Offline**: 45 segundos sem heartbeat

---

## Arquitetura

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│    Frontend     │◄──────────────────►│ RealtimeGateway  │
│  (PresenceProv) │  join-tenant       │                  │
└─────────────────┘  presence:heartbeat│  ┌──────────────┐ │
         │            presence:set-status  │   Presence   │ │
         │                                 │   Service    │ │
         │     HTTP (fallback)             │              │ │
         │     GET /presence               └──────┬───────┘ │
         │     GET /internal-chat/online         │         │
         └──────────────────────────────────────┼─────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │  Redis (se config)    │
                                    │  ou Memória           │
                                    └───────────────────────┘
```

---

## Chaves Redis

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `presence:data:{tenantId}:{userId}` | String (JSON) | `{status, lastSeen}` – TTL 90s |
| `presence:sockets:{tenantId}:{userId}` | Integer | Contador de sockets (multi-tab) |
| `presence:tenant:{tenantId}` | Set | userIds do tenant |
| `presence:tenants` | Set | tenantIds ativos |

---

## Fluxo Técnico

### Conexão
1. Frontend conecta ao WebSocket com JWT
2. Emite `join-tenant` com `{ tenantId, userId }`
3. Gateway chama `presence.add(tenantId, userId, socketId)`
4. Presença é emitida para o tenant

### Heartbeat (15s)
1. Frontend emite `presence:heartbeat` a cada 15s
2. Gateway chama `presence.heartbeatAsync()`
3. Atualiza `lastSeen` no Redis/memória
4. Emite nova presença ao tenant

### Mudança de status (AWAY/BUSY)
1. Frontend emite `presence:set-status` com `{ status: 'away' | 'busy' }`
2. Gateway chama `presence.setStatusAsync()`
3. Emite nova presença ao tenant

### Desconexão
1. `handleDisconnect` chama `presence.remove(socketId)`
2. Se era o último socket do usuário, remove do Redis
3. Emite nova presença ao tenant

### Offline automático
- A cada 15s, o gateway percorre tenants e emite presença
- `getPresenceMap` considera `lastSeen > 45s` como offline

---

## Endpoints HTTP (apoio)

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/presence` | agent.view | Lista onlineIds e statusMap do tenant |
| GET | `/presence/status/:userId` | agent.view | Status de um agente |
| POST | `/presence/status/batch` | agent.view | Status de vários agentes `{ userIds: [] }` |
| POST | `/presence/set-status` | agent.edit | Define status do usuário atual `{ status }` |
| GET | `/internal-chat/online` | agent.view | Compatível com frontend atual |

---

## API do Serviço de Presença

| Método | Descrição |
|--------|-----------|
| `add(tenantId, userId, socketId)` | Registra conexão |
| `remove(socketId)` | Remove conexão |
| `heartbeatAsync(tenantId, userId, socketId)` | Atualiza lastSeen |
| `setStatusAsync(tenantId, userId, status)` | Define status (online/away/busy) |
| `getOnlineIdsAndStatus(tenantId)` | Retorna `{ onlineIds, statusMap }` |
| `setOnline(tenantId, userId)` | Marca online |
| `setAway(tenantId, userId)` | Marca away |
| `setBusy(tenantId, userId)` | Marca busy |
| `setOffline(tenantId, userId)` | Marca offline |
| `getStatus(tenantId, userId)` | Status de um agente |
| `getManyStatuses(tenantId, userIds)` | Status de vários agentes |

---

## Arquivos Alterados

| Arquivo | Alteração |
|---------|-----------|
| `modules/redis/redis.module.ts` | Novo – cliente Redis opcional |
| `modules/realtime/realtime-presence.service.ts` | Redis + fallback memória; API setOnline/setAway/setBusy/setOffline |
| `modules/realtime/realtime.gateway.ts` | Métodos async para heartbeat e presença |
| `modules/realtime/presence.controller.ts` | Novo – endpoints de apoio |
| `modules/realtime/realtime.module.ts` | PresenceController, PermissionsModule |
| `app.module.ts` | RedisModule |
| `docs/PRESENCA_TEMPO_REAL.md` | Documentação |

---

## Configuração

```env
REDIS_HOST=localhost   # Se vazio, usa memória
REDIS_PORT=6379
REDIS_PASSWORD=        # Opcional
```

---

## Testes Manuais

1. **Sem Redis**: Iniciar sem REDIS_HOST → presença em memória
2. **Com Redis**: Iniciar com Redis → presença em Redis
3. **WebSocket**: Conectar, emitir join-tenant → receber presence
4. **Heartbeat**: Emitir presence:heartbeat a cada 15s → status mantido
5. **Set status**: Emitir presence:set-status { status: 'away' } → status atualizado
6. **HTTP**: GET /presence → retorna onlineIds e statusMap
7. **Desconexão**: Fechar socket → usuário removido da presença

---

## Riscos e Limitações

- **Redis indisponível**: Fallback automático para memória; multi-instância não funciona
- **Race condition**: Remove assíncrono no Redis pode atrasar atualização em ~100ms
- **Campo status do banco**: Mantido; não usado como fonte de presença em tempo real
