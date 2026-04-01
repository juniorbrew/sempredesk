/** Resposta 403 — cliente redirecciona para página dedicada */
export const TENANT_LICENSE_BLOCKED_CODE = 'TENANT_LICENSE_BLOCKED';

/**
 * Chave estável no JSON de erro (`reasonKey`) para suporte, logs e docs.
 * A mensagem (`message`) permanece legível para o utilizador final.
 */
export const TENANT_LICENSE_BLOCK_REASON_KEY = {
  INVALID_TENANT: 'INVALID_TENANT',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  LICENSE_INACTIVE: 'LICENSE_INACTIVE',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
} as const;
