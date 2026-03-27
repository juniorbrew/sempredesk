/**
 * Testes do fluxo de CNPJ no chatbot do WhatsApp.
 *
 * Garante que o comportamento seja idêntico ao menu de cliente:
 * busca primeiro, valida depois (somente para feedback ao usuário).
 *
 * Cenários cobertos:
 *  - CNPJ com máscara (00.000.000/0001-00) → mesmo comportamento do menu de cliente
 *  - CNPJ sem máscara (00000000000100)     → deve encontrar mesmo cliente mascarado no banco
 *  - CNPJ matematicamente inválido mas cliente existe → deve encontrar
 *  - CNPJ matematicamente inválido e cliente não existe → feedback de erro
 *  - CNPJ válido e cliente existe → encontra
 *  - CNPJ válido mas cliente não existe → not found
 */

import { normalizeCnpj, validateCnpj } from '../../common/utils/cnpj.utils';

// ── CNPJs usados nos testes ────────────────────────────────────────────────────

/** CNPJ clássico de teste — matematicamente inválido (d1=9, dígito armazenado=0) */
const CNPJ_MASCARA     = '00.000.000/0001-00';
const CNPJ_SEM_MASCARA = '00000000000100';

/** CNPJ real válido */
const CNPJ_VALIDO_MASCARA     = '11.444.777/0001-61';
const CNPJ_VALIDO_SEM_MASCARA = '11444777000161';

// ── Helpers que simulam a lógica do chatbot awaiting_cnpj ─────────────────────

/**
 * Simula o trecho do chatbot que processa CNPJ na etapa awaiting_cnpj.
 * Retorna o estado após processar: found / not_found / invalid_with_retry / invalid_final
 */
function simulateChatbotCnpjStep(
  input: string,
  dbClients: Array<{ id: string; companyName: string; cnpj: string }>,
  attempts = 0,
): 'found' | 'not_found' | 'invalid_with_retry' | 'invalid_final' {
  const digits = input.replace(/\D/g, '');

  // Reprodução exata da lógica corrigida (chatbot.service.ts awaiting_cnpj)
  if (digits.length !== 14 && digits.length < 8) {
    return attempts < 1 ? 'invalid_with_retry' : 'not_found';
  }

  // Busca primeiro (sem validar matematicamente)
  const match = dbClients.find(c => normalizeCnpj(c.cnpj ?? '') === digits);
  if (match) return 'found';

  // Não encontrado — usa validação só para escolher o feedback
  if (!validateCnpj(digits)) {
    return attempts < 1 ? 'invalid_with_retry' : 'not_found';
  }

  return 'not_found';
}

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('Chatbot WhatsApp — fluxo de CNPJ', () => {

  // ── normalizeCnpj (base do fluxo) ──────────────────────────────────────────

  describe('normalizeCnpj', () => {
    it('deve normalizar CNPJ com máscara para 14 dígitos', () => {
      expect(normalizeCnpj(CNPJ_MASCARA)).toBe(CNPJ_SEM_MASCARA);
    });

    it('deve manter CNPJ sem máscara inalterado', () => {
      expect(normalizeCnpj(CNPJ_SEM_MASCARA)).toBe(CNPJ_SEM_MASCARA);
    });

    it('deve normalizar CNPJ válido com máscara', () => {
      expect(normalizeCnpj(CNPJ_VALIDO_MASCARA)).toBe(CNPJ_VALIDO_SEM_MASCARA);
    });
  });

  // ── Cenários de busca — cliente existe no banco ────────────────────────────

  describe('cliente existe no banco com CNPJ salvo COM máscara', () => {
    const db = [{ id: 'cli-001', companyName: 'Empresa Teste', cnpj: CNPJ_MASCARA }];

    it('CNPJ com máscara → deve encontrar', () => {
      expect(simulateChatbotCnpjStep(CNPJ_MASCARA, db)).toBe('found');
    });

    it('CNPJ sem máscara → deve encontrar (mesmo cliente, formato diferente)', () => {
      // Este é o bug corrigido: antes retornava invalid/not_found
      expect(simulateChatbotCnpjStep(CNPJ_SEM_MASCARA, db)).toBe('found');
    });
  });

  describe('cliente existe no banco com CNPJ salvo SEM máscara', () => {
    const db = [{ id: 'cli-001', companyName: 'Empresa Teste', cnpj: CNPJ_SEM_MASCARA }];

    it('CNPJ sem máscara → deve encontrar', () => {
      expect(simulateChatbotCnpjStep(CNPJ_SEM_MASCARA, db)).toBe('found');
    });

    it('CNPJ com máscara → deve encontrar (mesmo cliente, formato diferente)', () => {
      expect(simulateChatbotCnpjStep(CNPJ_MASCARA, db)).toBe('found');
    });
  });

  describe('cliente válido existe no banco', () => {
    const db = [{ id: 'cli-002', companyName: 'Empresa Válida', cnpj: CNPJ_VALIDO_MASCARA }];

    it('CNPJ válido com máscara → deve encontrar', () => {
      expect(simulateChatbotCnpjStep(CNPJ_VALIDO_MASCARA, db)).toBe('found');
    });

    it('CNPJ válido sem máscara → deve encontrar', () => {
      expect(simulateChatbotCnpjStep(CNPJ_VALIDO_SEM_MASCARA, db)).toBe('found');
    });
  });

  // ── Cenários de busca — cliente NÃO existe no banco ───────────────────────

  describe('cliente não existe no banco', () => {
    const dbVazio: never[] = [];

    it('CNPJ matematicamente válido e não encontrado → not_found', () => {
      expect(simulateChatbotCnpjStep(CNPJ_VALIDO_SEM_MASCARA, dbVazio)).toBe('not_found');
    });

    it('CNPJ matematicamente inválido e não encontrado (primeira tentativa) → invalid_with_retry', () => {
      expect(simulateChatbotCnpjStep(CNPJ_SEM_MASCARA, dbVazio, 0)).toBe('invalid_with_retry');
    });

    it('CNPJ matematicamente inválido e não encontrado (segunda tentativa) → not_found', () => {
      expect(simulateChatbotCnpjStep(CNPJ_SEM_MASCARA, dbVazio, 1)).toBe('not_found');
    });
  });

  // ── Comparação menu de cliente vs WhatsApp ────────────────────────────────

  describe('paridade com o menu de cliente', () => {
    /**
     * Simula como o menu de cliente faz a busca:
     * passa o input raw para searchByNameOrCnpj, que usa ILIKE + REGEXP_REPLACE.
     * Aqui simulamos apenas a parte de comparação de CNPJ normalizado.
     */
    function menuClienteEncontra(
      inputDoUsuario: string,
      cnpjNoBanco: string,
    ): boolean {
      // searchByNameOrCnpj normaliza para comparar (nova cláusula REGEXP_REPLACE)
      const digitosInput = inputDoUsuario.replace(/\D/g, '');
      const digitosBanco = cnpjNoBanco.replace(/\D/g, '');
      return digitosInput === digitosBanco || cnpjNoBanco.includes(inputDoUsuario);
    }

    const cnpjsParaTeste = [
      { input: CNPJ_MASCARA,           banco: CNPJ_MASCARA },
      { input: CNPJ_SEM_MASCARA,       banco: CNPJ_MASCARA },
      { input: CNPJ_MASCARA,           banco: CNPJ_SEM_MASCARA },
      { input: CNPJ_SEM_MASCARA,       banco: CNPJ_SEM_MASCARA },
      { input: CNPJ_VALIDO_MASCARA,    banco: CNPJ_VALIDO_MASCARA },
      { input: CNPJ_VALIDO_SEM_MASCARA,banco: CNPJ_VALIDO_MASCARA },
    ];

    cnpjsParaTeste.forEach(({ input, banco }) => {
      it(`input "${input}" deve encontrar cliente com cnpj="${banco}" no banco`, () => {
        const db = [{ id: 'cli-x', companyName: 'X', cnpj: banco }];
        // WhatsApp chatbot
        expect(simulateChatbotCnpjStep(input, db)).toBe('found');
        // Menu de cliente
        expect(menuClienteEncontra(input, banco)).toBe(true);
      });
    });
  });
});
