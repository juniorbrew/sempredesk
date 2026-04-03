# Cursor Prompts — SempreDesk: Correções de Infraestrutura
> Baseado na Análise Técnica de 30/03/2026.
> Execute em ordem. Cada etapa é independente e pode ser aplicada, testada e subida para VPS separadamente.

---

## ETAPA 1 — Backup Automático do Banco
> **Por que primeiro:** sem backup, qualquer erro nas etapas seguintes pode ser catastrófico. Resolva isso antes de qualquer outra coisa.

```
Preciso criar um script de backup automático do PostgreSQL para o projeto SempreDesk.

Contexto do projeto:
- Docker Compose em /opt/suporte-tecnico/docker-compose.yml
- Container do banco: serviço "postgres", usuário "suporte", banco "suporte_tecnico"
- Volume de dados: postgres_data

O que preciso:

1. Criar o arquivo /opt/suporte-tecnico/infra/scripts/backup.sh com:
   - pg_dump via docker exec no container postgres
   - Compressão gzip
   - Nome do arquivo com timestamp: backup_YYYYMMDD_HHMM.sql.gz
   - Salvar em /opt/suporte-tecnico/backups/
   - Retenção automática: apagar backups com mais de 30 dias
   - Verificar se o backup foi gerado com sucesso (checar tamanho > 0)
   - Logar resultado em /var/log/sempredesk-backup.log

2. Criar /opt/suporte-tecnico/infra/scripts/restore.sh com:
   - Recebe o arquivo .sql.gz como argumento
   - Confirma antes de restaurar (read -p)
   - Para o container backend antes de restaurar
   - Executa o restore via docker exec
   - Reinicia o backend depois

3. Adicionar ao docker-compose.yml um serviço "backup" usando imagem postgres:15-alpine que:
   - Roda no mesmo network dos outros serviços
   - Tem acesso ao volume postgres_data
   - Executa o backup.sh via cron (todo dia às 3h)
   - NÃO expõe porta alguma

4. Criar a pasta /opt/suporte-tecnico/backups/.gitkeep e adicionar /opt/suporte-tecnico/backups/*.gz no .gitignore

Mantenha compatibilidade com o docker-compose.yml existente.
```

---

## ETAPA 2 — Row-Level Security (RLS) no PostgreSQL
> **Por que:** isolamento de dados por tenant garantido no banco, não só no código. Proteção contra qualquer bug que esqueça o tenantId.

```
Preciso adicionar Row-Level Security (RLS) no PostgreSQL do projeto SempreDesk para garantir isolamento de dados por tenant no nível do banco de dados.

Contexto:
- PostgreSQL 15 com schema em /opt/suporte-tecnico/infra/postgres/init.sql
- Migrations em /opt/suporte-tecnico/infra/postgres/migrations/
- Backend NestJS usa TypeORM com usuário "suporte" para queries
- Todas as tabelas têm coluna tenant_id (VARCHAR ou UUID)
- A aplicação injeta o tenantId via middleware em req.tenantId

O que preciso:

1. Criar migration /opt/suporte-tecnico/infra/postgres/migrations/010_row_level_security.sql com:

   a) Criar um segundo usuário PostgreSQL "suporte_app" com permissões restritas (sem BYPASSRLS)

   b) Habilitar RLS nas tabelas críticas:
      - tickets, ticket_messages, conversations, conversation_messages
      - clients, contacts, contact_customers
      - contracts, devices, device_metrics, device_events
      - users, chatbot_configs, chatbot_sessions
      - tags, root_causes, ticket_settings
      - agent_departments, distribution_queues
      - tenant_settings, routing_rules, webhooks, api_keys

   c) Para cada tabela, criar política de isolamento:
      CREATE POLICY tenant_isolation ON <tabela>
        USING (tenant_id = current_setting('app.tenant_id', true));

   d) Manter superuser "suporte" com BYPASSRLS para migrations e operações administrativas

   e) Incluir comentários explicando cada bloco

2. No arquivo /opt/suporte-tecnico/backend/src/modules/redis/redis.module.ts ou em um novo arquivo /opt/suporte-tecnico/backend/src/database/typeorm-tenant.subscriber.ts:
   Criar um TypeORM Subscriber (implements EntitySubscriberInterface) que, antes de cada query, execute:
   SET LOCAL app.tenant_id = '<tenantId>'
   O tenantId deve vir do AsyncLocalStorage ou de um contexto injetável.

3. Em /opt/suporte-tecnico/backend/src/common/middleware/tenant.middleware.ts (ou criar se não existir):
   Garantir que o AsyncLocalStorage seja populado com o tenantId do JWT antes de qualquer query.

4. Adicionar no arquivo /opt/suporte-tecnico/backend/src/app.module.ts:
   Registrar o TenantSubscriber no TypeORM.

IMPORTANTE: A migration deve ser reversível (incluir seção de rollback comentada).
O usuário "suporte" existente deve continuar funcionando para não quebrar o ambiente atual.
```

---

## ETAPA 3 — Idempotência em Webhooks do WhatsApp
> **Por que:** Baileys e Meta API reenviam eventos em falhas de rede. Sem isso, a mesma mensagem cria tickets ou mensagens duplicadas.

```
Preciso adicionar idempotência no processamento de mensagens inbound do WhatsApp no projeto SempreDesk.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/whatsapp/baileys.service.ts
  - Linha ~440: this.onMessageCallback?.(tenantId, from, text, msg.key.id, ...)
  - O msg.key.id é o externalId único da mensagem no WhatsApp
- /opt/suporte-tecnico/backend/src/modules/conversations/entities/conversation-message.entity.ts
  - Já possui campo external_id (VARCHAR)
- /opt/suporte-tecnico/backend/src/modules/whatsapp/whatsapp.service.ts
  - Método que processa a mensagem recebida e cria ticket/conversation_message

O que preciso:

1. Em /opt/suporte-tecnico/backend/src/modules/whatsapp/whatsapp.service.ts:
   No método que processa mensagem inbound (que recebe externalId/messageId do Baileys):

   a) Antes de qualquer processamento, verificar se já existe conversation_message com esse external_id para o tenant:
      const existing = await this.convMsgRepo.findOne({
        where: { externalId: messageId, tenantId }
      });
      if (existing) {
        this.logger.debug(`[IDEMPOTÊNCIA] Mensagem ${messageId} já processada — ignorando`);
        return;
      }

   b) Ao salvar a conversation_message, garantir que external_id é sempre preenchido com o messageId

   c) Adicionar try/catch específico para UniqueConstraintViolation (código PostgreSQL '23505') retornando silenciosamente

2. Criar migration /opt/suporte-tecnico/infra/postgres/migrations/011_idempotency_indexes.sql:

   a) Adicionar índice UNIQUE em conversation_messages(tenant_id, external_id) WHERE external_id IS NOT NULL
      para garantir unicidade no banco e proteger contra condição de corrida

   b) Adicionar índice em ticket_messages(tenant_id, external_id) WHERE external_id IS NOT NULL
      para o mesmo motivo

3. Em /opt/suporte-tecnico/backend/src/modules/whatsapp/whatsapp.controller.ts:
   No endpoint de webhook da Meta API (POST /webhooks/whatsapp/webhook):
   Aplicar o mesmo padrão de verificação de external_id antes de processar

Manter todos os logs existentes. Não remover nenhuma lógica existente, apenas adicionar a verificação antes do processamento.
```

---

## ETAPA 4 — Counters Atômicos nos Contratos
> **Por que:** dois atendimentos fechando ao mesmo tempo perdem contagem de horas/tickets. Fix simples e cirúrgico.

```
Preciso corrigir race condition nos contadores de horas e tickets do módulo de contratos no SempreDesk.

Arquivo principal:
- /opt/suporte-tecnico/backend/src/modules/contracts/contracts.service.ts
  - Método consumeHours (linhas ~108-123) usa contractRepo.increment() em duas chamadas separadas
  - Isso não é atômico: duas chamadas simultâneas podem resultar em contagem incorreta

O que preciso:

1. No arquivo /opt/suporte-tecnico/backend/src/modules/contracts/contracts.service.ts:

   a) Substituir o método consumeHours para usar uma única query SQL atômica com QueryBuilder:

      await this.contractRepo
        .createQueryBuilder()
        .update()
        .set({
          hoursUsed: () => `"hours_used" + :delta`,
          ticketsUsed: () => `"tickets_used" + 1`,
        })
        .where('id = :id AND tenant_id = :tenantId', { id: contract.id, tenantId, delta: minutes / 60 })
        .execute();

   b) Criar um método separado consumeTicketOnly(tenantId, id) para incrementar só ticketsUsed quando não há horas a consumir

   c) Adicionar verificação de limite antes do consumo:
      - Se contract.ticketLimit > 0 e ticketsUsed >= ticketLimit, lançar exceção específica (ContractLimitExceededException)
      - Se contract.monthlyHours > 0 e hoursUsed + (minutes/60) > monthlyHours * 1.1 (10% de tolerância), logar warning

2. Em /opt/suporte-tecnico/backend/src/modules/contracts/contracts.module.ts:
   Exportar ContractLimitExceededException como classe pública

3. Em /opt/suporte-tecnico/backend/src/modules/tickets/tickets.service.ts:
   No local onde consumeHours é chamado (ao resolver ticket):
   Capturar ContractLimitExceededException e registrar no ticket_message como nota interna (type: 'internal') em vez de deixar o request falhar

Não alterar a assinatura pública do método consumeHours — apenas a implementação interna.
```

---

## ETAPA 5 — SELECT FOR UPDATE no Round-Robin
> **Por que:** dois tickets chegando simultaneamente podem ser atribuídos ao mesmo agente. Isso é uma race condition clássica.

```
Preciso corrigir a race condition na distribuição round-robin de tickets do SempreDesk.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/ticket-assignment/ticket-assignment.service.ts
  - Contém a lógica de round-robin que lê e atualiza distribution_queues.last_assigned_user_id
  - O problema: read e update são duas operações separadas, não atômicas
- /opt/suporte-tecnico/backend/src/modules/ticket-assignment/entities/distribution-queue.entity.ts
  - Entidade da tabela distribution_queues

O que preciso:

1. No arquivo /opt/suporte-tecnico/backend/src/modules/ticket-assignment/ticket-assignment.service.ts:

   a) No método de atribuição round-robin (que lê last_assigned_user_id e define o próximo agente):
      Envolver toda a lógica em uma transação com SELECT FOR UPDATE:

      return await this.dataSource.transaction(async (manager) => {
        // Adquire lock exclusivo na linha da fila
        const queue = await manager
          .createQueryBuilder(DistributionQueue, 'dq')
          .where('dq.tenantId = :tenantId AND dq.departmentName = :dept', { tenantId, dept })
          .setLock('pessimistic_write')  // SELECT FOR UPDATE
          .getOne();

        if (!queue) return null;

        // ... lógica de round-robin existente usando queue ...

        // Atualizar dentro da mesma transação
        await manager.update(DistributionQueue,
          { tenantId, departmentName: dept },
          { lastAssignedUserId: nextAgentId }
        );

        return nextAgentId;
      });

   b) Adicionar timeout de lock: se não conseguir o lock em 5 segundos, logar warning e usar fallback (primeiro agente disponível)

   c) Manter toda a lógica de filtragem de agentes online (presença Redis) dentro da transação

2. Injetar DataSource no constructor do serviço se ainda não estiver injetado:
   constructor(
     ...existentes...,
     private readonly dataSource: DataSource,
   ) {}

3. Adicionar import de DataSource do typeorm

Não alterar a interface pública do serviço. Apenas a implementação interna do método de round-robin.
```

---

## ETAPA 6 — Distributed Lock nos Schedulers
> **Por que:** com mais de uma instância do backend rodando, os crons disparam em duplicata — notificações duplas, SLA escalado duas vezes.

```
Preciso adicionar distributed lock nos schedulers do SempreDesk para evitar execução duplicada em múltiplas instâncias do backend.

Arquivos com @Cron():
- /opt/suporte-tecnico/backend/src/modules/tickets/tickets.service.ts
  - checkSlaWarnings: @Cron('*/5 * * * *')
  - checkSlaBreaches: @Cron('*/5 * * * *')
  - checkSlaEscalation: @Cron('0 */30 * * * *')
  - autoCloseResolvedTickets: @Cron('0 * * * *')
- /opt/suporte-tecnico/backend/src/modules/ticket-assignment/ticket-assignment.scheduler.ts
  - cleanupStalePresence: @Cron('*/15 * * * *')
- /opt/suporte-tecnico/backend/src/modules/devices/devices.service.ts
  - detectOfflineDevices: @Cron('*/2 * * * *')
- /opt/suporte-tecnico/backend/src/modules/contracts/contracts.service.ts (ou scheduler separado)
  - expireVencidos: @Cron('0 8 * * *')
- /opt/suporte-tecnico/backend/src/modules/email/report-scheduler.service.ts
  - Scheduler de relatórios semanais

Redis disponível em: /opt/suporte-tecnico/backend/src/modules/redis/redis.module.ts
(token de injeção: REDIS_CLIENT, cliente ioredis)

O que preciso:

1. Criar /opt/suporte-tecnico/backend/src/common/decorators/distributed-lock.decorator.ts:

   Um decorator @DistributedLock(lockKey: string, ttlSeconds: number) que:
   - Antes de executar o método, tenta SET lockKey '1' EX ttlSeconds NX no Redis
   - Se não conseguir o lock (retorno null = outra instância está rodando), loga e retorna sem executar
   - Após execução (sucesso ou erro), deleta a chave do Redis
   - Inclui o hostname/instanceId na chave para debug: lock:sla_warnings:hostname
   - TTL deve ser 90% do intervalo do cron (ex: cron de 5min → TTL 270s)

2. Criar /opt/suporte-tecnico/backend/src/common/services/distributed-lock.service.ts:
   - Injectable service que o decorator usa internamente
   - Métodos: acquire(key, ttl): Promise<boolean> e release(key): Promise<void>
   - Injetar REDIS_CLIENT

3. Registrar DistributedLockService no /opt/suporte-tecnico/backend/src/app.module.ts como provider global

4. Aplicar o decorator em todos os métodos @Cron listados acima:
   @Cron('*/5 * * * *')
   @DistributedLock('sla:warnings', 270)
   async checkSlaWarnings() { ... }

   Usar chaves de lock descritivas:
   - 'sla:warnings', 'sla:breaches', 'sla:escalation', 'tickets:auto-close'
   - 'presence:cleanup', 'devices:offline-check', 'contracts:expire', 'reports:weekly'

5. Exportar DistributedLockService de um CommonModule

Não alterar a lógica interna de nenhum scheduler, apenas adicionar o decorator.
```

---

## ETAPA 7 — Redis Adapter no Socket.io
> **Por que:** sem isso é impossível rodar mais de uma instância do backend. Eventos de uma instância não chegam para clientes conectados na outra.

```
Preciso adicionar o Redis Adapter no Socket.io do SempreDesk para suportar múltiplas instâncias do backend.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/realtime/realtime.gateway.ts
  - Contém o @WebSocketGateway com toda a lógica de rooms e eventos
- /opt/suporte-tecnico/backend/src/modules/realtime/realtime.module.ts
  - Registra o gateway
- /opt/suporte-tecnico/backend/src/modules/redis/redis.module.ts
  - Módulo global com REDIS_CLIENT (ioredis)
- /opt/suporte-tecnico/backend/package.json
  - Dependências do projeto

O que preciso:

1. Instalar dependência (adicionar ao package.json e rodar npm install):
   "@socket.io/redis-adapter": "^8.3.0"

2. Criar /opt/suporte-tecnico/backend/src/modules/realtime/realtime-adapter.factory.ts:

   import { createAdapter } from '@socket.io/redis-adapter';
   import Redis from 'ioredis';

   Factory function que recebe as configs do Redis e retorna o adapter configurado.
   Usar duas conexões Redis separadas (pub e sub) como requerido pelo socket.io/redis-adapter.
   Configurar com mesmas credenciais do REDIS_CLIENT existente (host, port, password do .env).

3. Em /opt/suporte-tecnico/backend/src/modules/realtime/realtime.module.ts:
   - Implementar IoAdapter customizado estendendo IoAdapter do @nestjs/platform-socket.io
   - No método createIOServer, aplicar o redis adapter após criar o servidor
   - Registrar como provider e configurar via app.useWebSocketAdapter() no main.ts

4. Em /opt/suporte-tecnico/backend/src/main.ts:
   - Usar o RedisIoAdapter customizado:
     const redisIoAdapter = new RedisIoAdapter(app);
     await redisIoAdapter.connectToRedis();
     app.useWebSocketAdapter(redisIoAdapter);

5. Garantir que as conexões Redis do adapter sejam fechadas gracefully no onModuleDestroy

6. Adicionar log ao conectar o adapter: "Socket.io Redis Adapter connected (pub/sub)"

As rooms, eventos e toda a lógica do realtime.gateway.ts NÃO devem ser alterados.
Apenas a infraestrutura de transport do Socket.io muda.
```

---

## ETAPA 8 — Emails e Notificações via Fila (RabbitMQ)
> **Por que:** emails são síncronos hoje. Um pico de SLA quebrado para 50 tickets simultâneos trava o event loop do NestJS. RabbitMQ já está instalado — só falta usar.

```
Preciso mover o envio de emails do SempreDesk de síncrono para assíncrono usando RabbitMQ (que já está configurado no docker-compose.yml).

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/email/email.service.ts
  - Métodos: sendTicketCreated, sendTicketUpdated, sendTicketResolved, sendEscalationAlert, sendWeeklyReport
  - Hoje são chamados diretamente e de forma síncrona
- /opt/suporte-tecnico/backend/src/modules/email/email.module.ts
- /opt/suporte-tecnico/backend/src/modules/email/report-scheduler.service.ts
- /opt/suporte-tecnico/backend/package.json
- docker-compose.yml: RABBITMQ_URL=amqp://suporte:suporte123@rabbitmq:5672/suporte_vhost

O que preciso:

1. Instalar dependência:
   "@nestjs/microservices": mesma versão do @nestjs/core já instalado
   "amqplib": "^0.10.4"
   "@types/amqplib": "^0.10.4"

2. Criar /opt/suporte-tecnico/backend/src/modules/email/email-queue.service.ts:

   - Injectable service que publica mensagens na fila RabbitMQ
   - Queue name: 'email_notifications'
   - Métodos que espelham o EmailService atual mas apenas PUBLICAM na fila:
     queueTicketCreated(payload), queueTicketUpdated(payload), queueEscalationAlert(payload), etc.
   - Usar ClientProxy do @nestjs/microservices com transport AMQP
   - Em caso de falha ao publicar (RabbitMQ offline), fazer fallback para envio direto síncrono com log de warning

3. Criar /opt/suporte-tecnico/backend/src/modules/email/email.consumer.ts:

   - @MessagePattern('send_ticket_created') async handleTicketCreated(payload)
   - @MessagePattern('send_ticket_updated') async handleTicketUpdated(payload)
   - @MessagePattern('send_escalation_alert') async handleEscalationAlert(payload)
   - etc. — um handler para cada tipo de email
   - Cada handler chama o EmailService original (que faz o envio SMTP real)
   - Em caso de erro SMTP, logar com nível 'error' mas NÃO re-lançar (evita requeue infinito)

4. Atualizar /opt/suporte-tecnico/backend/src/modules/email/email.module.ts:
   - Registrar ClientsModule com AMQP transport
   - Registrar EmailQueueService e EmailConsumer como providers
   - Configurar o consumer como microservice controller

5. Em todos os lugares do codebase onde EmailService é chamado diretamente (tickets.service.ts, schedulers):
   Substituir pela chamada ao EmailQueueService (apenas publicar, não esperar resposta)

6. Em /opt/suporte-tecnico/backend/src/main.ts:
   Conectar o microservice consumer ao mesmo app NestJS:
   app.connectMicroservice({ transport: Transport.RMQ, options: { urls: [RABBITMQ_URL], queue: 'email_notifications' } })
   await app.startAllMicroservices();

Manter o EmailService.ts original intacto — ele continua sendo o que faz o envio SMTP real.
```

---

## ETAPA 9 — Lock de Ownership de Ticket (Anti-colisão de Agentes)
> **Por que:** dois agentes podem responder o mesmo ticket simultaneamente. Adicionar indicador de presença por ticket e soft-lock visual.

```
Preciso adicionar controle de ownership (lock de presença) por ticket no SempreDesk para evitar que dois agentes respondam ao mesmo atendimento simultaneamente.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/realtime/realtime.gateway.ts
  - Contém handlers de join-ticket e leave-ticket
  - Tem acesso ao REDIS_CLIENT
- /opt/suporte-tecnico/backend/src/modules/realtime/realtime.module.ts
- /opt/suporte-tecnico/backend/src/modules/realtime/realtime-presence.service.ts
  - Já gerencia presença global de agentes, pode servir de modelo

O que preciso:

1. Criar /opt/suporte-tecnico/backend/src/modules/realtime/ticket-presence.service.ts:

   Injectable service que gerencia presença por ticket via Redis:

   - setAgentInTicket(tenantId, ticketId, userId, userName): void
     → Redis: SET ticket:presence:{tenantId}:{ticketId} JSON.stringify({userId, userName, since}) EX 30

   - removeAgentFromTicket(tenantId, ticketId, userId): void
     → DEL ticket:presence:{tenantId}:{ticketId}  (apenas se o userId bate)

   - getAgentInTicket(tenantId, ticketId): Promise<{userId, userName, since} | null>
     → GET + JSON.parse

   - refreshPresence(tenantId, ticketId, userId): void
     → EXPIRE ticket:presence:{tenantId}:{ticketId} 30  (renova TTL)

   TTL de 30s: se o agente fechar o browser sem fazer leave, o lock expira automaticamente

2. Em /opt/suporte-tecnico/backend/src/modules/realtime/realtime.gateway.ts:

   a) No handler de 'join-ticket':
      - Chamar ticketPresenceService.getAgentInTicket(tenantId, ticketId)
      - Se outro agente estiver presente, emitir 'ticket:agent-present' de volta APENAS para quem entrou:
        { agentId, agentName, since } — aviso, não bloqueio (soft-lock)
      - Registrar o agente atual com setAgentInTicket
      - Emitir 'ticket:viewer-joined' para a sala do ticket (para todos os outros verem)

   b) No handler de 'leave-ticket':
      - Chamar ticketPresenceService.removeAgentFromTicket
      - Emitir 'ticket:viewer-left' para a sala

   c) Adicionar novo handler 'ticket:typing' (agente está digitando resposta):
      - Chamar ticketPresenceService.refreshPresence (renova o TTL)
      - Emitir 'ticket:agent-typing' para a sala (exceto para quem emitiu)

3. Criar migration /opt/suporte-tecnico/infra/postgres/migrations/012_ticket_active_agent.sql:
   ALTER TABLE tickets ADD COLUMN IF NOT EXISTS active_agent_id UUID REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE tickets ADD COLUMN IF NOT EXISTS active_agent_since TIMESTAMPTZ;
   CREATE INDEX idx_tickets_active_agent ON tickets(tenant_id, active_agent_id) WHERE active_agent_id IS NOT NULL;

4. Adicionar TicketPresenceService ao realtime.module.ts e exportá-lo

O frontend que consome esses eventos NÃO precisa ser alterado nesta etapa — apenas emitir os novos eventos para que o frontend possa tratar quando estiver pronto.
```

---

## ETAPA 10 — Rate Limiting por Tenant (não por IP)
> **Por que:** um tenant atrás de NAT corporativo (múltiplos usuários no mesmo IP) bate no limite e bloqueia todos. Rate limit deve ser por tenant.

```
Preciso substituir o rate limiting global por IP do SempreDesk por rate limiting por tenantId usando Redis.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/app.module.ts
  - Contém: ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])
  - Rate limiting atual: 300 requests / 60 segundos por IP
- /opt/suporte-tecnico/backend/src/modules/redis/redis.module.ts
  - REDIS_CLIENT disponível como provider global

O que preciso:

1. Criar /opt/suporte-tecnico/backend/src/common/guards/tenant-throttler.guard.ts:

   Guard que estende ThrottlerGuard do @nestjs/throttler:

   - Sobrescrever o método getTracker(req: Request): string
   - Retornar tenantId do JWT se autenticado: req.user?.tenantId
   - Fallback para IP se não autenticado (login, health check)
   - Formato da chave Redis: throttle:tenant:{tenantId}

   - Sobrescrever limites por tipo de rota (usando @Throttle() metadata):
     - Rotas de webhook (WhatsApp, email inbound): 1000 req/60s por tenant
     - Rotas de API normais: 500 req/60s por tenant
     - Rotas de auth (login): 20 req/60s por IP (manter por IP para proteção brute-force)

2. Em /opt/suporte-tecnico/backend/src/app.module.ts:
   - Manter ThrottlerModule.forRoot com os limites padrão
   - Substituir o provider global APP_GUARD do ThrottlerGuard pelo novo TenantThrottlerGuard

3. Criar /opt/suporte-tecnico/backend/src/common/decorators/throttle-by-tenant.decorator.ts:
   Decorator @ThrottleByTenant(limit, ttl) para usar em controllers específicos

4. Aplicar limites diferenciados nos controllers críticos:
   - /opt/suporte-tecnico/backend/src/modules/whatsapp/whatsapp.controller.ts: @Throttle({ default: { limit: 1000, ttl: 60000 } })
   - /opt/suporte-tecnico/backend/src/modules/tickets/inbound-email.controller.ts: mesmo limite
   - /opt/suporte-tecnico/backend/src/modules/auth/auth.controller.ts: @Throttle({ default: { limit: 20, ttl: 60000 } })

5. Adicionar header 'X-RateLimit-Tenant' na resposta quando o limite for por tenant (para debug)

Manter compatibilidade: rotas sem autenticação continuam sendo limitadas por IP.
```

---

## ETAPA 11 — Índices Adicionais no Banco
> **Por que:** queries de dashboard (30 dias por tenant), histórico de mensagens e limpeza de sessões expiradas estão fazendo seq scan.

```
Preciso adicionar índices estratégicos no PostgreSQL do SempreDesk para otimizar queries de alto volume.

Schema em: /opt/suporte-tecnico/infra/postgres/init.sql
Migrations em: /opt/suporte-tecnico/infra/postgres/migrations/

Criar migration /opt/suporte-tecnico/infra/postgres/migrations/013_performance_indexes.sql com os seguintes índices:

-- 1. Queries de dashboard (últimos 30/60/90 dias por tenant)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_tenant_created
  ON tickets(tenant_id, created_at DESC);

-- 2. Histórico de mensagens em conversas (carregamento de chat)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_messages_conversation
  ON conversation_messages(conversation_id, created_at ASC);

-- 3. Limpeza de sessões de chatbot expiradas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chatbot_sessions_activity
  ON chatbot_sessions(tenant_id, last_activity)
  WHERE step NOT IN ('closed', 'rating_done');

-- 4. Busca de dispositivos por tipo e tenant (summary de devices)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_devices_tenant_type
  ON devices(tenant_id, device_type, status);

-- 5. Mensagens de ticket por período (relatórios)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_messages_created
  ON ticket_messages(tenant_id, created_at DESC);

-- 6. Tickets por cliente com paginação
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_client_created
  ON tickets(tenant_id, client_id, created_at DESC)
  WHERE status NOT IN ('closed', 'cancelled');

-- 7. Busca de contatos por telefone (lookup de WhatsApp inbound)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_phone_tenant
  ON contacts(tenant_id, phone)
  WHERE phone IS NOT NULL;

-- 8. Contratos ativos por cliente
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_active
  ON contracts(tenant_id, client_id, status, end_date)
  WHERE status = 'active';

-- 9. Métricas de dispositivos por período (gráficos de performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_metrics_period
  ON device_metrics(tenant_id, device_id, recorded_at DESC);

-- 10. Notificações não lidas por usuário
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_unread
  ON alerts(tenant_id, user_id, read, created_at DESC)
  WHERE read = false;

IMPORTANTE:
- Usar CONCURRENTLY em todos os CREATE INDEX para não travar o banco durante a migration
- Incluir IF NOT EXISTS em todos
- Adicionar seção de rollback comentada com DROP INDEX para cada um
- Adicionar ANALYZE nas tabelas após criar os índices
```

---

## ETAPA 12 — Cache do Dashboard no Redis
> **Por que:** as queries de stats do dashboard são pesadas (aggregations, COUNT, SUM) e são consultadas a cada refresh de tela por todos os agentes.

```
Preciso adicionar cache Redis nas queries de dashboard do SempreDesk para reduzir carga no banco.

Arquivos relevantes:
- /opt/suporte-tecnico/backend/src/modules/dashboard/dashboard.service.ts
  - Métodos: getSummary, getSlaReport, getTicketTrend, etc.
  - Queries de agregação por tenant (COUNT, SUM, GROUP BY)
- /opt/suporte-tecnico/backend/src/modules/redis/redis.module.ts
  - REDIS_CLIENT disponível (ioredis)

O que preciso:

1. Criar /opt/suporte-tecnico/backend/src/common/decorators/cache-result.decorator.ts:

   Decorator @CacheResult(keyPrefix: string, ttlSeconds: number) que:
   - Gera cache key: {keyPrefix}:{tenantId}:{hash dos parâmetros}
   - Antes de executar: GET no Redis → se hit, retorna o valor parseado
   - Após executar: SET no Redis com EX ttlSeconds
   - Em caso de erro no Redis: executa o método normalmente (never fail)
   - Log em debug: 'Cache HIT/MISS: {key}'

2. Criar /opt/suporte-tecnico/backend/src/common/services/cache.service.ts:
   Injectable service usado pelo decorator:
   - get<T>(key: string): Promise<T | null>
   - set(key: string, value: any, ttl: number): Promise<void>
   - invalidate(pattern: string): Promise<void>  ← usa SCAN + DEL para padrões como 'dashboard:*:tenantId'
   - Injetar REDIS_CLIENT

3. Em /opt/suporte-tecnico/backend/src/modules/dashboard/dashboard.service.ts:
   Aplicar o decorator nos métodos de leitura com TTLs adequados:

   @CacheResult('dashboard:summary', 60)       // 1 minuto
   async getSummary(tenantId: string) { ... }

   @CacheResult('dashboard:sla', 300)           // 5 minutos
   async getSlaReport(tenantId: string, ...) { ... }

   @CacheResult('dashboard:trend', 300)         // 5 minutos
   async getTicketTrend(tenantId: string, ...) { ... }

4. Em /opt/suporte-tecnico/backend/src/modules/tickets/tickets.service.ts:
   Nos métodos que alteram tickets (createTicket, updateStatus, closeTicket):
   Após a operação, invalidar o cache do tenant:
   await this.cacheService.invalidate(`dashboard:*:${tenantId}*`);

5. Registrar CacheService no app.module.ts como provider global

Nunca retornar dados de cache em operações de escrita (POST/PATCH/DELETE).
O cache deve ser transparente — se falhar, o sistema continua funcionando normalmente.
```

---

## RESUMO DAS ETAPAS

| # | Etapa | Risco que resolve | Complexidade | Prioridade |
|---|-------|-------------------|--------------|------------|
| 1 | Backup automático | Perda total de dados | Baixa | 🔴 CRÍTICA |
| 2 | Row-Level Security | Vazamento entre tenants | Média | 🔴 CRÍTICA |
| 3 | Idempotência WhatsApp | Tickets/mensagens duplicados | Baixa | 🔴 CRÍTICA |
| 4 | Counters atômicos | Contagem errada de horas | Baixa | 🟠 ALTA |
| 5 | SELECT FOR UPDATE | Atribuição duplicada | Baixa | 🟠 ALTA |
| 6 | Distributed lock | Schedulers duplicados | Média | 🟠 ALTA |
| 7 | Redis Adapter Socket.io | Escala horizontal bloqueada | Média | 🟠 ALTA |
| 8 | Emails via RabbitMQ | Event loop travando | Alta | 🟠 ALTA |
| 9 | Ticket ownership lock | Dois agentes no mesmo ticket | Média | 🟡 MÉDIA |
| 10 | Rate limit por tenant | Bloqueio de usuários por NAT | Baixa | 🟡 MÉDIA |
| 11 | Índices adicionais | Degradação de queries | Baixa | 🟡 MÉDIA |
| 12 | Cache de dashboard | Sobrecarga de banco | Média | 🟡 MÉDIA |

**Ordem recomendada para subir na VPS:**
Etapa 1 → Etapa 2 → Etapa 3+4 (juntas, são pequenas) → Etapa 5+6 (juntas) → Etapa 7 → Etapa 8 → Etapas 9-12 (uma por sprint)
