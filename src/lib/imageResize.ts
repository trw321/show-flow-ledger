// Downscales an image client-side before sending it to a vision model. A
// full-resolution phone photo (often 3000px+ on the long edge, several MB)
// makes the upload and AI processing slow, and can trip request-size limits
// outright — capping the long edge and re-encoding as JPEG keeps text
// legible while cutting payload size dramatically.
export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

async function resizeToDataUrl(file: File, maxDim: number, quality: number, force: boolean) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1 && !force) return { dataUrl, mimeType: file.type };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl, mimeType: file.type };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), mimeType: 'image/jpeg' };
}

export async function resizeImageToBase64(
  file: File,
  maxDim = 1800,
  quality = 0.85
): Promise<{ base64: string; mimeType: string }> {
  const { dataUrl, mimeType } = await resizeToDataUrl(file, maxDim, quality, false);
  return { base64: dataUrl.split(',')[1], mimeType };
}

// Storage variant. Attachments are kept as data URIs in localStorage, which
// has a hard ~5MB budget shared by every job, expense and income record — a
// single untouched phone photo can exceed it alone and take the whole app
// down, so anything sizeable is always re-encoded, not just oversized ones.
export async function resizeImageForStorage(
  file: File,
  maxDim = 2000,
  quality = 0.8
): Promise<string> {
  const { dataUrl } = await resizeToDataUrl(file, maxDim, quality, file.size > 400 * 1024);
  return dataUrl;
}
