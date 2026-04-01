# Mapeamento — bloqueio de licença (`TENANT_LICENSE_BLOCKED`)

Resposta HTTP **403** com `error.code === "TENANT_LICENSE_BLOCKED"`. O corpo inclui:

- `message` — texto para o utilizador (também na query `reason` ao redireccionar para `/license-blocked`).
- `reasonKey` — chave estável para suporte (query `rk` na URL da página de bloqueio).

Origem no código: `TenantLicenseService.assertTenantOperational` (`backend/src/modules/saas/tenant-license.service.ts`).

---

## Tabela rápida

| `reasonKey` | Mensagem típica (`message`) | Causa técnica | Acção no master (super_admin) |
|-------------|-----------------------------|---------------|--------------------------------|
| `INVALID_TENANT` | Empresa inválida | `tenantId` sem linha em `tenants` (dados inconsistentes / token antigo) | Validar utilizador e `tenant_id`; corrigir dados ou pedir novo login após correcção. |
| `TENANT_SUSPENDED` | Esta empresa está suspensa… | `tenants.status = 'suspended'` | Reativar tenant quando o caso estiver regularizado (processo interno + `tenants`). |
| `LICENSE_INACTIVE` | Licença inativa… | Última linha em `tenant_licenses` com `status` em `suspended`, `cancelled` ou `expired` | Ajustar estado da licença ou emitir/reativar licença conforme SOP. |
| `LICENSE_EXPIRED` | Licença expirada… | `expires_at` &lt; agora com licença ainda “activa” no sentido de fluxo | Renovar prazo (`expires_at`) / plano; cliente faz novo login após correcção. |

---

## Macros sugeridas (alinhadas ao `reasonKey`)

Textos curtos para ticket; personalizar `[PRAZO]` e assinatura. Detalhe em [RUNBOOK_BLOQUEIO_LICENCA.md](./RUNBOOK_BLOQUEIO_LICENCA.md).

- **LICENSE_EXPIRED** / **LICENSE_INACTIVE** → macros **A** ou **B** do runbook (renovação / já corrigido).
- **TENANT_SUSPENDED** → macro **C** (suspensão administrativa) até haver decisão comercial.
- **INVALID_TENANT** → escalar técnico: validar cadastro e token; evitar prometer prazo ao cliente até identificar causa.

---

## JSON de exemplo

```json
{
  "success": false,
  "statusCode": 403,
  "error": {
    "message": "Licença expirada. Renove o plano para continuar.",
    "code": "TENANT_LICENSE_BLOCKED",
    "reasonKey": "LICENSE_EXPIRED"
  }
}
```

---

## Documentos relacionados

- [RUNBOOK_BLOQUEIO_LICENCA.md](./RUNBOOK_BLOQUEIO_LICENCA.md)
- [SOP_ONBOARDING_TENANTS.md](./SOP_ONBOARDING_TENANTS.md) §8
- [CHECKLIST_SEQUENCIA_POS_DEPLOY.md](./CHECKLIST_SEQUENCIA_POS_DEPLOY.md)
