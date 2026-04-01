/**
 * Validação por assinatura (magic bytes) vs MIME declarado.
 * Para MIME fora do conjunto estrito devolve true (sem bloquear — compatível com outros tipos já permitidos nas rotas).
 */

const STRICT_SIGNATURE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'application/pdf',
]);

/** Normaliza aliases comuns para o MIME canónico usado na verificação. */
export function normalizeMimeForSignature(declaredMime: string): string {
  const raw = (declaredMime || '').toLowerCase().split(';')[0].trim();
  if (raw === 'image/jpg' || raw === 'image/pjpeg') return 'image/jpeg';
  if (raw === 'audio/mp3' || raw === 'audio/x-mp3') return 'audio/mpeg';
  if (raw === 'audio/x-m4a' || raw === 'audio/m4a') return 'audio/mp4';
  return raw;
}

function isMp4Family(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return true;
  }
  const limit = Math.min(buffer.length - 8, 64);
  for (let i = 0; i <= limit; i += 1) {
    if (
      buffer[i] === 0x66 &&
      buffer[i + 1] === 0x74 &&
      buffer[i + 2] === 0x79 &&
      buffer[i + 3] === 0x70
    ) {
      return true;
    }
  }
  return false;
}

function signatureMatchesCanonical(buffer: Buffer, canonicalMime: string): boolean {
  if (!buffer?.length) return false;

  switch (canonicalMime) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      );
    case 'application/pdf':
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
      );
    case 'audio/ogg':
      return buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === 'OggS';
    case 'audio/mpeg':
      if (buffer.length < 3) return false;
      if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;
      return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    case 'audio/mp4':
      return isMp4Family(buffer);
    default:
      return true;
  }
}

/**
 * @param buffer conteúdo do ficheiro
 * @param declaredMime MIME enviado pelo cliente (ex.: multer file.mimetype)
 * @returns false se o MIME estiver no conjunto estrito e os bytes não corresponderem; true caso contrário
 */
export function validateFileSignature(buffer: Buffer, declaredMime: string): boolean {
  const canonical = normalizeMimeForSignature(declaredMime);
  if (!STRICT_SIGNATURE_MIMES.has(canonical)) {
    return true;
  }
  return signatureMatchesCanonical(buffer, canonical);
}
