import test from 'node:test';
import assert from 'node:assert/strict';
import { plainTextToMarkdown } from '../src/lib/convert.js';
import { docxToMarkdown, pdfToMarkdown } from './helpers.mjs';

/* ---------- TXT ---------- */

test('TXT: conserva niveles de lista y convierte a)/b) en subnivel', () => {
  assert.equal(plainTextToMarkdown('- a\n  - b\n    - c\n- d'), '- a\n   - b\n      - c\n- d');
  assert.match(plainTextToMarkdown('1) Descargar\n2) Instalar\n    a) paso\n    b) otro'), /2\. Instalar\n   - paso\n   - otro/);
});

test('TXT: bloque con sangría = código; columnas alineadas = tabla; ASCII = tabla', () => {
  assert.match(plainTextToMarkdown('Ejemplo:\n\n    npm install\n    npm run build\n\nFin.'), /```\nnpm install\nnpm run build\n```/);
  assert.equal(plainTextToMarkdown('Nombre   Edad\nAna      20\nLuis     31'), '| Nombre | Edad |\n| --- | --- |\n| Ana | 20 |\n| Luis | 31 |');
  assert.equal(plainTextToMarkdown('+---+---+\n| A | B |\n+---+---+\n| 1 | 2 |\n+---+---+'), '| A | B |\n| --- | --- |\n| 1 | 2 |');
});

test('TXT: subrayados ==== y ---- son títulos', () => {
  assert.equal(plainTextToMarkdown('Título\n======\n\nSub\n---\n\nTexto.'), '# Título\n\n## Sub\n\nTexto.');
});

test('TXT: párrafos partidos a mano se unen y el Markdown existente se respeta', () => {
  assert.equal(plainTextToMarkdown('Esto es un párrafo partido a mano en líneas largas para que quepa bien\nen una terminal clásica y debe quedar unido en uno solo.'), 'Esto es un párrafo partido a mano en líneas largas para que quepa bien en una terminal clásica y debe quedar unido en uno solo.');
  const md = '# T\n\n```js\nconst a  =   1;\n```';
  assert.equal(plainTextToMarkdown(md), md);
});

/* ---------- DOCX ---------- */

test('DOCX (Word): formato en línea, subíndices, tachado y jerarquía con Título', async () => {
  const md = await docxToMarkdown('word-features.docx');
  assert.match(md, /^# Informe de Prueba\n\n\*Subtítulo del informe\*\n\n## 1\. Introducción/);
  assert.match(md, /\*\*negrita\*\*, \*cursiva\*/);
  assert.match(md, /H₂O y x²/);
  assert.match(md, /~~tachado~~/);
  assert.match(md, /### 1\.1 Listas/);
  assert.match(md, /\[example\.com\]\(https:\/\/example\.com\)/);
});

test('DOCX (Word): tablas con celdas unidas y pipes escapados', async () => {
  const md = await docxToMarkdown('word-features.docx');
  assert.match(md, /\| Luis \\\| pipe \| 31 \| Cancún segunda línea \|/);
  assert.match(md, /\| Título combinado \|  \|  \|/);
});

test('DOCX (Pandoc): listas anidadas, cita, código con sangría, nota al pie', async () => {
  const md = await docxToMarkdown('pandoc-features.docx');
  assert.match(md, /- A\n   - A1\n   - A2\n      - A2x\n- B/);
  assert.match(md, /1\. Uno\n   1\. Uno-a/);
  assert.match(md, /> Una cita larga/);
  assert.match(md, /```\ndef f\(x\):\n    return x \* 2\n```/);
  assert.match(md, /`código`/);
  assert.match(md, /nota al pie\[1\]/);
  assert.match(md, /---\n\n\[1\] Texto de la nota al pie\.$/);
  assert.doesNotMatch(md, /↑/);
});

/* ---------- PDF de documento ---------- */

test('PDF: dos columnas se leen una tras otra y el párrafo cruza de columna', async () => {
  const md = await pdfToMarkdown('informe-columnas.pdf');
  const order = [1, 2, 3, 4, 5, 6].map((n) => md.indexOf(`Párrafo ${n} de la discusión`));
  assert.ok(order.every((v) => v > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(md, /\n\nleerse columna por columna\.\n\nPárrafo 6/);
  assert.doesNotMatch(md, /Revista de Pruebas|Página \d/); // encabezado y pie repetidos
});

test('PDF: tabla, listas separadas (viñetas / numerada) y títulos', async () => {
  const md = await pdfToMarkdown('informe-columnas.pdf');
  assert.match(md, /\| Grupo \| Media \| Desv\. \|\n\| --- \| --- \| --- \|\n\| Control \| 4\.5 \| 0\.3 \|/);
  assert.match(md, /- Análisis estadístico\n\n1\. Primer paso\n2\. Segundo paso/);
  assert.match(md, /^# Análisis de Resultados/);
  assert.match(md, /\n## 1\.2 Resultados\n/);
});

test('PDF (LibreOffice): listas con niveles, tabla, código y subíndices', async () => {
  const md = await pdfToMarkdown('pandoc-features.pdf');
  assert.match(md, /- A\n   - A1\n   - A2\n      - A2x\n- B/);
  assert.match(md, /```\ndef f\(x\):\n    return x \* 2\n```/);
  assert.match(md, /\| Col A \| Col B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  assert.match(md, /H₂O y x²/);
  assert.match(md, /`código`/);
});

test('PDF (Word): negritas/cursivas en línea, títulos separados del párrafo y celdas partidas', async () => {
  const md = await pdfToMarkdown('word-features.pdf');
  assert.match(md, /###? 1\. Introducción\n\nEste es un párrafo con \*\*negrita\*\*, \*cursiva\*/);
  assert.match(md, /- Uno\n- Dos\n   - Sub A\n   - Sub B\n- Tres/);
  assert.match(md, /\| Luis \\\| pipe \| 31 \| Cancún segunda línea \|/);
  assert.doesNotMatch(md, /(^|[^`])``([^`]|$)/); // sin código vacío (la viñeta no es código)
});
