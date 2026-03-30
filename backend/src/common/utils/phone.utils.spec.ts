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

  it('deve preservar identificadores longos sem truncar', () => {
    // Simula um LID do WhatsApp com 19 dígitos
    expect(normalizeWhatsappNumber('1234567890123456789')).toBe('1234567890123456789');
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

  it('deve produzir o mesmo resultado do webhook para número com código de país', () => {
    const webhookRaw = '5511999998888'; // já vem limpo do Meta webhook
    expect(normalizeWhatsappNumber(webhookRaw)).toBe('5511999998888');
  });

  it('número com 15 dígitos não deve ser truncado', () => {
    expect(normalizeWhatsappNumber('551199999888800')).toBe('551199999888800');
  });

  it('número com 16 dígitos deve ser preservado', () => {
    expect(normalizeWhatsappNumber('5511999998888001')).toBe('5511999998888001');
  });
});
