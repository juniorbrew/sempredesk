#!/usr/bin/env node
/**
 * Backfill seguro de tenant_settings para tenants antigos.
 *
 * Para cada tenant:
 *  - Se não existe tenant_settings: cria com dados de tenants.settings->'empresa'
 *  - Se existe mas tem campos vazios: preenche apenas os campos nulos/vazios
 *  - Nunca sobrescreve dados já preenchidos manualmente
 *
 * Uso:
 *   node scripts/backfill-tenant-settings.js           # aplica
 *   node scripts/backfill-tenant-settings.js --dry-run # apenas mostra o que faria
 *
 * Env vars (mesmas do backend .env):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

const { Client } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

const client = new Client({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  user:     process.env.DB_USER     || 'suporte',
  password: process.env.DB_PASSWORD || 'suporte123',
  database: process.env.DB_NAME     || 'suporte_tecnico',
});

// Monta companyAddress a partir das partes do JSONB empresa
function buildAddress(e) {
  if (!e) return null;
  const cidadeUf = e.cidade && e.uf
    ? `${e.cidade}/${e.uf}`
    : (e.cidade || e.uf || null);
  const parts = [e.logradouro, e.numero, e.complemento, e.bairro, cidadeUf, e.cep]
    .map(v => (v || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Retorna apenas campos com valor real (não-vazio, não-nulo)
function notEmpty(val) {
  return val !== null && val !== undefined && String(val).trim() !== '';
}

async function main() {
  await client.connect();
  console.log(`\n=== backfill-tenant-settings ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===\n`);

  const { rows: tenants } = await client.query(`
    SELECT id, name, slug, cnpj, email, phone, settings
    FROM tenants
    ORDER BY created_at ASC
  `);

  console.log(`Tenants encontrados: ${tenants.length}\n`);

  let created = 0;
  let patched  = 0;
  let skipped  = 0;

  for (const tenant of tenants) {
    const empresa = tenant.settings?.empresa || {};

    // --- Calcula valores candidatos ---
    const candidate = {
      companyName:    notEmpty(empresa.nomeFantasia) ? empresa.nomeFantasia
                    : notEmpty(empresa.razaoSocial)  ? empresa.razaoSocial
                    : tenant.name,
      companyEmail:   notEmpty(empresa.email) ? empresa.email : tenant.email,
      companyPhone:   notEmpty(empresa.telefone) ? empresa.telefone : tenant.phone,
      companyCnpj:    tenant.cnpj || null,
      companyAddress: buildAddress(empresa),
    };

    // --- Verifica se tenant_settings existe ---
    const { rows: existing } = await client.query(
      `SELECT id, "companyName", "companyEmail", "companyPhone", "companyCnpj", "companyAddress"
       FROM tenant_settings WHERE tenant_id = $1`,
      [tenant.id],
    );

    if (existing.length === 0) {
      // Não existe: cria com os candidatos disponíveis
      const hasData = Object.values(candidate).some(notEmpty);
      if (!hasData) {
        console.log(`[SKIP]    ${tenant.slug} — sem dados históricos para provisionar`);
        skipped++;
        continue;
      }

      console.log(`[CREATE]  ${tenant.slug}`);
      console.log(`          companyName:    ${candidate.companyName}`);
      console.log(`          companyEmail:   ${candidate.companyEmail || '—'}`);
      console.log(`          companyPhone:   ${candidate.companyPhone || '—'}`);
      console.log(`          companyCnpj:    ${candidate.companyCnpj || '—'}`);
      console.log(`          companyAddress: ${candidate.companyAddress || '—'}`);

      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO tenant_settings
             (id, tenant_id, "companyName", "companyEmail", "companyPhone", "companyCnpj", "companyAddress",
              created_at, updated_at)
           VALUES
             (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            tenant.id,
            candidate.companyName   || null,
            candidate.companyEmail  || null,
            candidate.companyPhone  || null,
            candidate.companyCnpj   || null,
            candidate.companyAddress || null,
          ],
        );
      }
      created++;
      continue;
    }

    // Existe: atualiza apenas campos nulos/vazios
    const row = existing[0];
    const updates = {};

    for (const field of ['companyName', 'companyEmail', 'companyPhone', 'companyCnpj', 'companyAddress']) {
      if (!notEmpty(row[field]) && notEmpty(candidate[field])) {
        updates[field] = candidate[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log(`[OK]      ${tenant.slug} — já preenchido, nada a fazer`);
      skipped++;
      continue;
    }

    console.log(`[PATCH]   ${tenant.slug}`);
    for (const [k, v] of Object.entries(updates)) {
      console.log(`          ${k}: ${v}`);
    }

    if (!DRY_RUN) {
      const setClauses = Object.keys(updates)
        .map((k, i) => `"${k}" = $${i + 2}`)
        .join(', ');
      await client.query(
        `UPDATE tenant_settings SET ${setClauses}, updated_at = NOW() WHERE tenant_id = $1`,
        [tenant.id, ...Object.values(updates)],
      );
    }
    patched++;
  }

  console.log('\n─────────────────────────────────');
  console.log(`Criados:    ${created}`);
  console.log(`Atualizados: ${patched}`);
  console.log(`Ignorados:  ${skipped}`);
  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Nenhuma alteração foi gravada.');
  } else {
    console.log('\nBackfill concluído.');
  }

  await client.end();
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
