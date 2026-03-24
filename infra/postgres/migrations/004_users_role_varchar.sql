-- Migration 004: converte users.role de ENUM para VARCHAR
-- Permite atribuir perfis personalizados aos usuários

-- 1. Adicionar coluna temporária
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_new VARCHAR(50);

-- 2. Copiar dados
UPDATE users SET role_new = role::text;

-- 3. Remover coluna antiga e renomear
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users RENAME COLUMN role_new TO role;

-- 4. Garantir NOT NULL com default
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'technician';

-- 5. Índice para consultas por role
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
