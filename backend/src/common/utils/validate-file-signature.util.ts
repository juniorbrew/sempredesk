/**
 * Validação estrita: só MIME listados.
 * Chamadores devem passar pelo menos 12 bytes (WebP e audio/mp4 exigem).
 */

function matchesPrefix(buf: Buffer, prefix: number[]): boolean {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * @returns true só se o MIME estiver na lista permitida e os magic bytes corresponderem
 */
export function validateFileSignature(buffer: Buffer, declaredMime: string): boolean {
  if (!buffer || buffer.length < 8) return false;

  const mime = (declaredMime || '').toLowerCase().split(';')[0].trim();

  switch (mime) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return matchesPrefix(buffer, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/gif':
      return (
        matchesPrefix(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        matchesPrefix(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
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
    case 'image/svg+xml': {
      const slice = buffer
        .slice(0, Math.min(buffer.length, 512))
        .toString('utf8')
        .trimStart()
        .toLowerCase();
      return slice.startsWith('<svg') || (slice.startsWith('<?xml') && slice.includes('<svg'));
    }
    case 'image/heic':
    case 'image/heif': {
      if (buffer.length < 12) return false;
      const ftyp =
        buffer[4] === 0x66 &&
        buffer[5] === 0x74 &&
        buffer[6] === 0x79 &&
        buffer[7] === 0x70;
      if (!ftyp) return false;
      const brand = buffer.slice(8, 12).toString('ascii');
      return ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heim', 'hevm'].includes(brand);
    }
    case 'audio/ogg':
      return matchesPrefix(buffer, [0x4f, 0x67, 0x67, 0x53]);
    case 'audio/webm':
      // EBML header — magic bytes de todo arquivo WebM/MKV
      return matchesPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'audio/mpeg':
      return (
        matchesPrefix(buffer, [0xff, 0xfb]) ||
        matchesPrefix(buffer, [0xff, 0xf3]) ||
        matchesPrefix(buffer, [0xff, 0xf2])
      );
    case 'audio/wav':
    case 'audio/x-wav':
      return (
        buffer.length >= 12 &&
        matchesPrefix(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x41 &&
        buffer[10] === 0x56 &&
        buffer[11] === 0x45
      );
    case 'audio/mp4': {
      if (buffer.length < 12) return false;
      const ftyp =
        buffer[4] === 0x66 &&
        buffer[5] === 0x74 &&
        buffer[6] === 0x79 &&
        buffer[7] === 0x70;
      if (!ftyp) return false;
      const brand = buffer.slice(8, 12).toString('ascii');
      return brand === 'M4A ' || brand === 'mp42' || brand === 'isom' || brand === 'mp41' || brand === 'M4B ';
    }
    case 'video/mp4': {
      if (buffer.length < 12) return false;
      const ftyp =
        buffer[4] === 0x66 &&
        buffer[5] === 0x74 &&
        buffer[6] === 0x79 &&
        buffer[7] === 0x70;
      if (!ftyp) return false;
      const brand = buffer.slice(8, 12).toString('ascii');
      const videoBrands = [
        'isom',
        'iso2',
        'iso5',
        'iso6',
        'mp41',
        'mp42',
        'avc1',
        'M4V ',
        'msdh',
        'dash',
        'mp71',
        '3gp4',
        '3gg6',
        'qt  ',
        'MSNV',
        'CAE ',
      ];
      return videoBrands.includes(brand);
    }
    case 'application/pdf':
      return matchesPrefix(buffer, [0x25, 0x50, 0x44, 0x46]);
    case 'application/msword':
    case 'application/vnd.ms-excel':
      return matchesPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/zip':
    case 'application/x-zip-compressed':
      return (
        matchesPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
        matchesPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])
      );
    case 'application/x-rar-compressed':
    case 'application/vnd.rar':
      return matchesPrefix(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
    case 'text/plain':
    case 'text/csv':
    case 'application/csv':
      return bufferMostlyPlainText(buffer);
    default:
      return false;
  }
}

/** CSV/TXT: sem assinatura fiável; rejeita binários óbvios (NUL, PDF, ZIP…). */
function bufferMostlyPlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return false;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return false;
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return false;
  let nul = 0;
  const n = Math.min(buffer.length, 8000);
  for (let i = 0; i < n; i++) {
    const b = buffer[i]!;
    if (b === 0) nul++;
  }
  return nul / n < 0.001;
}

const SNIFF_IMAGE_ORDER = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const SNIFF_AUDIO_ORDER = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav'] as const;

/**
 * Valida assinatura e, se o MIME declarado não bater (comum em JPEG/PNG com tipo errado no browser),
 * tenta formatos permitidos do mesmo grupo (imagem/áudio/vídeo).
 */
export function resolveValidatedConversationMime(
  buffer: Buffer,
  declaredMime: string,
  mediaKind: 'image' | 'audio' | 'video' | 'file',
): string | null {
  const d = (declaredMime || '').toLowerCase().split(';')[0].trim();
  if (validateFileSignature(buffer, d)) return d;

  if (mediaKind === 'image') {
    for (const c of SNIFF_IMAGE_ORDER) {
      if (validateFileSignature(buffer, c)) return c;
    }
    if (validateFileSignature(buffer, 'image/svg+xml')) return 'image/svg+xml';
    if (validateFileSignature(buffer, 'image/heic')) return 'image/heic';
    if (validateFileSignature(buffer, 'image/heif')) return 'image/heif';
  } else if (mediaKind === 'audio') {
    for (const c of SNIFF_AUDIO_ORDER) {
      if (validateFileSignature(buffer, c)) return c;
    }
  } else if (mediaKind === 'video') {
    if (validateFileSignature(buffer, 'video/mp4')) return 'video/mp4';
  }

  return null;
}
