#!/usr/bin/env bash
set -u

ROOT="/opt/suporte-tecnico/backend/src"
OUT="/opt/suporte-tecnico/audits/multitenant-audit-$(date +%Y%m%d-%H%M%S).txt"

echo "AUDITORIA MULTI-TENANT" > "$OUT"
echo "Gerado em: $(date)" >> "$OUT"
echo "Raiz: $ROOT" >> "$OUT"
echo "==================================================" >> "$OUT"
echo >> "$OUT"

section () {
  echo >> "$OUT"
  echo "==================================================" >> "$OUT"
  echo "$1" >> "$OUT"
  echo "==================================================" >> "$OUT"
}

append_matches () {
  local title="$1"
  local pattern="$2"
  section "$title"
  grep -RInE --include="*.ts" "$pattern" "$ROOT" >> "$OUT" || echo "Nenhum resultado" >> "$OUT"
}

append_matches_excluding () {
  local title="$1"
  local pattern="$2"
  shift 2
  local exclude_args=()
  for item in "$@"; do
    exclude_args+=(--exclude-dir="$item")
  done

  section "$title"
  grep -RInE "${exclude_args[@]}" --include="*.ts" "$pattern" "$ROOT" >> "$OUT" || echo "Nenhum resultado" >> "$OUT"
}

section "1. findOne/findUnique/query por id sem tenant aparente"
grep -RIn --include="*.ts" -E "findOne\(|findOneBy\(|findByIds\(|find\(|count\(|exist\(|exists\(|update\(|delete\(|softDelete\(|restore\(" "$ROOT" | \
grep -vi "tenantId\|tenant_id" >> "$OUT" || echo "Nenhum resultado" >> "$OUT"

section "2. QueryBuilder com where sem tenant aparente"
grep -RIn --include="*.ts" -E "createQueryBuilder\(" "$ROOT" >> /tmp/.mt_qb_$$ || true
while IFS= read -r line; do
  file="$(echo "$line" | cut -d: -f1)"
  ln="$(echo "$line" | cut -d: -f2)"
  start="$ln"
  end=$((ln+25))
  chunk="$(sed -n "${start},${end}p" "$file")"
  echo "----- $file:$ln -----" >> "$OUT"
  echo "$chunk" | grep -qiE "tenantId|tenant_id" || echo "$chunk" >> "$OUT"
done < /tmp/.mt_qb_$$
rm -f /tmp/.mt_qb_$$

append_matches "3. manager.query/raw SQL" "manager\.query\(|queryRunner\.query\(|\.query\("

append_matches "4. controllers usando @Body com possíveis campos sensíveis" "@Body\("

append_matches "5. uso direto de tenantId no request" "req\.tenantId|request\.tenantId"

append_matches "6. métodos create salvando dto inteiro" "create\(\{[[:space:]]*\.\.\.[a-zA-Z0-9_]+|save\([[:space:]]*[a-zA-Z0-9_]+Repo\.create\(\{[[:space:]]*\.\.\."

append_matches "7. relações potencialmente cruzadas por clientId/customerId/networkId/contractId/categoryId/assignedTo" "clientId|customerId|networkId|contractId|categoryId|assignedTo|userId"

append_matches "8. Redis/cache sem prefixo tenant" "redis|cache|set\(|get\(|del\(|hset\(|hget\(|publish\(|subscribe\("

append_matches "9. RabbitMQ/filas/eventos" "rabbit|amqp|queue|publish|consume|emit|onModuleInit"

append_matches "10. guards/strategies/auth" "JwtAuthGuard|PassportStrategy|tenantId|tenant_id"

append_matches "11. cron jobs sem tenant explícito" "@Cron\("

append_matches "12. includes/relations que podem trazer dados sem scoping" "relations:|leftJoinAndSelect|innerJoinAndSelect"

append_matches "13. updates/deletes por id sem tenant explícito na mesma linha" "update\(\{[[:space:]]*id:|delete\(\{[[:space:]]*id:|softDelete\(\{[[:space:]]*id:"

append_matches "14. searches com ILIKE/contains sem tenant aparente" "ILIKE|LIKE|contains:"

append_matches "15. possíveis DTOs com tenantId/tenant_id" "tenantId|tenant_id"

section "16. resumo dos arquivos mais suspeitos"
grep -RIn --include="*.ts" -E "manager\.query\(|queryRunner\.query\(|createQueryBuilder\(|update\(\{[[:space:]]*id:|delete\(\{[[:space:]]*id:|findOne\(|findOneBy\(" "$ROOT" | \
awk -F: '{print $1}' | sort | uniq -c | sort -nr >> "$OUT" || echo "Nenhum resultado" >> "$OUT"

section "17. módulos principais"
for mod in customers knowledge tickets contracts auth networks devices users dashboard reports; do
  echo "--- $mod ---" >> "$OUT"
  find "$ROOT/modules" -type f 2>/dev/null | grep "/$mod/" >> "$OUT" || echo "não encontrado" >> "$OUT"
done

echo >> "$OUT"
echo "AUDITORIA FINALIZADA: $OUT"
cat "$OUT"
