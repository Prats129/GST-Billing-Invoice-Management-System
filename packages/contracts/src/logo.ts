import { z } from 'zod';
export const MAX_LOGO_BYTES = 65536;
// Raster PNG only: no SVG, remote URL, HTML or active content. Bound decoded
// dimensions as well as bytes; the server never renders or executes the upload.
export const logoDataSchema = z
  .string()
  .max(87406)
  .refine((value) => {
    if (value === '') return true;
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
      return false;
    try {
      const bytes = atob(value.slice(22));
      if (bytes.length > MAX_LOGO_BYTES || bytes.length < 33) return false;
      if (
        [...bytes.slice(0, 8)].map((c) => c.charCodeAt(0)).join(',') !==
          '137,80,78,71,13,10,26,10' ||
        bytes.slice(12, 16) !== 'IHDR'
      )
        return false;
      const uint = (offset: number) =>
        [0, 1, 2, 3].reduce(
          (n, i) => n * 256 + bytes.charCodeAt(offset + i),
          0,
        );
      return (
        uint(8) === 13 &&
        uint(16) > 0 &&
        uint(20) > 0 &&
        uint(16) <= 1024 &&
        uint(20) <= 1024
      );
    } catch {
      return false;
    }
  }, 'Use a PNG logo up to 64 KiB and 1024 × 1024 pixels');
