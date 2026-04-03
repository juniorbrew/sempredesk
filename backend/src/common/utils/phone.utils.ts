/**
 * Utilitários de normalização de número de WhatsApp/telefone.
 *
 * Regra única usada em TODO o sistema (webhook + cadastro manual + busca):
 *   1. Remove qualquer caractere que não seja dígito
 *   2. Mantem todos os dígitos para não transformar identificadores técnicos
 *      (LID/JID do WhatsApp) em um telefone aparentemente válido.
 *   3. Devolve string vazia se resultado for vazio
 *
 * Esta lógica é idêntica à aplicada em whatsapp.service.ts ao receber mensagens,
 * garantindo que o formato salvo via webhook == formato salvo via cadastro manual.
 */

/**
 * Normaliza um número de WhatsApp para o formato de armazenamento padrão.
 *
 * Exemplos:
 *   "+55 (11) 99999-8888" → "5511999998888"
 *   "5511999998888"       → "5511999998888"   (inalterado)
 *   "11999998888"         → "11999998888"     (sem DDI — mantém como veio)
 *   "1234567890123456789" → "1234567890123456789"
 *   ""                    → ""
 */
export function normalizeWhatsappNumber(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return digits;
}

/**
 * JIDs BR legados vêm com 12 dígitos (55 + DDD + 8), sem o 9 após o DDD.
 * Se o primeiro dígito da assinante for 6–9 (padrão de celular), insere o 9.
 * Não altera LIDs longos, números já com 13 dígitos nem linhas fixas (ex.: 3xxx).
 */
export function restoreBrNinthDigit(digits: string): string {
  if (!digits || !/^\d+$/.test(digits)) return digits || '';
  if (!digits.startsWith('55') || digits.length !== 12) return digits;
  const firstAfterDdd = digits.charAt(4);
  if (firstAfterDdd >= '6' && firstAfterDdd <= '9') {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

/**
 * Variante sem o 9 após o DDD (12 dígitos) para bater com cadastros antigos.
 */
export function brPhoneWithout9(digits: string): string | null {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (!digits.startsWith('55') || digits.length !== 13) return null;
  if (digits.charAt(4) !== '9') return null;
  return digits.slice(0, 4) + digits.slice(5);
}
