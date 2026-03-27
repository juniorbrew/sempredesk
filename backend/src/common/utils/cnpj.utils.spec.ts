import { normalizeCnpj, validateCnpj, detectCnpjInText } from './cnpj.utils';

/**
 * CNPJs usados nos testes:
 *  - 11.444.777/0001-61  → CNPJ válido (dígitos: 11444777000161)
 *  - 45.997.418/0001-53  → CNPJ válido (dígitos: 45997418000153)
 *  - 00.000.000/0000-00  → CNPJ inválido (todos zeros)
 *  - 11.111.111/1111-11  → CNPJ inválido (todos dígitos iguais)
 */

describe('normalizeCnpj', () => {
  it('deve retornar 14 dígitos quando CNPJ tem máscara', () => {
    expect(normalizeCnpj('11.444.777/0001-61')).toBe('11444777000161');
  });

  it('deve retornar o mesmo string quando CNPJ já está sem máscara', () => {
    expect(normalizeCnpj('11444777000161')).toBe('11444777000161');
  });

  it('deve retornar string vazia quando entrada contém letras (não resulta em 14 dígitos)', () => {
    expect(normalizeCnpj('ABCDEF')).toBe('');
  });

  it('deve retornar string vazia quando resultado tem menos de 14 dígitos', () => {
    expect(normalizeCnpj('1234567')).toBe('');
  });

  it('deve retornar string vazia para string vazia', () => {
    expect(normalizeCnpj('')).toBe('');
  });

  it('deve retornar string vazia para undefined/null-like via cast', () => {
    expect(normalizeCnpj('' as string)).toBe('');
  });
});

describe('validateCnpj', () => {
  it('deve retornar true para CNPJ válido com máscara', () => {
    expect(validateCnpj('11.444.777/0001-61')).toBe(true);
  });

  it('deve retornar true para CNPJ válido sem máscara', () => {
    expect(validateCnpj('11444777000161')).toBe(true);
  });

  it('deve retornar true para segundo CNPJ válido', () => {
    expect(validateCnpj('45.997.418/0001-53')).toBe(true);
  });

  it('deve retornar false para CNPJ com dígito verificador errado', () => {
    // Último dígito alterado de 1 para 2
    expect(validateCnpj('11444777000162')).toBe(false);
  });

  it('deve retornar false para CNPJ com todos os dígitos iguais', () => {
    expect(validateCnpj('11111111111111')).toBe(false);
  });

  it('deve retornar false para todos zeros', () => {
    expect(validateCnpj('00000000000000')).toBe(false);
  });

  it('deve retornar false para 00000000000100 sem máscara (dígito verificador errado)', () => {
    // d1 calculado = 9, mas raw[12] = 0 → matematicamente inválido pelo algoritmo
    expect(validateCnpj('00000000000100')).toBe(false);
  });

  it('deve retornar false para 00.000.000/0001-00 com máscara (mesmo CNPJ, formato diferente)', () => {
    expect(validateCnpj('00.000.000/0001-00')).toBe(false);
  });

  it('deve retornar false para string vazia', () => {
    expect(validateCnpj('')).toBe(false);
  });

  it('deve retornar false para CNPJ com menos de 14 dígitos', () => {
    expect(validateCnpj('1144477700016')).toBe(false);
  });
});

describe('detectCnpjInText', () => {
  it('deve detectar CNPJ formatado com máscara em texto', () => {
    const text = 'Meu CNPJ é 11.444.777/0001-61, pode verificar.';
    expect(detectCnpjInText(text)).toBe('11444777000161');
  });

  it('deve detectar CNPJ sem máscara delimitado por espaços em texto', () => {
    const text = 'Meu CNPJ é 11444777000161 obrigado';
    expect(detectCnpjInText(text)).toBe('11444777000161');
  });

  it('deve retornar null para texto sem CNPJ', () => {
    expect(detectCnpjInText('Olá, como posso ajudar?')).toBeNull();
  });

  it('deve retornar null para número de 14 dígitos matematicamente inválido', () => {
    // 14 dígitos mas não passa no algoritmo de validação
    expect(detectCnpjInText('Meu número é 11444777000162')).toBeNull();
  });

  it('deve detectar CNPJ no meio de uma frase', () => {
    const text = 'Por favor, valide o CNPJ 45.997.418/0001-53 para cadastro.';
    expect(detectCnpjInText(text)).toBe('45997418000153');
  });

  it('deve retornar null para texto vazio', () => {
    expect(detectCnpjInText('')).toBeNull();
  });

  it('deve retornar null para CNPJ com todos dígitos iguais', () => {
    expect(detectCnpjInText('CNPJ 11111111111111 inválido')).toBeNull();
  });

  it('deve detectar CNPJ no início do texto', () => {
    expect(detectCnpjInText('11.444.777/0001-61 é meu CNPJ')).toBe('11444777000161');
  });
});
