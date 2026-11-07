# Markdown MD Converter

Una aplicación web para convertir archivos de texto comunes a Markdown con un enfoque IA-friendly: más legible, más limpio y más fácil de consumir por modelos de lenguaje, herramientas de análisis y asistentes inteligentes.

## Funcionalidades
- TXT a Markdown
- Word (.docx) a Markdown
- PDF a Markdown
- Imágenes con OCR (.png, .jpg, .jpeg) a Markdown
- Limpieza inteligente de texto y eliminación de ruido
- Markdown optimizado para lectura por IA
- Vista previa del resultado
- Copiar al portapapeles
- Descargar como `.md`
- Diseño responsivo con Tailwind CSS
- Se despliega como Worker de Cloudflare con Wrangler

## Stack
- React + Vite
- Tailwind CSS
- `mammoth` para Word
- `pdfjs-dist` para PDFs
- `tesseract.js` para OCR

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Despliegue en Cloudflare (Workers)

La app se sirve como Worker con archivos estáticos (`wrangler.jsonc`). Conecta el repositorio desde Cloudflare (Workers → Create → Import a repository) con estos valores:

| Campo | Valor |
|---|---|
| Nombre del Worker | `markdown-md-converter` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Opcional: variable de entorno `NODE_VERSION=20`. Cada push a la rama principal despliega solo.

## Cuando `hetor.dev` esté en Cloudflare (hetor.dev/tools/markdown)

1. En Cloudflare → Worker `markdown-md-converter` → Settings → Build: variable `VITE_BASE_PATH=/tools/markdown/`
   y Deploy command `npx wrangler deploy -c wrangler.domain.jsonc`.
2. Lanza un nuevo despliegue. La ruta `hetor.dev/tools/markdown*` tiene prioridad sobre el Worker de Hetor.

Probar en local: `VITE_BASE_PATH=/tools/markdown/ npm run build`.

## Notas
- Para texto estructurado, la app intenta convertir párrafos, listas, títulos y bloques legibles en una versión más amigable para IA.
- El OCR (imágenes y PDFs escaneados) descarga el motor y el idioma la primera vez (~20 MB), así que necesita internet esa vez. Los PDF escaneados se leen hasta 30 páginas.
- Tu archivo se procesa en tu navegador y no se sube a ningún servidor.
- Los `.doc` antiguos no se pueden leer en el navegador: ábrelo en Word y guárdalo como `.docx`.
