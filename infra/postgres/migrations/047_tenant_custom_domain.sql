-- ──────────────────────────────────────────────────────────────────────────────
-- 047_tenant_custom_domain.sql
-- Suporte a domínio customizado por tenant (multi-tenant por subdomínio).
--
-- Adiciona dois campos na tabela tenants:
--   custom_domain  — domínio próprio da empresa (ex.: empresa.com.br), opcional
--   subdomain_active — flag para desativar o acesso via slug.sempredesk.com.br
--
-- Migration segura e incremental: usa IF NOT EXISTS; não altera nem remove
-- nenhuma coluna existente; é idempotente.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain    VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS subdomain_active BOOLEAN NOT NULL DEFAULT true;

-- Índice parcial: só indexa linhas com custom_domain preenchido (maioria NULL)
CREATE UNIQUE INDEX IF NOT EXISTS tenants_custom_domain_idx
  ON tenants (custom_domain)
  WHERE custom_domain IS NOT NULL;

-- Comentários documentando os campos
COMMENT ON COLUMN tenants.custom_domain    IS
  'Domínio próprio da empresa, ex.: empresa.com.br. Null = usa slug.sempredesk.com.br apenas.';
COMMENT ON COLUMN tenants.subdomain_active IS
  'Se false, desativa o acesso via {slug}.sempredesk.com.br (útil durante migração para domínio próprio).';
