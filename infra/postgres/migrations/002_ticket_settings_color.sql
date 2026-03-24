-- Adiciona coluna color em ticket_settings (para cores dos departamentos no widget)
ALTER TABLE ticket_settings ADD COLUMN IF NOT EXISTS color VARCHAR(20);
