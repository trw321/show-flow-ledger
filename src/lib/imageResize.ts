// Downscales an image client-side before sending it to a vision model. A
// full-resolution phone photo (often 3000px+ on the long edge, several MB)
// makes the upload and AI processing slow, and can trip request-size limits
// outright — capping the long edge and re-encoding as JPEG keeps text
// legible while cutting payload size dramatically.
export async function resizeImageToBase64(
  file: File,
  maxDim = 1800,
  quality = 0.85
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) {
    // Already small enough — skip re-encoding, just strip the data: prefix.
    return { base64: dataUrl.split(',')[1], mimeType: file.type };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { base64: dataUrl.split(',')[1], mimeType: file.type };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const resizedDataUrl = canvas.toDataURL('image/jpeg', quality);
  return { base64: resizedDataUrl.split(',')[1], mimeType: 'image/jpeg' };
}
