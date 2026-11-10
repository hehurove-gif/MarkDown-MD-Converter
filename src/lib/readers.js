/* Lectores de archivos (solo navegador). La lógica de conversión está en convert.js. */
import Tesseract from 'tesseract.js';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { DOCX_STYLE_MAP } from './docxStyles.js';
import { fallbackPageToMarkdown, htmlToMarkdown, isSlideDeck, pdfPagesToMarkdown, plainTextToMarkdown, toPdfItems } from './convert.js';
import { MAX_VISION_PAGES, VISION_MAX_SIDE, transcribePages } from './vision.js';

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
      styleMap: DOCX_STYLE_MAP,
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

function canvasToJpegBase64(canvas) {
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// Página de PDF -> JPEG con el lado mayor de hasta VISION_MAX_SIDE px (el máximo útil para la IA).
async function pageToJpeg(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, VISION_MAX_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvasToJpegBase64(canvas);
}

async function imageFileToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, VISION_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvasToJpegBase64(canvas);
}

async function readPdfWithAi(pdf, pages, options, onProgress) {
  const { ai, signal } = options;
  if (pdf.numPages > MAX_VISION_PAGES) {
    throw new Error(`La lectura con IA admite hasta ${MAX_VISION_PAGES} páginas y este PDF tiene ${pdf.numPages}. Divídelo en partes o desactiva la lectura con IA.`);
  }

  const slides = isSlideDeck(pages);
  const label = slides ? 'Diapositiva' : 'Página';
  onProgress?.(`Leyendo con IA: 0 de ${pdf.numPages}…`);

  const results = await transcribePages({
    pages: pages.map((p) => ({
      number: p.number,
      hint: p.items.map((i) => i.str).join(' '),
      getImage: async () => pageToJpeg(await pdf.getPage(p.number)),
    })),
    ai,
    label,
    total: pdf.numPages,
    signal,
    onProgress: (done, total) => onProgress?.(`Leyendo con IA: ${done} de ${total}…`),
  });

  let failed = 0;
  let empty = 0;
  const out = results.map((result, i) => {
    if (result.markdown) return result.markdown;
    if (result.error) {
      failed += 1;
      return `${fallbackPageToMarkdown(pages[i], result.number, slides)}

*[La IA no pudo leer esta página (${result.error}); se usó la lectura local.]*`;
    }
    empty += 1;
    return '';
  });

  const markdown = out.filter(Boolean).join('\n\n').trim();
  const notes = [`Leído con IA (${ai.model}): puede contener errores, revísalo antes de usarlo.`];
  if (failed) notes.push(`${failed} páginas fallaron y se leyeron con el método local.`);
  if (empty) notes.push(`${empty} páginas sin contenido informativo se omitieron.`);
  if (results.stopped) notes.push(`Se detuvo antes de terminar: ${results.stopped}`);
  return { markdown, note: notes.join(' ') };
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

const IMAGE_OPS = () => {
  const { OPS } = pdfjsLib;
  return new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((op) => op !== undefined));
};

// Lista de operaciones de la página: sirve para contar imágenes y para que pdf.js cargue las tipografías reales
// (así se puede saber qué texto está en negrita, cursiva o monoespaciado).
async function pageFontsAndImages(page, content) {
  const list = await page.getOperatorList();
  const imageOps = IMAGE_OPS();
  const imageCount = list.fnArray.filter((fn) => imageOps.has(fn)).length;
  const fonts = {};
  new Set(content.items.map((item) => item.fontName)).forEach((id) => {
    try {
      if (id && page.commonObjs.has(id)) fonts[id] = page.commonObjs.get(id)?.name;
    } catch {
      // Sin datos de la tipografía: se queda sin negrita/cursiva.
    }
  });
  return { imageCount, fonts };
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

async function readPdf(file, onProgress, options = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  let characters = 0;

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let details = { imageCount: 0, fonts: {} };
    try {
      details = await pageFontsAndImages(page, content);
    } catch (error) {
      console.error(error);
    }
    const items = toPdfItems(content, details.fonts);
    const chars = items.reduce((sum, item) => sum + item.str.trim().length, 0);
    characters += chars;
    pages.push({ number: n, items, chars, width, height, imageCount: chars < OCR_MIN_CHARS ? details.imageCount : 0 });
  }

  if (options.ai) {
    const result = await readPdfWithAi(pdf, pages, options, onProgress);
    if (!result.markdown) throw new Error(EMPTY_MESSAGE);
    return result;
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

async function readImage(file, onProgress, options = {}) {
  if (options.ai) {
    onProgress?.('Leyendo la imagen con IA…');
    const [result] = await transcribePages({
      pages: [{ number: 1, hint: '', getImage: () => imageFileToJpeg(file) }],
      ai: options.ai,
      label: '',
      total: 1,
      signal: options.signal,
    });
    if (result.error) throw new Error(result.error);
    if (!result.markdown) throw new Error(EMPTY_MESSAGE);
    return { markdown: result.markdown, note: `Leído con IA (${options.ai.model}): puede contener errores, revísalo antes de usarlo.` };
  }
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
