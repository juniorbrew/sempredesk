import { DataSource } from 'typeorm';

/** Remove asteriscos para não quebrar o negrito do WhatsApp (*…*). */
function stripWaMd(s: string): string {
  return String(s || '').trim().replace(/\*/g, '');
}

/**
 * Linha inicial no WhatsApp: *Nome do agente* (negrito) + quebra antes do texto.
 */
export function buildWhatsappAgentBoldLine(agentName: string): string {
  const n = stripWaMd(agentName);
  if (!n) return '';
  return `*${n}*\n`;
}

/** Prefixa o corpo enviado ao WhatsApp (não altera o texto gravado no painel). */
export function prependWhatsappAgentLine(agentName: string, body: string): string {
  const line = buildWhatsappAgentBoldLine(agentName);
  if (!line) return body;
  return `${line}${body}`;
}

export async function fetchWhatsappPrefixAgentEnabled(dataSource: DataSource, tenantId: string): Promise<boolean> {
  try {
    const rows: Array<{ v: boolean }> = await dataSource.query(
      `SELECT COALESCE(whatsapp_prefix_agent_name, false) AS v FROM chatbot_configs WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.v === true;
  } catch {
    return false;
  }
}
