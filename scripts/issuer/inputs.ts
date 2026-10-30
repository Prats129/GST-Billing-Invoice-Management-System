import { open } from 'node:fs/promises';

export async function readBounded(path: string, maximum: number) {
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new Error();
    const buffer = Buffer.alloc(maximum + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maximum) throw new Error();
    return buffer.subarray(0, total);
  } finally {
    await file.close();
  }
}
