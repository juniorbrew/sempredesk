# Sistema de Suporte Técnico — SaaS

Sistema completo de suporte técnico para empresas de automação comercial.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | NestJS 10, TypeORM, PostgreSQL 15 |
| Frontend | Next.js 14, React 18, TailwindCSS |
| Cache | Redis 7 |
| Filas | RabbitMQ 3.13 |
| Proxy | Nginx Alpine |
| Container | Docker + Docker Compose |

## Módulos do Backend

- **Auth** — JWT (access 15m + refresh 7d), RBAC, roles, login portal
- **Tenants** — Multi-tenancy, planos (starter/professional/enterprise)
- **Customers** — Clientes (CNPJ, endereço) + Contatos do portal
- **Contracts** — Contratos com SLA, banco de horas, vencimento automático
- **Tickets** — Ciclo completo: abertura → atribuição → resolução, SLA, WhatsApp, email inbound
- **TicketSettings** — Departamentos, categorias, subcategorias, prioridades
- **Devices** — Monitoramento de PDVs via heartbeat, detecção offline automática (cron 2min)
- **Team** — Gestão de técnicos
- **TeamChat** — Chat entre equipe em tempo real
- **Knowledge** — Base de conhecimento com categorias e busca full-text
- **Networks** — Redes/filiais vinculadas a clientes
- **Alerts** — Canal de notificações (email, WhatsApp, push) extensível
- **Dashboard** — Métricas, tendências, relatório SLA
- **Attendance** — Atendimento unificado (inbox chat)
- **Conversations** — Conversas em tempo real (portal + WhatsApp)
- **WhatsApp** — Integração WhatsApp Business API
- **Email** — Webhooks de email inbound (Mailgun/SendGrid)
- **Realtime** — WebSockets (Socket.io)
- **Monitoring** — Métricas de uso por tenant
- **Settings** — Configurações gerais por tenant
- **RoutingRules** — Regras de roteamento de tickets
- **Webhooks** — Webhooks externos
- **ApiKeys** — Chaves de API para integrações

## Como iniciar

### Pré-requisitos
- Docker 24+
- Docker Compose v2

### 1. Subir infraestrutura

```bash
cd suporte-tecnico
docker compose up -d postgres redis rabbitmq
```

### 2. Instalar e rodar backend (dev)

```bash
cd backend
npm install
npm run start:dev
```

Backend: http://localhost:4000  
Swagger: http://localhost:4000/api/docs

### 3. Instalar e rodar frontend (dev)

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

### 4. Subir tudo via Docker Compose

```bash
docker compose up --build
```

### 5. Configurar HTTPS (Let's Encrypt)

Para remover o aviso "Este site não tem um certificado" e habilitar conexão segura:

**Pré-requisitos:** DNS de `suporte.sempredesk.com.br` e `cliente.sempredesk.com.br` apontando para o IP do servidor.

```bash
export SSL_EMAIL=seu@email.com
./scripts/init-ssl.sh
```

O script obtém os certificados e ativa HTTPS. Depois, configure renovação automática via cron (semanal):

```bash
# Editar crontab: crontab -e
0 3 * * 0 /opt/suporte-tecnico/scripts/renew-ssl.sh >> /var/log/certbot-renew.log 2>&1
```

**Nota:** Acesso por IP continua em HTTP (Let's Encrypt não emite certificado para IP). Use os domínios para HTTPS.

## Credenciais demo

| Usuário | Senha |
|---------|-------|
| admin@demo.com | Admin@123 |
| super@sistema.com | Admin@123 |

## Variáveis de ambiente

Copiar `backend/.env.example` para `backend/.env` e ajustar conforme necessário. Principais variáveis:

- `ALLOWED_ORIGINS` — origens permitidas no CORS (separar por vírgula)
- `INBOUND_EMAIL_SECRET` — (opcional) secreto para validar webhooks de e-mail inbound

## Estrutura de diretórios

```
suporte-tecnico/
├── backend/              # NestJS API
│   ├── src/
│   │   ├── modules/      # 24+ módulos
│   │   └── common/       # guards, filters, interceptors
│   └── Dockerfile
├── frontend/             # Next.js 14
│   ├── src/
│   │   ├── app/          # App Router pages
│   │   ├── components/   # UI components
│   │   ├── lib/          # API client
│   │   └── store/        # Zustand stores
│   └── Dockerfile
├── infra/
│   ├── postgres/         # init.sql com schema + seed
│   └── nginx/            # nginx.conf
└── docker-compose.yml
```

## API Endpoints principais

```
POST   /api/v1/auth/login
GET    /api/v1/auth/me

GET    /api/v1/tickets
POST   /api/v1/tickets
PUT    /api/v1/tickets/:id
POST   /api/v1/tickets/:id/assign
POST   /api/v1/tickets/:id/escalate
GET    /api/v1/tickets/:id/messages
POST   /api/v1/tickets/:id/messages

GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/:id/contacts

GET    /api/v1/devices
GET    /api/v1/devices/summary
POST   /api/v1/devices/:id/heartbeat   (token via x-device-token header)

GET    /api/v1/dashboard/summary
GET    /api/v1/dashboard/ticket-trend
GET    /api/v1/dashboard/sla-report
```

## Tarefas Agendadas (Cron)

| Cron | Módulo | Ação |
|------|--------|------|
| */2 min | Devices | Detecta dispositivos offline (>5min sem heartbeat) |
| */5 min | Tickets | Escala tickets com SLA violado |
| * /hora | Tickets | Fecha tickets resolvidos há >48h |
| Diário 8h | Contracts | Expira contratos vencidos |

## Documentação

- `docs/plano-atendimento-chat.md` — Plano de implementação do atendimento unificado (inbox chat)

## Status do Projeto

- Backend e Frontend compilando corretamente
- Multi-tenant com isolamento RLS no PostgreSQL
- Portal do cliente com login, tickets e contratos
- Dashboard admin com todas as telas principais
- Atendimento (`/dashboard/atendimento`) disponível
