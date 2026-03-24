#!/usr/bin/env node
/**
 * Script para corrigir senha do portal de um contato.
 * Uso: node scripts/fix-portal-password.js <email> [nova_senha]
 * Ex:  node scripts/fix-portal-password.js juniorbrew@hotmail.com MinhaSenha123
 *      node scripts/fix-portal-password.js juniorbrew@hotmail.com  (apenas verifica o contato)
 */

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const email = process.argv[2];
if (!email) {
  console.error('Uso: node scripts/fix-portal-password.js <email> [nova_senha]');
  process.exit(1);
}

const newPassword = process.argv[3];

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'suporte',
  password: process.env.DB_PASSWORD || 'suporte123',
  database: process.env.DB_NAME || 'suporte_tecnico',
});

async function main() {
  await client.connect();

  const res = await client.query(
    `SELECT id, name, email, status, 
            CASE WHEN portal_password IS NOT NULL AND portal_password != '' THEN 'SIM' ELSE 'NÃO' END as tem_senha
     FROM contacts 
     WHERE LOWER(TRIM(email)) = LOWER($1)`,
    [email.trim()]
  );

  if (res.rows.length === 0) {
    console.log(`❌ Nenhum contato encontrado com o e-mail: ${email}`);
    await client.end();
    process.exit(1);
  }

  const c = res.rows[0];
  console.log('Contato encontrado:');
  console.log('  ID:', c.id);
  console.log('  Nome:', c.name);
  console.log('  E-mail:', c.email);
  console.log('  Status:', c.status);
  console.log('  Tem senha portal:', c.tem_senha);

  if (c.status !== 'active') {
    console.log('\n⚠️  Contato está INATIVO. Ative-o no painel (Clientes > Contato > editar).');
    if (newPassword) {
      await client.query('UPDATE contacts SET status = $1 WHERE id = $2', ['active', c.id]);
      console.log('✓ Status atualizado para "active".');
    }
  }

  if (!newPassword) {
    if (c.tem_senha === 'NÃO') {
      console.log('\n⚠️  O contato NÃO tem senha do portal. Defina uma senha:');
      console.log(`   node scripts/fix-portal-password.js ${email} SuaSenha123`);
    } else {
      console.log('\n✓ Contato parece OK. Se não consegue acessar, tente redefinir a senha pelo painel ou com este script.');
    }
    await client.end();
    return;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await client.query(
    'UPDATE contacts SET portal_password = $1, status = $2 WHERE id = $3',
    [hash, 'active', c.id]
  );

  console.log('\n✓ Senha do portal definida com sucesso!');
  console.log('  O contato pode acessar em: cliente.financeos.com.br');
  console.log('  E-mail:', c.email);
  console.log('  Senha: (a que você informou)');

  await client.end();
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
