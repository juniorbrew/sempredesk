import { DataSource } from 'typeorm';

/** Remove asteriscos para não quebrar o negrito do WhatsApp (*…*). */
function stripWaMd(s: string): string {
  return String(s || '').trim().replace(/\*/g, '');
}

/**
 * Cabeçalho no WhatsApp (negrito): *Departamento - Nome do agente:*
 * ou só *Nome:* se não houver departamento.
 */
export function buildWhatsappAgentHeaderLine(
  department: string | null | undefined,
  agentName: string,
): string {
  const name = stripWaMd(agentName);
  if (!name) return '';
  const dept = stripWaMd(department || '');
  if (dept) {
    return `*${dept} - ${name}:*\n`;
  }
  return `*${name}:*\n`;
}

/** Prefixa o corpo enviado ao WhatsApp (não altera o texto gravado no painel). */
export function prependWhatsappAgentLine(
  department: string | null | undefined,
  agentName: string,
  body: string,
): string {
  const line = buildWhatsappAgentHeaderLine(department, agentName);
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
