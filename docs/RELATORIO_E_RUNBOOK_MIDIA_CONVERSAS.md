# Relatório e runbook — mídia em conversas (imagem / áudio)

Documento único: histórico do que foi implementado/corrigido, limites, commits e procedimento de deploy na VPS.  
**Fluxo do projeto:** LOCAL → GitHub → VPS.

---

## 1. Escopo

- **Incluído:** envio e recebimento de **imagem** e **áudio** no contexto de **conversas** (portal, WhatsApp no painel, ticket vinculado), com persistência, API, UI e realtime, respeitando **tenant** e **`conversationId`**.
- **Não incluído como produto pronto:** **vídeo** — os inputs usam `accept="image/*,audio/*"` e o backend valida apenas `image/` e `audio/`. Vídeo exigiria escopo à parte (MIME, limites, player, WhatsApp).

---

## 2. Backend (visão técnica)

- **Tabela `conversation_messages`:** colunas `media_kind`, `media_storage_key`, `media_mime` (nullable).
- **Migração SQL (produção com `DB_SYNCHRONIZE=false`):**  
  `infra/postgres/migration_conversation_message_media.sql`
- **Armazenamento de ficheiros:** variável `CONVERSATION_MEDIA_DIR` + volume no `docker-compose.yml`.
- **WhatsApp (Baileys):** tratamento de `imageMessage` / `audioMessage`, download e envio de mídia.
- **Endpoints relevantes:**
  - `POST /api/v1/conversations/:id/messages` — JSON ou **multipart** com campo `file` + `content` opcional.
  - `GET /api/v1/conversations/messages/:messageId/media` — stream do ficheiro (autenticado).
- **Limites:** Multer no controller — **16 MB** por ficheiro (`FileInterceptor` + `limits.fileSize`).

### 2.1. Anexos na resposta pública do ticket (sem `conversationId`)

- **Tabela:** `ticket_reply_attachments` (migração `014_ticket_reply_attachments.sql`).
- **Armazenamento:** `TICKET_REPLY_MEDIA_DIR` (default `uploads/ticket-reply-media`) + volume `ticket_reply_media` no `docker-compose.yml`.
- **Endpoints:**
  - `POST /api/v1/tickets/:id/messages/attachment` — multipart, campo `file` + `content` opcional; **não** aceita `audio/*` nem `video/*` (documentos e imagens).
  - `GET /api/v1/tickets/:id/reply-attachments/:attachmentId/media` — stream do ficheiro (JWT + `ticket.view`; portal: mesmo critério que `GET /tickets/:id`).
- **Mensagem:** `TicketMessage` tipo `COMMENT` com `attachments` JSONB (`kind: ticket_reply_file`). Realtime: `ticket:message` + `notification:ticket-message` (igual à mensagem JSON).

---

## 3. Frontend

- **`frontend/src/lib/api.ts`:** `addConversationMessage` (JSON ou `FormData`), `getConversationMessageMediaBlob`.
- **Onde aparece envio/visualização:** atendimento, detalhe de ticket (com `conversationId`), portal ticket, `ChatWidget`.
- **Regras de UI úteis:**
  - Na ficha do ticket (`/dashboard/tickets/[id]`): anexo no **clipe** apenas na aba **«Resposta pública»** e com **`conversationId`** no ticket.
  - No **atendimento:** botão da toolbar **«Imagem / áudio»**; conversa **fechada** esconde o input.

---

## 4. Correção — atendimento + inbox tipo ticket

**Problema:** com item do inbox no formato **ticket** (ex.: id `ticket:...`) e envio **com ficheiro**, o alvo da API era montado incorretamente (`convTarget` nulo em alguns casos), gerando falha de envio.

**Solução:** usar sempre o **UUID da conversa** para `POST /conversations/:id/messages`:

- conversa “normal”: `selected.id`
- linha ticket no inbox: `currentTicket?.conversationId ?? selected?.conversationId`

**Commit:** `c765cd3` — *fix(atendimento): enviar mídia usa conversationId quando inbox é ticket*

---

## 5. Realtime e sino (painel)

- **Sala do ticket:** evento **`ticket:message`** (antes era `message` genérico).
- **Sala da conversa:** evento **`conversation:message`**.
- **Notificação para agentes (sala tenant):** **`notification:ticket-message`** — evita confundir com o evento da sala do ticket e não duplicar lógica no mesmo listener.
- **Socket:** `PresenceProvider` e `NotificationBell` passam a usar **`getSharedRealtimeSocket()`** (singleton); **não** desligar o socket global no cleanup do provider.
- **Spam do sino** ao copiar mensagens no fecho da conversa: flag interna **`skipInAppBell`** só no **service**; **não** exposta no DTO público; controller remove do body se enviada.

**Commit:** `8061742` — *fix(realtime): separar eventos ticket/conversation e alinhar sino por tenant*

---

## 6. Nginx — erro 413 (Payload Too Large)

- **Causa:** limite padrão do nginx (~**1 MB**) para corpo da requisição; uploads multipart de imagem/áudio ultrapassam com facilidade.
- **Correção:** `client_max_body_size 32m` no bloco `http { }` dos ficheiros:
  - `infra/nginx/nginx.conf`
  - `infra/nginx/nginx-ssl.conf`
  - `infra/nginx/nginx-http-only.conf`

**Commit:** `ab544a2` — *fix(nginx): permitir upload de mídia até 32MB (evita 413 no /api)*

**Na VPS:** após `git pull`, apenas  
`docker compose restart nginx`  
(basta se o `nginx.conf` for montado como volume).

---

## 7. PostgreSQL na VPS — erro 500 (`column m.media_kind does not extract`)

- **Sintoma:** `GET .../conversations/:id/messages` retorna **500** com `column m.media_kind does not exist` (ou equivalente).
- **Causa:** código TypeORM já mapeia colunas de mídia, mas a base **não** tinha (ou ainda não tinha sido migrada) as colunas em `conversation_messages`.
- **Correção:** executar o SQL na base usada pelo backend:

```bash
cd /opt/suporte-tecnico
docker compose exec -T postgres psql -U suporte -d suporte_tecnico < infra/postgres/migration_conversation_message_media.sql
docker compose restart backend
```

- **Verificação:**

```bash
docker compose exec postgres psql -U suporte -d suporte_tecnico -c "\d conversation_messages"
```

Deve listar `media_kind`, `media_storage_key`, `media_mime`.

---

## 8. Runbook de deploy manual (VPS — `/opt/suporte-tecnico`)

Depois de **push** no GitHub para `main`:

```bash
cd /opt/suporte-tecnico
git pull origin main
docker compose build --no-cache backend frontend
docker compose up -d backend frontend
docker compose restart nginx
docker compose ps
```

**Se só mudou `infra/nginx/*.conf`:**

```bash
cd /opt/suporte-tecnico && git pull origin main && docker compose restart nginx
```

**Após primeira habilitação de mídia ou erro 500 em mensagens:** executar o bloco **§7** (migração SQL + restart backend).

**Smoke sugerido**

1. Painel carrega sem **502**.
2. Abrir conversa — histórico **GET** `/messages` sem **500**.
3. Enviar **imagem** e **áudio** (≤ **16 MB** por ficheiro no backend).
4. Confirmar que **413** não ocorre (nginx com `client_max_body_size` atualizado).

---

## 9. Limites e coerência

| Camada        | Limite prático                          |
|---------------|-----------------------------------------|
| Nest (Multer) | **16 MB** por ficheiro                  |
| Nginx         | **32 MB** (`client_max_body_size`)      |
| Tipos         | **image/\*, audio/\*** (não vídeo)      |

Se no futuro subir o limite do Multer, alinhar nginx (e disco/volume).

---

## 10. Commits Git (referência)

| Hash     | Descrição resumida |
|----------|--------------------|
| `8061742` | Realtime: `ticket:message` / `conversation:message`, sino `notification:ticket-message`, socket compartilhado, `skipInAppBell` interno |
| `c765cd3` | Atendimento: mídia usa `conversationId` quando inbox é ticket |
| `ab544a2` | Nginx: `client_max_body_size 32m` |

*(Hashes conforme histórico do repositório no momento da escrita; conferir com `git log`.)*

---

## 11. Regras de negócio (multi-empresa)

- Não misturar dados entre empresas: **`tenantId`** em todas as operações de conversa/mensagem.
- **`conversationId`** é a referência correta para APIs de mensagem com mídia; ticket não substitui o UUID da conversa no `POST` multipart.

---

## 12. Próximos passos opcionais

- Suporte a **vídeo** (definir formatos, limites, UI, compatibilidade WhatsApp).
- Incluir este runbook em checklist de release ou em `DEPLOY.md` como link.
- Opcional: pipeline CI que valide presença das colunas ou rode migrações controladas.

---

*Última atualização do conteúdo: consolidado a partir da implementação de mídia, correções de realtime/nginx/atendimento e troubleshooting na VPS (migração DB + 413).*
