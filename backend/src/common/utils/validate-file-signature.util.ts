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
    case 'audio/mp4': {
      if (buffer.length < 12) return false;
      const ftyp =
        buffer[4] === 0x66 &&
        buffer[5] === 0x74 &&
        buffer[6] === 0x79 &&
        buffer[7] === 0x70;
      if (!ftyp) return false;
      const brand = buffer.slice(8, 12).toString('ascii');
      return brand === 'M4A ' || brand === 'mp42' || brand === 'isom' || brand === 'mp41';
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
        'mp41',
        'mp42',
        'avc1',
        'M4V ',
        'msdh',
        'dash',
        'mp71',
        '3gp4',
        '3gg6',
      ];
      return videoBrands.includes(brand);
    }
    case 'application/pdf':
      return matchesPrefix(buffer, [0x25, 0x50, 0x44, 0x46]);
    default:
      return false;
  }
}
