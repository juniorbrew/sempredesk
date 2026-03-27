import { normalizeWhatsappNumber } from './phone.utils';

describe('normalizeWhatsappNumber', () => {
  it('deve remover máscara e retornar somente dígitos', () => {
    expect(normalizeWhatsappNumber('+55 (11) 99999-8888')).toBe('5511999998888');
  });

  it('deve manter número já normalizado inalterado', () => {
    expect(normalizeWhatsappNumber('5511999998888')).toBe('5511999998888');
  });

  it('deve normalizar número sem DDI', () => {
    expect(normalizeWhatsappNumber('11999998888')).toBe('11999998888');
  });

  it('deve remover parênteses, traços e espaços', () => {
    expect(normalizeWhatsappNumber('(11) 99999-8888')).toBe('11999998888');
  });

  it('deve truncar para os 13 últimos dígitos quando tiver mais de 15', () => {
    // Simula um LID do WhatsApp com 19 dígitos
    expect(normalizeWhatsappNumber('1234567890123456789')).toBe('7890123456789');
  });

  it('deve retornar string vazia para entrada vazia', () => {
    expect(normalizeWhatsappNumber('')).toBe('');
  });

  it('deve retornar string vazia para null', () => {
    expect(normalizeWhatsappNumber(null)).toBe('');
  });

  it('deve retornar string vazia para undefined', () => {
    expect(normalizeWhatsappNumber(undefined)).toBe('');
  });

  it('deve retornar string vazia para entrada sem dígitos', () => {
    expect(normalizeWhatsappNumber('abc-def')).toBe('');
  });

  it('deve produzir o mesmo resultado que o webhook para número com código de país', () => {
    // Simula o que whatsapp.service.ts faz: replace(/\D/g, '') + slice(-13) se >15
    const webhookRaw = '5511999998888'; // já vem limpo do Meta webhook
    expect(normalizeWhatsappNumber(webhookRaw)).toBe('5511999998888');
  });

  it('número com 15 dígitos não deve ser truncado', () => {
    // 15 dígitos é o limite máximo sem truncar
    expect(normalizeWhatsappNumber('551199999888800')).toBe('551199999888800');
  });

  it('número com 16 dígitos deve ser truncado para 13', () => {
    expect(normalizeWhatsappNumber('5511999998888001')).toBe('1999998888001');
  });
});
