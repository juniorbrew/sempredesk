#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# Import clientes da API TecnoExpresss → SempreDesk
# Uso: ./scripts/import-clients-tecno.sh [--limpar]
#
# Com --limpar: apaga clientes/contatos/redes existentes antes de importar
# Sem --limpar: apenas importa (pode gerar duplicatas se já existir dados)
# ════════════════════════════════════════════════════════════════════════════
set -e

TENANT='00000000-0000-0000-0000-000000000001'
API_URL='https://tecnoexpresss.ddns.net:7090/api/integracao/clientestecno'
DB_CMD='docker exec suporte_postgres psql -U suporte -d suporte_tecnico'

if [ "$1" = "--limpar" ]; then
  echo "⚠️  Limpando dados existentes..."
  $DB_CMD -c "
    DELETE FROM conversation_messages WHERE tenant_id='$TENANT';
    DELETE FROM conversations       WHERE tenant_id='$TENANT';
    DELETE FROM tickets             WHERE tenant_id='$TENANT';
    DELETE FROM contacts            WHERE tenant_id='$TENANT';
    DELETE FROM clients             WHERE tenant_id='$TENANT';
    DELETE FROM networks            WHERE tenant_id='$TENANT';
    SELECT 'Limpeza concluída' AS status;
  "
fi

echo "📡 Buscando dados da API..."
DATA=$(curl -sk "$API_URL")
TOTAL=$(echo "$DATA" | jq 'length')
echo "📦 Total de registros: $TOTAL"

# ── 1. Criar redes ────────────────────────────────────────────────────────
echo "🔗 Criando redes/grupos..."
GRUPOS=$(echo "$DATA" | jq -r '[.[].grupo | select(. != null and . != "")] | unique | .[]')

declare -A NETWORK_IDS
while IFS= read -r grupo; do
  NET_ID=$(cat /proc/sys/kernel/random/uuid)
  NETWORK_IDS["$grupo"]="$NET_ID"
  NOME_ESC="${grupo//\'/\'\'}"
  echo "INSERT INTO networks (id, tenant_id, name, status) VALUES ('$NET_ID', '$TENANT', '$NOME_ESC', 'active');" \
    | $DB_CMD -q
done <<< "$GRUPOS"
echo "✅ Redes criadas: ${#NETWORK_IDS[@]}"

# ── 2. Importar clientes e contatos ───────────────────────────────────────
echo "👥 Importando clientes e contatos..."

CLIENTS_SQL=""; CONTACTS_SQL=""; COUNT=0; TOTAL_CONTACTS=0

flush() {
  [ -n "$CLIENTS_SQL"  ] && echo "$CLIENTS_SQL"  | $DB_CMD -q 2>&1
  [ -n "$CONTACTS_SQL" ] && echo "$CONTACTS_SQL" | $DB_CMD -q 2>&1
  CLIENTS_SQL=""; CONTACTS_SQL=""
}

while IFS= read -r row; do
  codigo=$(echo "$row"   | jq -r '.codigo // ""')
  grupo=$(echo "$row"    | jq -r '.grupo // ""')
  cnpj=$(echo "$row"     | jq -r '.cnpj // ""' | cut -c1-18 | sed "s/'/''/g")
  ie=$(echo "$row"       | jq -r '.ie // ""' | cut -c1-49 | sed "s/'/''/g")
  nome=$(echo "$row"     | jq -r '.nome // ""' | cut -c1-199 | sed "s/'/''/g")
  fantasia=$(echo "$row" | jq -r '.fantasia // ""' | cut -c1-199 | sed "s/'/''/g")
  cep=$(echo "$row"      | jq -r '.cep // ""' | cut -c1-9)
  bairro=$(echo "$row"   | jq -r '.bairro // ""' | cut -c1-99 | sed "s/'/''/g")
  compl=$(echo "$row"    | jq -r '.complemento // ""' | cut -c1-99 | sed "s/'/''/g")
  logra=$(echo "$row"    | jq -r '.logradouro // ""' | cut -c1-299 | sed "s/'/''/g")
  numero=$(echo "$row"   | jq -r '.numero // ""' | cut -c1-19 | sed "s/'/''/g")
  cidade=$(echo "$row"   | jq -r '.cidade // ""' | cut -c1-99 | sed "s/'/''/g")
  uf=$(echo "$row"       | jq -r '.uf // ""' | cut -c1-2)
  inadim=$(echo "$row"   | jq -r '.inadimplente // false')

  status="active"; [ "$inadim" = "true" ] && status="inactive"

  net_sql="NULL"
  if [ -n "$grupo" ] && [ -n "${NETWORK_IDS[$grupo]+x}" ]; then
    net_sql="'${NETWORK_IDS[$grupo]}'"
  fi

  first_phone=$(echo "$row" | jq -r '(.telefones // []) | if length > 0 then .[0] | (.ddd + .numero) | gsub("[^0-9]"; "") else "" end')
  first_email=$(echo "$row" | jq -r '(.emails // []) | if length > 0 then .[0].email else "" end' | cut -c1-199 | sed "s/'/''/g")
  ie_sql="NULL"; [ -n "$ie" ] && ie_sql="'$ie'"
  phone_sql="NULL"; [ -n "$first_phone" ] && phone_sql="'${first_phone:0:19}'"
  email_sql="NULL"; [ -n "$first_email" ] && email_sql="'$first_email'"
  wa_sql="NULL"; [ ${#first_phone} -ge 11 ] && wa_sql="'${first_phone:0:19}'"

  CLIENT_ID=$(cat /proc/sys/kernel/random/uuid)
  code_val="${codigo:0:6}"

  CLIENTS_SQL+="INSERT INTO clients (id,tenant_id,code,network_id,company_name,trade_name,cnpj,ie,address,number,complement,neighborhood,city,state,zip_code,phone,whatsapp,email,status,metadata,created_at,updated_at) VALUES ('$CLIENT_ID','$TENANT','$code_val',${net_sql},'$nome','$fantasia','$cnpj',${ie_sql},'$logra','$numero','$compl','$bairro','$cidade','$uf','$cep',${phone_sql},${wa_sql},${email_sql},'$status','{\"externalCode\": $codigo}',NOW(),NOW());"$'\n'

  # Contatos de telefones com nome
  tel_count=$(echo "$row" | jq '(.telefones // []) | length')
  for i in $(seq 0 $((tel_count - 1))); do
    tel_obs=$(echo "$row" | jq -r ".telefones[$i].observacao // \"\"")
    tel_ddd=$(echo "$row" | jq -r ".telefones[$i].ddd // \"\"")
    tel_num=$(echo "$row" | jq -r ".telefones[$i].numero // \"\"")
    tel_full=$(echo "${tel_ddd}${tel_num}" | tr -d '[:space:]' | sed 's/[^0-9]//g')
    if [ -n "$tel_obs" ] && [ "${#tel_full}" -ge 8 ]; then
      CONT_ID=$(cat /proc/sys/kernel/random/uuid)
      obs_esc=$(echo "$tel_obs" | cut -c1-199 | sed "s/'/''/g")
      if [ ${#tel_full} -ge 11 ]; then
        CONTACTS_SQL+="INSERT INTO contacts (id,tenant_id,client_id,name,phone,whatsapp,preferred_channel,can_open_tickets,status,is_primary,created_at) VALUES ('$CONT_ID','$TENANT','$CLIENT_ID','$obs_esc','${tel_full:0:19}','${tel_full:0:19}','whatsapp',true,'active',false,NOW());"$'\n'
      else
        CONTACTS_SQL+="INSERT INTO contacts (id,tenant_id,client_id,name,phone,preferred_channel,can_open_tickets,status,is_primary,created_at) VALUES ('$CONT_ID','$TENANT','$CLIENT_ID','$obs_esc','${tel_full:0:19}','phone',true,'active',false,NOW());"$'\n'
      fi
      TOTAL_CONTACTS=$((TOTAL_CONTACTS + 1))
    fi
  done

  # Contatos de emails
  email_count=$(echo "$row" | jq '(.emails // []) | length')
  for i in $(seq 0 $((email_count - 1))); do
    ev=$(echo "$row" | jq -r ".emails[$i].email // \"\"" | cut -c1-199 | sed "s/'/''/g")
    if [ -n "$ev" ]; then
      CONT_ID=$(cat /proc/sys/kernel/random/uuid)
      cont_name="${fantasia:0:150} - Email"
      CONTACTS_SQL+="INSERT INTO contacts (id,tenant_id,client_id,name,email,preferred_channel,can_open_tickets,status,is_primary,created_at) VALUES ('$CONT_ID','$TENANT','$CLIENT_ID','$cont_name','$ev','email',true,'active',false,NOW());"$'\n'
      TOTAL_CONTACTS=$((TOTAL_CONTACTS + 1))
    fi
  done

  COUNT=$((COUNT + 1))
  if [ $((COUNT % 50)) -eq 0 ]; then
    flush
    echo "  ↳ $COUNT/$TOTAL processados"
  fi
done < <(echo "$DATA" | jq -c '.[]')
flush

echo ""
echo "╔═══════════════════════════════════╗"
echo "║   IMPORTAÇÃO CONCLUÍDA            ║"
echo "║   Clientes : $COUNT               "
echo "║   Contatos : $TOTAL_CONTACTS      "
echo "║   Redes    : ${#NETWORK_IDS[@]}   "
echo "╚═══════════════════════════════════╝"
