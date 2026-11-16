export type ImageExtension = '.jpg' | '.png' | '.webp';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

export const MIN_IMAGE_BYTES = 20_000;
export const MAX_IMAGE_BYTES = 8_000_000;

export function sniffImage(bytes: Uint8Array): ImageExtension | null {
  if (startsWith(bytes, PNG, 0)) return '.png';
  if (startsWith(bytes, JPEG, 0)) return '.jpg';
  if (startsWith(bytes, RIFF, 0) && startsWith(bytes, WEBP, 8)) return '.webp';
  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset: number): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}
