// Copies what pdf.js loads at run time (its image decoders, standard fonts
// and colour profile) from node_modules into public/pdfjs, so the app serves
// them and they always match the installed pdfjs-dist. Without the decoders a
// scanned PDF (a Xerox scan stores its text as JBIG2 images) draws as a blank
// page and the stub reader has nothing to read. Run before dev and build.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

if (!existsSync(from)) {
  console.warn('pdfjs-dist is not installed: PDF decoders not copied');
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const dir of ['wasm', 'standard_fonts', 'iccs']) {
  if (existsSync(join(from, dir))) cpSync(join(from, dir), join(to, dir), { recursive: true });
}
console.log('pdf.js decoders and fonts copied to public/pdfjs');
