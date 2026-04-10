-- ============================================================
-- 017_whatsapp_connection_meta_waba_id.sql
-- Coluna usada pela entidade WhatsappConnection (Meta WABA).
-- init.sql / migrações anteriores não incluíam este campo.
-- ============================================================

ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR;
