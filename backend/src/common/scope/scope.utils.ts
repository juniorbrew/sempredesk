/**
 * Utilitários de escopo para multi-tenant.
 * Garante que tenant_id e network_id sejam aplicados corretamente nas consultas.
 *
 * Regras:
 * - tenant_id: obrigatório em todas as operações de dados
 * - network_id: quando aplicável, restringe ao escopo da rede (ex: supervisor)
 *
 * Uso: importar e usar em services que precisam validar escopo.
 */

/** Asserção: registro deve pertencer ao tenant. Use em findOne/update/delete. */
export function assertTenantScope(record: { tenantId?: string } | null, tenantId: string): void {
  if (!record) return;
  const recTenant = record.tenantId ?? (record as any).tenant_id;
  if (recTenant && recTenant !== tenantId) {
    throw new Error('Registro fora do escopo do tenant');
  }
}

/**
 * Regra de escopo por rede para listagem de agentes:
 * - Se networkId informado: mostra usuários da rede + usuários com network_id NULL (tenant-wide)
 * - NULL = visibilidade tenant-wide (admins, gerentes globais)
 * - Seguro: supervisor de rede X não vê usuários de rede Y
 */
export const TEAM_NETWORK_SCOPE = {
  /** Condição SQL: (network_id = :networkId OR network_id IS NULL) */
  whereClause: '(u.network_id = :networkId OR u.network_id IS NULL)',
} as const;
