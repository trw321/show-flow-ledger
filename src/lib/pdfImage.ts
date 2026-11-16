// OpenAI's vision API only accepts real images, not PDF bytes, so a PDF is
// rendered to an image in the browser first: up to the first few pages,
// stacked into one tall picture that then goes through the same reader as a
// screenshot. pdfjs-dist is large, so it's loaded only when a PDF is picked.
const MAX_PDF_PAGES = 4;

export async function pdfToImageDataUrl(file: File): Promise<{ dataUrl: string; truncated: boolean }> {
  const [pdfjsLib, { default: pdfjsWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const scale = 2; // render at 2x for sharper text before it goes to OCR/vision

  const canvases: HTMLCanvasElement[] = [];
  let totalHeight = 0;
  let maxWidth = 0;
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    canvases.push(canvas);
    totalHeight += canvas.height;
    maxWidth = Math.max(maxWidth, canvas.width);
  }

  const combined = document.createElement('canvas');
  combined.width = maxWidth;
  combined.height = totalHeight;
  const combinedCtx = combined.getContext('2d')!;
  combinedCtx.fillStyle = '#ffffff';
  combinedCtx.fillRect(0, 0, combined.width, combined.height);
  let y = 0;
  for (const c of canvases) {
    combinedCtx.drawImage(c, 0, y);
    y += c.height;
  }

  return { dataUrl: combined.toDataURL('image/png'), truncated: pdf.numPages > MAX_PDF_PAGES };
}
