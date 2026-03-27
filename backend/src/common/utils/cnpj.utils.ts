/**
 * Utilitários centralizados para CNPJ.
 *
 * Este arquivo é a fonte única de verdade para validação e normalização de CNPJ
 * em todo o backend. Outros módulos devem importar daqui em vez de reimplementar.
 */

/**
 * Remove todos os não-dígitos e retorna string de 14 chars.
 * Retorna string vazia se o resultado não tiver exatamente 14 dígitos.
 */
export function normalizeCnpj(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  return digits.length === 14 ? digits : '';
}

/**
 * Valida CNPJ com ou sem máscara usando o algoritmo dos dígitos verificadores.
 * Rejeita sequências com todos os dígitos iguais (ex: "11111111111111").
 *
 * Pesos utilizados:
 *  - 1º dígito verificador: [5,4,3,2,9,8,7,6,5,4,3,2]
 *  - 2º dígito verificador: [6,5,4,3,2,9,8,7,6,5,4,3,2]
 */
export function validateCnpj(cnpj: string): boolean {
  const raw = cnpj.replace(/\D/g, '');
  if (raw.length !== 14) return false;
  // Rejeita sequências com todos os dígitos iguais (ex: "11111111111111", "00000000000000")
  if (/^(\d)\1{13}$/.test(raw)) return false;

  const calc = (weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += parseInt(raw[i], 10) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== parseInt(raw[12], 10)) return false;

  const d2 = calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === parseInt(raw[13], 10);
}

/**
 * Detecta e retorna o CNPJ (apenas dígitos, 14 chars) encontrado em um texto livre.
 * Aceita formato mascarado (xx.xxx.xxx/xxxx-xx) ou sequência pura de 14 dígitos
 * cercada por delimitadores (espaço, pontuação, início/fim de string).
 * Valida matematicamente via validateCnpj antes de retornar.
 * Retorna null se não encontrar CNPJ válido.
 */
export function detectCnpjInText(text: string): string | null {
  if (!text) return null;

  // Padrão 1: CNPJ formatado com máscara (XX.XXX.XXX/XXXX-XX)
  const maskedPattern = /\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g;
  let match: RegExpExecArray | null;

  while ((match = maskedPattern.exec(text)) !== null) {
    const raw = match[1].replace(/\D/g, '');
    if (validateCnpj(raw)) return raw;
  }

  // Padrão 2: Sequência pura de 14 dígitos cercada por delimitadores
  // (início, fim, espaço, pontuação — mas não parte de número maior)
  const plainPattern = /(?<![0-9])(\d{14})(?![0-9])/g;

  while ((match = plainPattern.exec(text)) !== null) {
    const raw = match[1];
    if (validateCnpj(raw)) return raw;
  }

  return null;
}
