/**
 * imageUtils.ts
 * Client-side image preparation for OCR: downscale (smaller payloads, kinder
 * rate limits) and a rough quality pre-check (dark / blurry warnings) so users
 * can retake before burning an API call.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export interface PreparedImage {
  /** Base64 payload WITHOUT the data-URL prefix. */
  base64: string;
  mimeType: string;
  quality: { dark: boolean; blurry: boolean };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("Could not read image")); };
    img.src = URL.createObjectURL(file);
  });
}

/** Average luminance + Laplacian variance on a small grayscale copy. */
function assessQuality(img: HTMLImageElement): { dark: boolean; blurry: boolean } {
  const side = 256;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dark: false, blurry: false };
  ctx.drawImage(img, 0, 0, side, side);
  const { data } = ctx.getImageData(0, 0, side, side);

  const gray = new Float32Array(side * side);
  let lumSum = 0;
  for (let i = 0; i < side * side; i++) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = l;
    lumSum += l;
  }
  const avgLum = lumSum / (side * side);

  // Variance of a 4-neighbor Laplacian — low variance ≈ few edges ≈ blur
  let lapSum = 0;
  let lapSqSum = 0;
  const n = (side - 2) * (side - 2);
  for (let y = 1; y < side - 1; y++) {
    for (let x = 1; x < side - 1; x++) {
      const i = y * side + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - side] - gray[i + side];
      lapSum += lap;
      lapSqSum += lap * lap;
    }
  }
  const mean = lapSum / n;
  const variance = lapSqSum / n - mean * mean;

  return { dark: avgLum < 60, blurry: variance < 100 };
}

/** Downscale, re-encode as JPEG, and run the quality pre-check. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);
  const quality = assessQuality(img);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mimeType: "image/jpeg",
    quality,
  };
}
