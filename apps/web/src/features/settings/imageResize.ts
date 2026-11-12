/**
 * Shrinks a chosen picture before it is uploaded.
 *
 * A phone photo is several megabytes; a profile picture needs a few hundred
 * pixels. Re-encoding as a small JPEG keeps the stored photo around 50 KB,
 * well under the API's cap, and — because it is redrawn on a canvas — drops
 * the EXIF block, so the location a phone embeds never leaves the device.
 */
export const PHOTO_MAX_SIDE = 512;
const PHOTO_QUALITY = 0.85;

export async function resizeImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('Canvas is not available');
    }
    context.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(new Error('The image could not be encoded'));
          else resolve(blob);
        },
        'image/jpeg',
        PHOTO_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
