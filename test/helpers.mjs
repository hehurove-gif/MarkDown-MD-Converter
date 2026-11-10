import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { parseHTML } from 'linkedom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { htmlToMarkdown, pdfPagesToMarkdown, toPdfItems } from '../src/lib/convert.js';
import { DOCX_STYLE_MAP } from '../src/lib/docxStyles.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export async function docxToMarkdown(name) {
  const result = await mammoth.convertToHtml(
    { buffer: fs.readFileSync(fixture(name)) },
    { styleMap: DOCX_STYLE_MAP, convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) },
  );
  const { document } = parseHTML(`<!doctype html><html><body>${result.value}</body></html>`);
  return htmlToMarkdown(document.body);
}

export async function pdfToMarkdown(name) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(fixture(name))), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    await page.getOperatorList();
    const fonts = {};
    new Set(content.items.map((i) => i.fontName)).forEach((id) => {
      if (page.commonObjs.has(id)) fonts[id] = page.commonObjs.get(id)?.name;
    });
    pages.push({ items: toPdfItems(content, fonts), width, height });
  }
  return pdfPagesToMarkdown(pages);
}
