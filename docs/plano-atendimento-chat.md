# Plano de Implementação: Atendimento / Chat Unificado

## Visão geral

Criar um menu **Atendimento** no painel admin onde o suporte visualize e responda conversas em tempo real vindas de:
- **WhatsApp** (já integrado)
- **Portal** (chat existente no portal do cliente)

---

## Estado atual

### O que já existe

| Componente | Status | Detalhes |
|------------|--------|----------|
| WhatsApp webhook | ✅ | Recebe mensagens, cria/associa ticket, grava com `channel: 'whatsapp'` |
| Resposta via painel para WhatsApp | ✅ | `POST /webhooks/whatsapp/send-from-ticket` envia e grava com `channel: 'whatsapp'` |
| Portal: criar ticket | ✅ | Formulário em `/portal/dashboard/tickets/new` |
| Portal: ver ticket + responder | ✅ | `/portal/dashboard/tickets/[id]` – thread de mensagens + formulário de resposta |
| Tela de ticket no painel | ✅ | `/dashboard/tickets/[id]` – já suporta WhatsApp e resposta geral |
| Ticket origins | ✅ | `portal`, `whatsapp`, `email`, `phone`, `internal` |
| Message channel | ✅ | `whatsapp` e `portal` definidos; portal envia `channel: 'portal'` no body |

### O que falta

- ~~Marcar mensagens do portal com `channel: 'portal'`~~ ✅ Feito
- ~~Menu Atendimento com layout inbox~~ ✅ Feito
- ~~API para listar conversas ativas (filtro por canal)~~ ✅ Feito (GET /tickets/conversations para tickets portal)
- ~~Polling 10s para atualização da lista~~ ✅ Feito
- Experiência de chat em tempo quase real (parcial: WebSocket para ticket + conversation)

---

## Fases de implementação

### Fase 1: Marcar canal nas mensagens (Backend)

**Objetivo:** Garantir que toda mensagem tenha o canal identificado.

1. **TicketsController** – ao receber `POST :id/messages`:
   - Se `req.user?.isPortal === true` → passar `channel: 'portal'` no dto
   - Caso contrário → não alterar (continua sem channel ou com o que o cliente enviar)

2. **Portal frontend** – ao enviar mensagem:
   - Incluir `channel: 'portal'` no body (opcional; o backend pode inferir do JWT)

3. **Resultado:** Mensagens do portal com `channel: 'portal'`, WhatsApp com `channel: 'whatsapp'`.

---

### Fase 2: API de conversas ativas (Backend)

**Objetivo:** Endpoint específico para o módulo de atendimento.

1. **Novo endpoint:** `GET /tickets/conversations` ou `GET /atendimento/conversations`

   **Query params:**
   - `status` – `open`, `in_progress`, `waiting_client` (default: ativos)
   - `origin` – `portal`, `whatsapp` (opcional)
   - `assignedTo` – filtrar por técnico (opcional)
   - `perPage`, `page`

   **Resposta:**
   - Lista de tickets com:
     - `id`, `ticketNumber`, `subject`, `status`, `origin`, `priority`
     - `clientId`, `contactId`, `assignedTo`
     - `lastMessageAt` – data da última mensagem
     - `lastMessagePreview` – trecho da última mensagem
     - `unreadCount` (opcional) – para futuro

2. **Estratégia:** Reaproveitar `findAll` com filtros ou criar método dedicado no `TicketsService`.

---

### Fase 3: Menu Atendimento + layout inbox (Frontend)

**Objetivo:** Tela de atendimento estilo inbox com lista de conversas e chat ao lado.

1. **Sidebar** – adicionar item de menu:
   - Ícone: `MessageCircle` ou `Headphones`
   - Label: **Atendimento**
   - href: `/dashboard/atendimento`

2. **Página:** `frontend/src/app/dashboard/atendimento/page.tsx`

   **Layout (duas colunas):**

   ```
   ┌─────────────────┬──────────────────────────────────────────┐
   │  CONVERSAS      │  CHAT                                     │
   │  ─────────────  │  ──────────────────────────────────────── │
   │  [Filtro: Todos]│  [Header: Ticket #123 | Cliente | canal]  │
   │  [Portal] [WA]  │  ─────────────────────────────────────── │
   │                 │  [Thread de mensagens com scroll]          │
   │  • Ticket #001  │  - Cliente: Olá...                        │
   │    Portal · 2m  │  - Equipe: Olá, em que posso ajudar?       │
   │  • Ticket #002  │  - Cliente: ...                            │
   │    WhatsApp · 5m│  ──────────────────────────────────────── │
   │  • Ticket #003  │  [Campo de resposta + Enviar]              │
   │    Portal · 1h  │  [WhatsApp] ou [Resposta normal] conforme   │
   │                 │  origin do ticket                          │
   └─────────────────┴──────────────────────────────────────────┘
   ```

3. **Lista de conversas:**
   - Chamar `GET /tickets/conversations` (ou equivalente)
   - Exibir tickets ativos ordenados por última mensagem
   - Badge por canal: Portal / WhatsApp
   - Ao clicar, carregar chat na coluna da direita

4. **Área de chat:**
   - Mesma lógica da tela atual de ticket
   - Se `origin === 'whatsapp'` → usar `sendWhatsappFromTicket`
   - Caso contrário → `addMessage`

---

### Fase 4: Tempo quase real (Opcional)

**Objetivo:** Atualizar lista e chat sem recarregar manual.

**Opção A – Polling**
- `useEffect` com `setInterval` (ex.: 10–15s) para recarregar conversas e mensagens
- Implementação simples, sem infraestrutura extra

**Opção B – WebSockets**
- `@nestjs/websockets` (Socket.io) no backend
- Eventos: `new_message`, `ticket_updated`
- Emitir para salas por tenant
- Frontend inscreve e atualiza estado
- Mais complexo, mas experiência mais fluida

**Recomendação inicial:** Começar com **polling** (5–10s). Migrar para WebSockets se for crítico.

---

## Estrutura de arquivos sugerida

```
backend/src/modules/
├── tickets/
│   ├── tickets.controller.ts   # Ajustar addMessage para channel portal
│   ├── tickets.service.ts      # Método getConversations ou ampliar findAll
│   └── ...
└── atendimento/                 # (opcional) módulo separado
    ├── atendimento.controller.ts
    ├── atendimento.service.ts
    └── atendimento.module.ts

frontend/src/
├── app/dashboard/atendimento/
│   ├── page.tsx                # Layout inbox + chat
│   └── layout.tsx              # (opcional)
├── components/atendimento/
│   ├── ConversationList.tsx   # Lista de conversas
│   ├── ChatPanel.tsx           # Área de mensagens + input
│   └── MessageBubble.tsx       # Bolha de mensagem (reutilizável)
└── lib/api.ts                  # getConversations, etc.
```

---

## Ordem sugerida de execução

| # | Tarefa | Complexidade | Status |
|---|--------|--------------|--------|
| 1 | Marcar `channel: 'portal'` nas mensagens do portal | Baixa | ✅ Feito |
| 2 | API `GET /tickets` com filtros para atendimento (active, origin) | Baixa | ✅ Feito |
| 3 | Menu Atendimento no Sidebar | Baixa | ✅ Feito |
| 4 | Página `/dashboard/atendimento` com layout inbox | Média | ✅ Feito |
| 5 | Integrar lista de conversas + chat | Média | ✅ Feito |
| 6 | Polling para atualização automática (10s) | Baixa | ✅ Feito |
| 7 | (Opcional) WebSockets | Alta | Pendente (useRealtimeTicket + useRealtimeConversation já em uso) |

---

## Observações

1. **Ticket como unidade:** Cada conversa é um ticket. WhatsApp e portal já criam tickets; não é necessário novo modelo.
2. **Permissões:** Usar os mesmos guards do painel (JwtAuthGuard + tenant).
3. **Mobile:** Layout responsivo – em telas pequenas, lista e chat podem ser fullscreen alternados.
4. **Notificações:** Badge de “novas mensagens” no menu pode ser adicionada em iteração futura.
