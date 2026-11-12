import type { BabyPhotoContentType } from '@baby-tracker/shared';

/**
 * Identifies an image by its first bytes, never by what the client says it is.
 *
 * A `Content-Type` header is a claim; the bytes are the fact. Only the three
 * formats a browser can decode and that carry no active content are accepted —
 * deliberately not SVG, which can hold script.
 */
export function detectImageType(bytes: Uint8Array): BabyPhotoContentType | null {
  const startsWith = (signature: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}
