/**
 * Turns a photo from the camera or library into something small enough to keep a thousand of:
 * a 1024 px JPEG for reading the label, and a 320 px thumbnail for lists. Orientation is honoured
 * (the browser applies the photo's EXIF rotation when it decodes), and everything is re-encoded,
 * which also strips location data from the photo.
 */

export const FULL_MAX = 1024;
export const THUMB_MAX = 320;

export interface ProcessedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a picture this browser can read.'));
    };
    img.src = url;
  });
}

function render(img: CanvasImageSource, w: number, h: number, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, max / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This browser cannot process pictures.'));
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('Could not compress the picture.'))), 'image/jpeg', quality);
  });
}

export async function processImageFile(file: Blob): Promise<ProcessedImage> {
  if (file.size === 0) throw new Error('That file is empty.');
  if (file.size > 60 * 1024 * 1024) throw new Error('That picture is too large (over 60 MB).');
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('That picture has no size.');
  const full = await render(img, w, h, FULL_MAX, 0.78);
  const thumb = await render(img, w, h, THUMB_MAX, 0.72);
  return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}

/**
 * The same shrinking for a picture that is already a canvas (the drawn sample labels): there is no
 * file to decode, so it skips the encode-then-decode round trip that would otherwise be most of the work.
 */
export async function processCanvas(canvas: HTMLCanvasElement): Promise<ProcessedImage> {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) throw new Error('That picture has no size.');
  const [full, thumb] = await Promise.all([render(canvas, w, h, FULL_MAX, 0.78), render(canvas, w, h, THUMB_MAX, 0.72)]);
  return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}
