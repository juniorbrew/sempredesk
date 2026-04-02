import * as fs from 'fs';

/** Lê até `maxBytes` do início do ficheiro (sem carregar o ficheiro inteiro). */
export function readFilePrefixSync(filePath: string, maxBytes: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(maxBytes, Math.max(0, stat.size));
    const buf = Buffer.alloc(size);
    if (size > 0) {
      fs.readSync(fd, buf, 0, size, 0);
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}
