# Migrações do Banco de Dados

Migrações manuais aplicadas após o `init.sql`. Executar **na ordem** se for setup novo.

## Ordem de execução

1. `001_renumber_tickets_to_hash_format.sql` — renumerar tickets
2. `002_ticket_settings_color.sql` — cores em ticket_settings

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
