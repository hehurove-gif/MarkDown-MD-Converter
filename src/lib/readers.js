/* Lectores de archivos (solo navegador). La lógica de conversión está en convert.js. */
import Tesseract from 'tesseract.js';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { htmlToMarkdown, isSlideDeck, pdfPagesToMarkdown, plainTextToMarkdown, toPdfItems } from './convert.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const OCR_LANGS = 'spa+eng';
const OCR_MAX_PAGES = 30;
// Una página con menos texto que esto, pero con imágenes, se considera "solo imagen" y se lee con OCR.
const OCR_MIN_CHARS = 40;
const OCR_LOAD_TIMEOUT_MS = 120000;
const EMPTY_MESSAGE = 'No se encontró texto en el archivo.';

export const supportedExtensions = ['.txt', '.docx', '.pdf', '.png', '.jpg', '.jpeg'];

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Archivos antiguos guardados en Windows-1252 / Latin-1.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// El motor de OCR y el idioma se descargan la primera vez (~20 MB). Si no cargan, se avisa en vez de quedarse esperando.
function createOcrWorker(onProgress, label = '') {
  onProgress?.('Cargando el motor de OCR (la primera vez puede tardar)…');
  return withTimeout(
    Tesseract.createWorker(OCR_LANGS, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(`${label}Reconociendo texto (OCR): ${Math.round(m.progress * 100)}%`);
      },
    }),
    OCR_LOAD_TIMEOUT_MS,
    'No se pudo cargar el motor de OCR. Necesita conexión a internet la primera vez; revisa tu conexión e inténtalo de nuevo.',
  );
}

async function readTxt(file) {
  const markdown = plainTextToMarkdown(decodeText(await file.arrayBuffer()));
  if (!markdown) throw new Error(EMPTY_MESSAGE);
  return { markdown };
}

async function readDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      // Las imágenes no aportan texto y harían el resultado enorme.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  );
  const html = new DOMParser().parseFromString(result.value, 'text/html');
  const markdown = htmlToMarkdown(html.body);
  if (!markdown) throw new Error(EMPTY_MESSAGE);
  return { markdown };
}

async function readLegacyDoc() {
  throw new Error('Los archivos .doc antiguos no se pueden leer en el navegador. Ábrelo en Word y guárdalo como .docx.');
}

async function renderPage(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

async function ocrPdf(pdf, onProgress) {
  const total = Math.min(pdf.numPages, OCR_MAX_PAGES);
  const worker = await createOcrWorker(onProgress);
  const texts = [];
  try {
    for (let n = 1; n <= total; n += 1) {
      onProgress?.(`PDF escaneado: leyendo página ${n} de ${total}…`);
      const page = await pdf.getPage(n);
      const { data } = await worker.recognize(await renderPage(page));
      texts.push(data.text || '');
    }
  } finally {
    await worker.terminate();
  }
  const note = pdf.numPages > total ? `Solo se leyeron las primeras ${total} páginas (el PDF tiene ${pdf.numPages}).` : '';
  return { markdown: plainTextToMarkdown(texts.join('\n\n')), note };
}

async function countImages(page) {
  const { OPS } = pdfjsLib;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((op) => op !== undefined));
  const list = await page.getOperatorList();
  return list.fnArray.filter((fn) => imageOps.has(fn)).length;
}

// En muchas presentaciones hay diapositivas que son una sola imagen (texto incluido): sin OCR se perderían.
async function ocrImageOnlyPages(pdf, pages, onProgress) {
  const targets = pages.filter((p) => p.chars < OCR_MIN_CHARS && p.imageCount > 0).slice(0, OCR_MAX_PAGES);
  if (!targets.length) return '';

  let worker;
  try {
    worker = await createOcrWorker(onProgress);
  } catch (error) {
    console.error(error);
    return `${targets.length} diapositivas son solo imagen y no se pudieron leer: ${error.message}`;
  }

  let done = 0;
  try {
    for (const target of targets) {
      onProgress?.(`Diapositiva ${target.number} es solo imagen: leyéndola con OCR (${done + 1} de ${targets.length})…`);
      try {
        const page = await pdf.getPage(target.number);
        const { data } = await worker.recognize(await renderPage(page));
        target.ocrText = data.text || '';
      } catch (error) {
        console.error(error);
      }
      done += 1;
    }
  } finally {
    await worker.terminate();
  }
  return `${done} diapositivas eran solo imagen y se leyeron con OCR (pueden tener errores).`;
}

async function readPdf(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  let characters = 0;

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const items = toPdfItems(await page.getTextContent());
    const chars = items.reduce((sum, item) => sum + item.str.trim().length, 0);
    characters += chars;
    const imageCount = chars < OCR_MIN_CHARS ? await countImages(page) : 0;
    pages.push({ number: n, items, chars, width, height, imageCount });
  }

  // Sin texto seleccionable: es un PDF escaneado, se lee con OCR.
  if (characters / pdf.numPages < 15) {
    const scanned = await ocrPdf(pdf, onProgress);
    if (!scanned.markdown) throw new Error(EMPTY_MESSAGE);
    return scanned;
  }

  const note = isSlideDeck(pages) ? await ocrImageOnlyPages(pdf, pages, onProgress) : '';
  const markdown = pdfPagesToMarkdown(pages);
  if (!markdown) throw new Error(EMPTY_MESSAGE);
  return { markdown, note };
}

async function readImage(file, onProgress) {
  const worker = await createOcrWorker(onProgress);
  try {
    const { data } = await worker.recognize(file);
    const markdown = plainTextToMarkdown(data.text || '');
    if (!markdown) throw new Error(EMPTY_MESSAGE);
    return { markdown };
  } finally {
    await worker.terminate();
  }
}

export function detectReader(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.txt')) return readTxt;
  if (lower.endsWith('.docx')) return readDocx;
  if (lower.endsWith('.doc')) return readLegacyDoc;
  if (lower.endsWith('.pdf')) return readPdf;
  if (/\.(png|jpe?g)$/.test(lower)) return readImage;
  throw new Error('Formato no soportado. Usa .txt, .docx, .pdf, .png o .jpg.');
}
