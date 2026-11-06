import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import Tesseract from 'tesseract.js';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import './index.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const allowedTypes = ['.txt', '.doc', '.docx', '.pdf', '.png', '.jpg', '.jpeg'];

function cleanWhitespace(value) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripNoise(text) {
  return text
    .replace(/\bPage\s*\d+\s*(of\s*\d+)?\b/gi, '')
    .replace(/\b(?:copyright|all rights reserved)\b/gi, '')
    .replace(/[-*_]{3,}/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function isLikelyHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^[-*•]\s+/.test(trimmed)) return false;
  if (/^\d+([.)])\s+/.test(trimmed)) return false;
  if (/^[#>]/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;

  const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, '').length;
  if (letters < 8) return false;

  const hasCaps = words.filter((word) => /^[A-ZÁÉÍÓÚÑ]/.test(word)).length;
  return hasCaps >= Math.min(2, words.length) || /[A-Z]{2,}/.test(trimmed);
}

function isListItem(line) {
  return /^[-*•]\s+/.test(line) || /^\d+\.[\s\t]+/.test(line);
}

function escapeMarkdown(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function convertRawTextToMarkdown(rawText) {
  const cleaned = stripNoise(cleanWhitespace(rawText));
  if (!cleaned) return '';

  const blocks = cleaned
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const markdownBlocks = [];

  for (const block of blocks) {
    const lines = block
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    if (lines.length > 1 && lines.every((line) => isListItem(line))) {
      markdownBlocks.push(
        lines
          .map((line) => {
            const normalized = line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');
            return `- ${normalized}`;
          })
          .join('\n'),
      );
      continue;
    }

    if (lines.length > 1 && lines.every((line) => isLikelyHeading(line))) {
      markdownBlocks.push(
        lines
          .map((line) => `## ${line}`)
          .join('\n\n'),
      );
      continue;
    }

    if (lines.length === 1) {
      const single = lines[0];
      if (/^#{1,6}\s+/.test(single)) {
        markdownBlocks.push(single);
        continue;
      }
      if (isLikelyHeading(single)) {
        markdownBlocks.push(`# ${single}`);
        continue;
      }
      if (isListItem(single)) {
        const normalized = single.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');
        markdownBlocks.push(`- ${normalized}`);
        continue;
      }
      markdownBlocks.push(escapeMarkdown(single));
      continue;
    }

    const paragraph = lines
      .map((line) => escapeMarkdown(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    markdownBlocks.push(paragraph);
  }

  return markdownBlocks.join('\n\n').trim();
}

async function readTxt(file) {
  const text = await file.text();
  return convertRawTextToMarkdown(text);
}

async function readDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return convertRawTextToMarkdown(result.value || '');
}

async function readPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let pagesText = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      pagesText += `\n\n${pageText}`;
    }
  }

  return convertRawTextToMarkdown(pagesText);
}

async function readImageWithOcr(file, onProgress) {
  const { data } = await Tesseract.recognize(file, 'eng', {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onProgress?.(`OCR en progreso: ${(message.progress * 100).toFixed(0)}%`);
      }
    },
  });

  return convertRawTextToMarkdown(data.text || '');
}

async function readLegacyDoc(file) {
  const text = await file.text();
  return convertRawTextToMarkdown(text);
}

function detectConverter(fileName) {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.txt')) return readTxt;
  if (lower.endsWith('.docx')) return readDocx;
  if (lower.endsWith('.pdf')) return readPdf;
  if (lower.endsWith('.doc')) return readLegacyDoc;
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return readImageWithOcr;

  throw new Error('Formato no soportado. Usa .txt, .doc, .docx, .pdf, .png o .jpg.');
}

function App() {
  const inputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [status, setStatus] = useState('Listo para convertir.');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileLabel = useMemo(() => {
    if (!selectedFile) return 'Sin archivo seleccionado';
    return selectedFile.name;
  }, [selectedFile]);

  const handleFile = (file) => {
    if (!file) return;

    const extension = `.${file.name.split('.').pop().toLowerCase()}`;
    if (!allowedTypes.includes(extension)) {
      setStatus('Formato no permitido. Usa TXT, DOC, DOCX, PDF, PNG o JPG.');
      return;
    }

    setSelectedFile(file);
    setStatus(`${file.name} listo para convertir.`);
  };

  const convertDocument = async () => {
    if (!selectedFile) {
      setStatus('Primero sube un archivo.');
      return;
    }

    setIsProcessing(true);
    setStatus('Procesando documento...');

    try {
      const converter = detectConverter(selectedFile.name);
      const converted = await converter(selectedFile, (message) => setStatus(message));
      setMarkdown(converted);
      setStatus('¡Conversión exitosa y lista para IA!');
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'No se pudo procesar el archivo.');
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async () => {
    if (!markdown.trim()) {
      setStatus('No hay contenido para copiar.');
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
      setStatus('Markdown copiado al portapapeles.');
    } catch {
      setStatus('No se pudo copiar automáticamente. Puedes copiarlo manualmente.');
    }
  };

  const downloadMarkdown = () => {
    if (!markdown.trim()) {
      setStatus('No hay contenido para descargar.');
      return;
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = (selectedFile?.name || 'document').replace(/\.[^.]+$/, '');
    link.href = url;
    link.download = `${baseName}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Archivo .md descargado.');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),transparent_20%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.14),transparent_28%),#020817] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div className="inline-flex items-center gap-4 rounded-[28px] border border-slate-700/80 bg-slate-900/70 px-5 py-4 shadow-soft backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-400 to-emerald-400 font-black text-slate-950 shadow-lg shadow-cyan-500/20">
              MD
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">IA-friendly</p>
              <h1 className="text-xl font-bold sm:text-2xl">Markdown Converter</h1>
            </div>
          </div>
        </header>

        <main className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-slate-700/80 bg-slate-900/80 p-5 shadow-soft backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">1. Sube tu archivo</h2>
            </div>

            <div
              className={`group cursor-pointer rounded-3xl border border-dashed p-6 text-center transition-all ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-500/5 shadow-lg shadow-cyan-500/10'
                  : 'border-slate-600 bg-slate-950/40 hover:border-cyan-400/80 hover:bg-slate-950/60'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files?.[0];
                handleFile(file);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".txt,.doc,.docx,.pdf,.png,.jpg,.jpeg"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <div className="flex flex-col items-center justify-center gap-3">
                <span className="text-5xl">📄</span>
                <div>
                  <p className="text-lg font-semibold text-white">Arrastra un archivo aquí</p>
                  <p className="mt-1 text-sm text-slate-400">o haz clic para buscarlo en tu equipo.</p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
                <span className="truncate">{fileLabel}</span>
              </div>
              <button
                type="button"
                onClick={convertDocument}
                disabled={!selectedFile || isProcessing}
                className="rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isProcessing ? 'Procesando...' : 'Convertir'}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
              {status}
            </div>

            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-300">
              {['.txt', '.docx', '.doc', '.pdf', '.png', '.jpg'].map((format) => (
                <span key={format} className="rounded-full border border-slate-700 bg-slate-950/40 px-2.5 py-1">
                  {format}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-700/80 bg-slate-900/80 p-5 shadow-soft backdrop-blur-md">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">2. Resultado Markdown</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="rounded-xl border border-slate-600 bg-slate-950/40 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-400 hover:text-cyan-300"
                >
                  Copiar
                </button>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-xl border border-slate-600 bg-slate-950/40 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Descargar .md
                </button>
              </div>
            </div>

            <textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="Aquí aparecerá el contenido convertido a Markdown..."
              className="min-h-[540px] w-full resize-y rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-sm leading-7 text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
            />
          </section>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
