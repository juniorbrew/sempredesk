/**
 * Utilitários de normalização de número de WhatsApp/telefone.
 *
 * Regra única usada em TODO o sistema (webhook + cadastro manual + busca):
 *   1. Remove qualquer caractere que não seja dígito
 *   2. Se sobrar mais de 15 dígitos (ex: LID interno do WhatsApp), mantém os 13 últimos
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
 *   "1234567890123456789" → "3456789012345"   (>15 dígitos → últimos 13)
 *   ""                    → ""
 */
export function normalizeWhatsappNumber(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  // Números muito longos (>15 dígitos) são LIDs ou erros de entrada — trunca para os 13 finais
  if (digits.length > 15) return digits.slice(-13);
  return digits;
}
