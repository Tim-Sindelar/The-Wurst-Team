export const maxProfilePhotoBytes = 12 * 1024 * 1024;
export const maxProfilePhotoPixels = 16_000_000;
export const defaultPhotoCrop = { x: 0, y: 0, zoom: 1 };
export type PhotoCrop = typeof defaultPhotoCrop;
export type ProfilePhotoSource = {
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
};

export function photoCropRect(width: number, height: number, crop: PhotoCrop) {
  const size = Math.min(width, height) / Math.max(1, Math.min(3, crop.zoom));
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return {
    x: ((width - size) / 2) * (1 - clamp(crop.x)),
    y: ((height - size) / 2) * (1 - clamp(crop.y)),
    size,
  };
}

export async function loadProfilePhoto(
  url: string,
): Promise<ProfilePhotoSource> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error(
      'That photo could not be opened. Try another JPEG, PNG or WebP.',
    );
  }
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error('That photo could not be opened. Try another photo.');
  if (image.naturalWidth * image.naturalHeight > maxProfilePhotoPixels)
    throw new Error(
      'This photo is too large to process. Choose a smaller version.',
    );
  return { url, image, width: image.naturalWidth, height: image.naturalHeight };
}

/** A square image keeps the chosen framing identical in every circular avatar. */
export async function croppedProfilePhoto(
  source: ProfilePhotoSource,
  crop: PhotoCrop,
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Could not prepare your photo. Please try again.');
  const rect = photoCropRect(source.width, source.height, crop);
  context.drawImage(
    source.image,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(
              new Error('Could not prepare your photo. Please try again.'),
            ),
      'image/png',
    );
  });
  return new File([blob], 'profile-photo.png', { type: 'image/png' });
}
