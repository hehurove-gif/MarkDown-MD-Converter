# Markdown MD Converter

Una aplicación web para convertir archivos de texto comunes a Markdown, con el objetivo de que el contenido sea más fácil de leer y procesar por IA.

## Funcionalidades
- TXT a Markdown
- Word (.doc / .docx) a Markdown
- PDF a Markdown
- Vista previa del Markdown generado
- Copiar al portapapeles
- Descargar como `.md`
- Diseño responsivo con Tailwind CSS
- Preparado para desplegar en Cloudflare Pages con Wrangler

## Stack recomendado
- React + Vite
- Tailwind CSS
- `mammoth` para archivos Word
- `pdfjs-dist` para PDFs

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

## Despliegue en Cloudflare Pages

1. Instala Wrangler si aún no lo tienes:

```bash
npm install -D wrangler
```

2. Inicia sesión con Cloudflare:

```bash
npx wrangler login
```

3. Compila el proyecto:

```bash
npm run build
```

4. Despliega en Cloudflare Pages:

```bash
npx wrangler pages deploy dist --project-name markdown-md-converter
```

También puedes usar el script:

```bash
npm run deploy
```

## Nota
Para archivos `.doc` antiguos, la extracción depende del navegador y puede no ser completamente fiable. Para mejores resultados, usa `.docx` o `.pdf`.
