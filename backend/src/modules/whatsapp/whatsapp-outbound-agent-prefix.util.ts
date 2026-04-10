import { DataSource } from 'typeorm';

/**
 * WhatsApp trata *texto* como negrito. Remove asteriscos do nome para não quebrar o markdown.
 */
export function buildWhatsappAgentBoldLine(agentName: string): string {
  const n = String(agentName || '').trim().replace(/\*/g, '');
  if (!n) return '';
  return `*${n}*\n`;
}

/** Prefixa o corpo da mensagem enviada ao WhatsApp (não altera o texto gravado no painel). */
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
