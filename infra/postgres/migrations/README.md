# Migrações do Banco de Dados

Migrações manuais aplicadas após o `init.sql`. Executar **na ordem** se for setup novo.

## Ordem de execução

1. `001_renumber_tickets_to_hash_format.sql` — renumerar tickets
2. `002_ticket_settings_color.sql` — cores em ticket_settings
3. `003_device_metrics_history.sql` — histórico de métricas de dispositivos
4. `004_users_role_varchar.sql` — role como varchar em users
5. `005_chatbot_tables.sql` — tabelas do chatbot
6. `006_ticket_assignment.sql` — distribuição de tickets
7. `007_agent_presence.sql` — presença de agentes
8. `008_contact_customers.sql` — pivot contato-cliente
9. `009_bot_evaluation_columns.sql` — mensagens pós-ticket e avaliação
10. `010_conversation_messages_external_id_unique.sql` — idempotência inbound WhatsApp (`tenant_id` + `external_id`)

## 001_renumber_tickets_to_hash_format.sql

Renumera todos os tickets existentes para o formato **#000001**, em ordem cronológica.

### Como executar

```bash
psql -h localhost -U postgres -d suporte_tecnico -f infra/postgres/migrations/001_renumber_tickets_to_hash_format.sql
```

### O que faz

1. Atribui valores temporários aos números atuais (evita conflito de UNIQUE)
2. Atribui #000001 ao ticket mais antigo, #000002 ao seguinte, e assim sucessivamente

Novos tickets continuarão a sequência automaticamente (ex.: se existem 50 tickets, o próximo será #000051).

---

## 002_ticket_settings_color.sql

Adiciona coluna `color` na tabela `ticket_settings` (cores dos departamentos no widget).

### Como executar

```bash
psql -h localhost -U postgres -d suporte_tecnico -f infra/postgres/migrations/002_ticket_settings_color.sql
```

### O que faz

```sql
ALTER TABLE ticket_settings ADD COLUMN IF NOT EXISTS color VARCHAR(20);
```

---

## 009_bot_evaluation_columns.sql

Colunas das Etapas 2B e 2C do bot de atendimento: mensagens pós-ticket e avaliação.

### Como executar

```bash
docker cp infra/postgres/migrations/009_bot_evaluation_columns.sql <container>:/tmp/009.sql
docker exec <container> psql -U suporte suporte_tecnico -f /tmp/009.sql
```

### O que faz

| Tabela | Coluna | Tipo | Descrição |
|---|---|---|---|
| `chatbot_configs` | `post_ticket_message` | TEXT | Template pós-ticket com agente |
| `chatbot_configs` | `post_ticket_message_no_agent` | TEXT | Template pós-ticket sem agente |
| `chatbot_configs` | `rating_request_message` | TEXT | Solicitação de nota 1–5 |
| `chatbot_configs` | `rating_comment_message` | TEXT | Pedido de comentário opcional |
| `chatbot_configs` | `rating_thanks_message` | TEXT | Agradecimento final |
| `tickets` | `satisfaction_rating` | INTEGER | Nota 1–5 do cliente |
| `tickets` | `satisfaction_comment` | TEXT | Comentário opcional |

Também cria `CHECK CONSTRAINT` `tickets_satisfaction_rating_range` (rating NULL ou 1–5)
e índice `chatbot_sessions_lookup_idx` que estava ausente no banco.

**Idempotente:** pode ser executado mais de uma vez sem erro.

---

## 010_conversation_messages_external_id_unique.sql

Índice único parcial `(tenant_id, external_id)` para evitar mensagens duplicadas quando o provedor reenvia o mesmo `messageId`.

**Antes de aplicar em banco com dados:** conferir duplicatas:

```sql
SELECT tenant_id, external_id, COUNT(*) FROM conversation_messages
WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
GROUP BY 1,2 HAVING COUNT(*) > 1;
```

**Executar:**

```bash
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -f /path/to/010_conversation_messages_external_id_unique.sql
```
