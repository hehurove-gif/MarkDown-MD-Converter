import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { detectReader, supportedExtensions } from './lib/readers.js';
import './index.css';

const acceptedExtensions = [...supportedExtensions, '.doc'];

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
    if (!acceptedExtensions.includes(extension)) {
      setStatus('Formato no permitido. Usa TXT, DOCX, PDF, PNG o JPG.');
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
      const reader = detectReader(selectedFile.name);
      const result = await reader(selectedFile, (message) => setStatus(message));
      setMarkdown(result.markdown);
      setStatus(result.note ? `Listo. ${result.note}` : '¡Conversión exitosa y lista para IA!');
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
                accept={acceptedExtensions.join(',')}
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
              {['.txt', '.docx', '.pdf', '.png', '.jpg'].map((format) => (
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
            {markdown && (
              <p className="mt-3 text-xs text-slate-400">
                {markdown.length.toLocaleString('es-MX')} caracteres · aprox. {Math.ceil(markdown.length / 4).toLocaleString('es-MX')} tokens
                · tu archivo se procesa en tu navegador y no se sube a ningún servidor.
              </p>
            )}
          </section>
        </main>

        <footer className="mt-10 border-t border-slate-800 pt-5 text-center text-xs text-slate-400">
          Developed by{' '}
          <a href="https://hetor.hehurove.workers.dev/es" className="font-semibold text-cyan-300 hover:underline">
            Hetor
          </a>
        </footer>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
