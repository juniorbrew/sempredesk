/**
 * Validação alinhada ao Meta (Phone Number ID / WABA ID numéricos).
 * Usado no controller e espelhado no frontend (whatsapp/page.tsx).
 */
const META_PHONE_ID_MIN = 8;
const META_PHONE_ID_MAX = 24;
const META_WABA_ID_MIN = 6;
const META_WABA_ID_MAX = 24;

export function validateMetaPhoneNumberId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Phone Number ID é obrigatório.';
  if (v.includes('@')) {
    return 'Phone Number ID não pode ser um e-mail; use apenas o ID numérico do Meta Developer Console.';
  }
  if (!/^\d+$/.test(v)) {
    return 'Phone Number ID deve conter apenas dígitos, sem letras nem espaços.';
  }
  if (v.length < META_PHONE_ID_MIN || v.length > META_PHONE_ID_MAX) {
    return `Phone Number ID deve ter entre ${META_PHONE_ID_MIN} e ${META_PHONE_ID_MAX} dígitos.`;
  }
  return null;
}

/** Vazio ou só espaços = válido (não enviar / limpar). */
export function validateMetaWabaIdOptional(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (v.includes('@')) {
    return 'WABA ID não pode ser um e-mail; informe o WhatsApp Business Account ID (só números).';
  }
  if (!/^\d+$/.test(v)) {
    return 'WABA ID deve conter apenas dígitos.';
  }
  if (v.length < META_WABA_ID_MIN || v.length > META_WABA_ID_MAX) {
    return `WABA ID deve ter entre ${META_WABA_ID_MIN} e ${META_WABA_ID_MAX} dígitos.`;
  }
  return null;
}
