import { toast } from 'sonner';

// OpenAI's vision API only accepts real images, not PDF bytes, so a PDF is
// rendered to an image in the browser first. pdfjs-dist is large, so it's
// loaded only when a PDF is picked.
const MAX_PDF_PAGES = 4;
/** Rendered at twice its size, for sharper text before the reader sees it. */
const SCALE = 2;

/** A PDF, by its type or, when the phone doesn't say, its name. */
export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** The first pages of a PDF, each drawn on its own canvas. */
async function renderPages(file: File, max: number): Promise<{ canvases: HTMLCanvasElement[]; total: number }> {
  const [pdfjsLib, { default: pdfjsWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    // A PDF with no background of its own is see-through: white behind it, as on paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    canvases.push(canvas);
  }
  return { canvases, total: pdf.numPages };
}

/** Up to the first few pages, stacked into one tall picture that then goes through the same reader as a screenshot. */
export async function pdfToImageDataUrl(file: File, maxPages = MAX_PDF_PAGES): Promise<{ dataUrl: string; truncated: boolean }> {
  const { canvases, total } = await renderPages(file, maxPages);
  const combined = document.createElement('canvas');
  combined.width = Math.max(1, ...canvases.map(c => c.width));
  combined.height = Math.max(1, canvases.reduce((sum, c) => sum + c.height, 0));
  const combinedCtx = combined.getContext('2d')!;
  combinedCtx.fillStyle = '#ffffff';
  combinedCtx.fillRect(0, 0, combined.width, combined.height);
  let y = 0;
  for (const c of canvases) {
    combinedCtx.drawImage(c, 0, y);
    y += c.height;
  }
  return { dataUrl: combined.toDataURL('image/png'), truncated: total > maxPages };
}

/**
 * Each page of a PDF as a picture of its own, for a reader that goes a page
 * at a time. Pages stacked into one picture get shrunk to fit the reader,
 * and past two or three the writing is too small to read.
 */
export async function pdfPageImages(file: File, maxPages = 10): Promise<{ pages: string[]; total: number }> {
  const { canvases, total } = await renderPages(file, maxPages);
  return { pages: canvases.map(c => c.toDataURL('image/jpeg', 0.92)), total };
}

/**
 * A picked file as a picture, for the readers that take one: an image as it
 * is, a PDF as its first two pages in one image (a receipt, an offer, a
 * timesheet is a page or two). Null, having said why, when a PDF can't be
 * opened.
 */
export async function asImage(file: File, maxPages = 2): Promise<File | null> {
  if (!isPdf(file)) return file;
  try {
    const { dataUrl, truncated } = await pdfToImageDataUrl(file, maxPages);
    if (truncated) toast.info(`Only the first ${maxPages} pages of the PDF were read`);
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
  } catch (err) {
    console.error(err);
    toast.error('Could not open that PDF');
    return null;
  }
}
