/* Lógica de conversión a Markdown. Son funciones puras (sin React ni librerías del navegador)
   para poder probarlas con documentos reales desde Node. Los lectores de archivos viven en readers.js. */

import { BULLET, NUMBERED, NUMBERED_HEADING, SENTENCE_END } from './patterns.js';
import { documentToMarkdown } from './pdfdoc.js';

/* ---------- Texto plano ---------- */

export function normalizeText(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/\f/g, '\n\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function isHeadingLine(text) {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (SENTENCE_END.test(t)) return false;
  const clean = t.replace(/:$/, '');
  if (clean.split(/\s+/).length > 10) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(clean)) return false;
  if (!/^[A-ZÁÉÍÓÚÑÜ0-9¿¡]/.test(clean)) return false;
  // Empieza con número: solo cuenta si es numeración de sección ("2. Requisitos", "1.1 Alcance").
  if (/^\d/.test(clean) && !NUMBERED_HEADING.test(clean)) return false;
  return true;
}

function headingLevel(text, isFirst) {
  if (isFirst) return 1;
  const m = text.match(NUMBERED_HEADING);
  if (m) return Math.min(m[1].split('.').length + 1, 5);
  return 2;
}

function joinParagraph(lines) {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length <= 1) return trimmed[0] || '';
  const avg = trimmed.reduce((sum, l) => sum + l.length, 0) / trimmed.length;
  // Líneas muy cortas (versos, direcciones): se conserva cada salto de línea.
  const hyphenated = trimmed.slice(0, -1).some((l) => /[A-Za-zÀ-ÿ]-$/.test(l));
  if (avg < 42 && !hyphenated && trimmed.every((l) => l.length < 70)) return trimmed.join('\n');
  let out = trimmed[0];
  for (let i = 1; i < trimmed.length; i += 1) {
    const next = trimmed[i];
    if (/[A-Za-zÀ-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(next)) out = out.slice(0, -1) + next;
    else out = `${out} ${next}`;
  }
  return out;
}

function lineKind(line) {
  const t = line.trim();
  if (/^#{1,6}\s+\S/.test(t)) return 'heading';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return 'rule';
  if (BULLET.test(t)) return 'bullet';
  if (NUMBERED.test(t)) return 'number';
  if (/^>/.test(t)) return 'quote';
  if (/^\|.*\|$/.test(t)) return 'table';
  return 'text';
}

const squeeze = (text) => text.replace(/(\S) {2,}/g, '$1 ');
const indentOf = (line) => line.match(/^ */)[0].length;
const LETTER_ITEM = /^[a-z][.)]\s+\S/i;
const escapeCell = (text) => text.replace(/\|/g, '\\|');

function rowsToTable(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (row) => [...row, ...Array(width - row.length).fill('')].map(escapeCell);
  const line = (row) => `| ${pad(row).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

// Columnas alineadas con espacios (o tabuladores): "Nombre   Edad   Ciudad".
function alignedTable(lines) {
  if (lines.length < 2 || lines.some((l) => indentOf(l) >= 4 || lineKind(l) !== 'text')) return null;
  const rows = lines.map((l) => l.trim().split(/ {2,}/));
  const n = rows[0].length;
  if (n < 2 || n > 8 || rows.some((r) => r.length !== n)) return null;
  const cells = rows.flat();
  if (cells.reduce((sum, c) => sum + c.length, 0) / cells.length > 32) return null;
  return rowsToTable(rows);
}

function convertBlock(lines, { isFirst, hasNext }) {
  const first = lines[0].trim();

  // Bloque con sangría de 4 o más espacios (y sin viñetas): es código.
  if (lines.every((l) => indentOf(l) >= 4 && !BULLET.test(l.trim()) && !NUMBERED.test(l.trim()))) {
    const base = Math.min(...lines.map(indentOf));
    return `\`\`\`\n${lines.map((l) => l.slice(base)).join('\n')}\n\`\`\``;
  }

  const table = alignedTable(lines);
  if (table) return table;

  // Título suelto: una sola línea corta, sin punto final, con algo después.
  const firstKind = lineKind(first);
  const headingCandidate = firstKind === 'text' || (firstKind === 'number' && NUMBERED_HEADING.test(first));
  if (lines.length === 1 && headingCandidate && isHeadingLine(first) && (isFirst || hasNext)) {
    const text = first.replace(/:$/, '');
    return `${'#'.repeat(headingLevel(text, isFirst))} ${text}`;
  }

  const out = [];
  let para = [];
  let items = [];
  let passthrough = [];
  let levels = []; // sangrías de los niveles de la lista actual

  const flushPara = () => {
    if (para.length) out.push(joinParagraph(para));
    para = [];
  };
  const flushItems = () => {
    if (items.length) out.push(items.join('\n'));
    items = [];
    levels = [];
  };
  const flushPass = () => {
    if (passthrough.length) out.push(passthrough.join('\n'));
    passthrough = [];
  };
  const flushAll = () => {
    flushPara();
    flushItems();
    flushPass();
  };

  const levelFor = (indent) => {
    while (levels.length && indent < levels[levels.length - 1] - 1) levels.pop();
    if (!levels.length || indent > levels[levels.length - 1] + 1) levels.push(indent);
    return levels.length - 1;
  };

  lines.forEach((line, index) => {
    const t = squeeze(line.trim());
    let kind = lineKind(line);
    const indent = indentOf(line);
    // "a) paso" con sangría, dentro de una lista: subnivel.
    const letterItem = kind === 'text' && indent >= 2 && items.length > 0 && LETTER_ITEM.test(t);
    if (letterItem) kind = 'bullet';

    if (kind === 'bullet' || kind === 'number') {
      flushPara();
      flushPass();
      const depth = '   '.repeat(levelFor(indent));
      if (letterItem) items.push(`${depth}- ${t.replace(/^[a-z][.)]\s+/i, '')}`);
      else items.push(kind === 'bullet' ? `${depth}- ${t.replace(BULLET, '')}` : `${depth}${t.match(NUMBERED)[1]}. ${t.replace(NUMBERED, '')}`);
      return;
    }

    if (kind === 'text') {
      if (items.length) {
        const previous = items[items.length - 1];
        const indented = /^\s{2,}/.test(line);
        if (indented || !SENTENCE_END.test(previous)) {
          items[items.length - 1] = `${previous} ${t}`;
          return;
        }
        flushItems();
      }
      flushPass();
      // Título pegado a una lista o a un párrafo ("Requisitos" + "- Node.js").
      if (index === 0 && lines.length > 1 && isHeadingLine(t) && ['bullet', 'number'].includes(lineKind(lines[1]))) {
        out.push(`${'#'.repeat(headingLevel(t, isFirst))} ${t.replace(/:$/, '')}`);
        return;
      }
      para.push(t);
      return;
    }

    if (kind === 'quote' || kind === 'table') {
      flushPara();
      flushItems();
      passthrough.push(t);
      return;
    }

    flushAll();
    out.push(t);
  });

  flushAll();
  return out.join('\n\n');
}

// Tablas dibujadas con +---+ y | | se pasan a tabla Markdown; los subrayados ==== y ---- bajo una línea son títulos.
function preprocessText(text) {
  const lines = text.split('\n');
  const out = [];
  const isBorder = (l) => /^\s*\+[-=+]{3,}\+\s*$/.test(l);
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isBorder(line)) {
      let j = i;
      const rows = [];
      while (j < lines.length && (isBorder(lines[j]) || isRow(lines[j]))) {
        if (isRow(lines[j])) rows.push(lines[j].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        j += 1;
      }
      if (rows.length) {
        out.push('', rowsToTable(rows), '');
        i = j - 1;
        continue;
      }
    }

    const next = lines[i + 1];
    const before = out.length ? out[out.length - 1] : '';
    const plainLine = line.trim() && lineKind(line) === 'text' && !before.trim() && line.trim().length <= 100;
    if (plainLine && next !== undefined && /^={3,}\s*$/.test(next)) {
      out.push(`# ${line.trim()}`);
      i += 1;
      continue;
    }
    if (plainLine && next !== undefined && /^-{3,}\s*$/.test(next)) {
      out.push(`## ${line.trim()}`);
      i += 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function plainTextToMarkdown(raw) {
  const text = normalizeText(raw || '').trim();
  if (!text) return '';

  // Los bloques ``` ya escritos se conservan tal cual.
  const parts = [];
  const fence = /^```[^\n]*\n[\s\S]*?^```[ ]*$/gm;
  let last = 0;
  let match;
  while ((match = fence.exec(text))) {
    if (match.index > last) parts.push({ code: false, text: text.slice(last, match.index) });
    parts.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });

  const blocks = [];
  for (const part of parts) {
    if (part.code) {
      blocks.push({ raw: part.text });
      continue;
    }
    preprocessText(part.text)
      .split(/\n[ ]*\n/)
      .map((b) => b.replace(/^\n+|\n+$/g, ''))
      .filter((b) => b.trim())
      .forEach((b) => blocks.push({ lines: b.split('\n') }));
  }

  return blocks
    .map((block, i) => (block.raw ? block.raw : convertBlock(block.lines, { isFirst: i === 0, hasNext: i < blocks.length - 1 })))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/* ---------- Word (HTML de mammoth -> Markdown) ---------- */

const ELEMENT = 1;
const TEXT = 3;

function wrapMarks(inner, mark) {
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)[0];
  const trail = inner.match(/\s*$/)[0];
  return `${lead}${mark}${inner.trim()}${mark}${trail}`;
}

const SUB_LETTERS = { a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', '=': '₌' };
const SUP_LETTERS = {
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', '=': '⁼',
};

// Sub/superíndice de Word: si todos sus caracteres existen en Unicode se escribe así (H₂O, x²); si no, con <sub>/<sup>.
function scriptText(text, digits, letters, tag) {
  const t = text.trim();
  if (!t) return text;
  if (/^\[\d+\]$/.test(t)) return t; // referencia de nota al pie: se deja como [1]
  const chars = [...t];
  if (chars.every((c) => digits[c] || letters[c])) return chars.map((c) => digits[c] || letters[c]).join('');
  return `<${tag}>${t}</${tag}>`;
}

function inline(node) {
  if (node.nodeType === TEXT) return node.nodeValue.replace(/\s+/g, ' ');
  if (node.nodeType !== ELEMENT) return '';
  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(inline).join('');
  switch (tag) {
    case 'strong':
    case 'b':
      return wrapMarks(children(), '**');
    case 'em':
    case 'i':
      return wrapMarks(children(), '*');
    case 's':
    case 'del':
    case 'strike':
      return wrapMarks(children(), '~~');
    case 'sub':
      return scriptText(children(), SUB_CHARS, SUB_LETTERS, 'sub');
    case 'sup':
      return scriptText(children(), SUP_CHARS, SUP_LETTERS, 'sup');
    case 'code':
      return `\`${children().trim()}\``;
    case 'br':
      return '\n';
    case 'img':
      return '';
    case 'a': {
      const text = children().trim();
      const href = node.getAttribute('href') || '';
      if (!text || text === '↑') return '';
      if (!href || href.startsWith('#')) return text;
      return text === href ? href : `[${text}](${href})`;
    }
    default:
      return children();
  }
}

function listToMarkdown(list, depth) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const indent = '   '.repeat(depth);
  const lines = [];
  let n = 1;
  Array.from(list.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const text = [];
    const nested = [];
    Array.from(li.childNodes).forEach((child) => {
      const tag = child.nodeType === ELEMENT ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') nested.push(listToMarkdown(child, depth + 1));
      else text.push(inline(child));
    });
    const content = text.join('').replace(/\s*\n\s*/g, ' ').trim();
    lines.push(`${indent}${ordered ? `${n}.` : '-'} ${content}`);
    nested.filter(Boolean).forEach((block) => lines.push(block));
    n += 1;
  });
  return lines.join('\n');
}

function cellText(cell) {
  const parts = [];
  walkBlocks(cell, parts);
  return parts.join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').replace(/\s{2,}/g, ' ').trim();
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) => {
    const cells = [];
    Array.from(tr.children).forEach((cell) => {
      cells.push(cellText(cell));
      const span = Number(cell.getAttribute('colspan')) || 1;
      for (let k = 1; k < Math.min(span, 30); k += 1) cells.push('');
    });
    return cells;
  });
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width || !rows.length) return '';
  const pad = (row) => [...row, ...Array(width - row.length).fill('')];
  const line = (row) => `| ${pad(row).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function isBoldTitle(paragraph, text) {
  const only = paragraph.childNodes.length === 1 ? paragraph.firstChild : null;
  const tag = only && only.nodeType === ELEMENT ? only.tagName.toLowerCase() : '';
  if (tag !== 'strong' && tag !== 'b') return false;
  return text.length <= 80 && !SENTENCE_END.test(text) && /[A-Za-zÀ-ÿ]/.test(text);
}

function preText(node) {
  if (node.nodeType === TEXT) return node.nodeValue;
  if (node.nodeType !== ELEMENT) return '';
  if (node.tagName.toLowerCase() === 'br') return '\n';
  return Array.from(node.childNodes).map(preText).join('');
}

const hasClass = (node, name) => (node.getAttribute('class') || '').split(/\s+/).includes(name);
const isFootnoteList = (list) => Array.from(list.children).some((li) => /(?:foot|end)note/i.test(li.getAttribute('id') || ''));

// ctx.shift: niveles que se bajan los encabezados cuando el documento tiene Título (el título es el único #).
function walkBlocks(parent, out, ctx = { shift: 0 }) {
  Array.from(parent.childNodes).forEach((node) => {
    if (node.nodeType === TEXT) {
      const t = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const tag = node.tagName.toLowerCase();
    const previousIndex = out.length - 1;

    if (/^h[1-6]$/.test(tag)) {
      const text = inline(node).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      const level = hasClass(node, 'doc-title') ? 1 : Math.min(Number(tag[1]) + ctx.shift, 6);
      if (text) out.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'p') {
      const text = inline(node).replace(/[ ]*\n[ ]*/g, '\n').trim();
      if (!text) return;
      const plain = text.replace(/\*\*/g, '');
      if (hasClass(node, 'doc-subtitle')) out.push(`*${plain}*`);
      else out.push(isBoldTitle(node, plain) ? `${'#'.repeat(Math.min(2 + ctx.shift, 6))} ${plain}` : text);
    } else if (tag === 'ul' || tag === 'ol') {
      if (tag === 'ol' && isFootnoteList(node)) {
        const notes = Array.from(node.children)
          .map((li, i) => `[${i + 1}] ${inline(li).replace(/\s+/g, ' ').trim()}`)
          .join('\n\n');
        out.push(`---\n\n${notes}`);
      } else {
        out.push(listToMarkdown(node, 0));
      }
    } else if (tag === 'table') {
      const md = tableToMarkdown(node);
      if (md) out.push(md);
    } else if (tag === 'pre') {
      const code = preText(node).replace(/\n+$/, '');
      // Varias líneas de código seguidas (un párrafo por línea en Word) forman un solo bloque.
      if (ctx.lastPre === previousIndex && previousIndex >= 0) out[previousIndex] = out[previousIndex].replace(/\n```$/, `\n${code}\n\`\`\``);
      else out.push(`\`\`\`\n${code}\n\`\`\``);
      ctx.lastPre = out.length - 1;
    } else if (tag === 'blockquote') {
      const inner = [];
      walkBlocks(node, inner, ctx);
      const quoted = inner.join('\n\n').split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
      if (ctx.lastQuote === previousIndex && previousIndex >= 0) out[previousIndex] += `\n>\n${quoted}`;
      else out.push(quoted);
      ctx.lastQuote = out.length - 1;
    } else if (tag === 'hr') {
      out.push('---');
    } else if (tag === 'img' || tag === 'figure' || tag === 'script' || tag === 'style') {
      // Las imágenes no aportan texto: se omiten.
    } else {
      walkBlocks(node, out, ctx);
    }
  });
}

export function htmlToMarkdown(root) {
  const out = [];
  const hasTitle = Boolean(root.querySelector && root.querySelector('.doc-title'));
  walkBlocks(root, out, { shift: hasTitle ? 1 : 0 });
  return out.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- PDF (posiciones de texto -> Markdown) ---------- */

/* fonts (opcional): { [fontName]: nombre real de la tipografía } para detectar negrita, cursiva y monoespaciada. */
export function toPdfItems(textContent, fonts = {}) {
  const styles = textContent.styles || {};
  const flags = new Map();
  const flagsFor = (fontName) => {
    if (!flags.has(fontName)) {
      const real = String(fonts[fontName] || '').replace(/^[A-Z]{6}\+/, '');
      flags.set(fontName, {
        bold: /bold|black|heavy|semibold|demi/i.test(real),
        italic: /italic|oblique/i.test(real),
        mono: styles[fontName]?.fontFamily === 'monospace' || /mono|courier|consolas|menlo|typewriter/i.test(real),
      });
    }
    return flags.get(fontName);
  };
  return textContent.items
    .filter((item) => typeof item.str === 'string')
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      h: Math.abs(item.transform[3]) || item.height || 10,
      w: item.width || 0,
      ...flagsFor(item.fontName),
    }));
}

/* Subíndices y superíndices: pdf.js los entrega como textos aparte, más pequeños y desplazados.
   Se pegan a la letra anterior como caracteres Unicode (H₂O, Cr³⁺) para que no se lean como "H2O". */
const SUB_CHARS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '–': '₋', '(': '₍', ')': '₎' };
const SUP_CHARS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '–': '⁻', '(': '⁽', ')': '⁾' };
const SCRIPT_TEXT = /^[0-9+\-−–]+$/;

export function mergeScripts(items) {
  const out = items.map((item) => ({ ...item }));
  const byX = [...out].sort((a, b) => a.x - b.x);
  const dead = new Set();

  for (const item of byX) {
    const s = item.str.trim();
    if (!s || !SCRIPT_TEXT.test(s)) continue;

    let base = null;
    let kind = null;
    let best = Infinity;
    for (const cand of byX) {
      if (cand === item || dead.has(cand) || !cand.str.trim() || cand.h < item.h * 1.2) continue;
      const gap = item.x - (cand.x + cand.w);
      if (Math.abs(gap) > cand.h * 0.3) continue;
      const dy = (item.y - cand.y) / cand.h;
      const isSub = dy <= -0.08 && dy >= -0.6;
      const isSup = dy >= 0.2 && dy <= 0.9;
      if ((isSub || isSup) && Math.abs(gap) < best) {
        best = Math.abs(gap);
        base = cand;
        kind = isSub ? SUB_CHARS : SUP_CHARS;
      }
    }
    if (!base) continue;

    base.str += [...s].map((c) => kind[c] || c).join('');
    base.w = Math.max(base.w, item.x + item.w - base.x);
    dead.add(item);
  }
  return out.filter((item) => !dead.has(item));
}

/* ---------- PDF de diapositivas ---------- */

// Un PDF "de diapositivas" tiene páginas apaisadas (como una presentación exportada).
export function isSlideDeck(pages) {
  const sized = pages.filter((p) => p.width && p.height);
  if (!sized.length) return false;
  return sized.filter((p) => p.width >= p.height * 1.2).length / sized.length >= 0.6;
}

// Junta los textos en renglones y parte cada renglón donde hay un hueco grande (otra columna u otra molécula).
function toSegments(items) {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y);
  const clusters = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && Math.abs(current.y - item.y) <= Math.max(2, Math.min(current.h, item.h) * 0.45)) current.items.push(item);
    else clusters.push({ y: item.y, h: item.h, items: [item] });
  }

  const segments = [];
  clusters.forEach((cluster) => {
    let seg = null;
    let prevEnd = 0;
    let prevH = 0;
    cluster.items
      .sort((a, b) => a.x - b.x)
      .forEach((item) => {
        const gap = item.x - prevEnd;
        if (!seg || gap > Math.min(prevH, item.h) * 1.6) {
          seg = { text: '', x0: item.x, x1: item.x, y: item.y, h: item.h };
          segments.push(seg);
        } else if (gap > item.h * 0.18 && !/\s$/.test(seg.text) && !/^\s/.test(item.str)) {
          seg.text += ' ';
        }
        seg.text += item.str;
        seg.x1 = item.x + item.w;
        if (item.h > seg.h) {
          seg.h = item.h;
          seg.y = item.y;
        }
        prevEnd = item.x + item.w;
        prevH = item.h;
      });
  });
  segments.forEach((s) => {
    s.text = s.text.replace(/\s+/g, ' ').trim();
  });
  return segments.filter((s) => s.text);
}

const segLine = (s) => ({ text: s.text, y: s.y, h: s.h, x: s.x0, x1: s.x1 });

// Corta en franjas horizontales cuando entre dos grupos de texto hay un espacio en blanco.
function splitBands(segs) {
  const top = (s) => s.y + 0.8 * s.h;
  const low = (s) => s.y - 0.2 * s.h;
  const bands = [];
  let bottom = Infinity;
  [...segs].sort((a, b) => top(b) - top(a)).forEach((s) => {
    if (bands.length && top(s) > bottom) {
      bands[bands.length - 1].push(s);
      bottom = Math.min(bottom, low(s));
    } else {
      bands.push([s]);
      bottom = low(s);
    }
  });
  return bands;
}

// Corta en columnas cuando hay un hueco vertical de al menos minGap.
function splitCols(segs, minGap) {
  const cols = [];
  let right = -Infinity;
  [...segs].sort((a, b) => a.x0 - b.x0).forEach((s) => {
    if (cols.length && s.x0 - right <= minGap) {
      cols[cols.length - 1].push(s);
      right = Math.max(right, s.x1);
    } else {
      cols.push([s]);
      right = s.x1;
    }
  });
  return cols;
}

// Texto de una fila de fórmulas: lo que hay sobre/bajo cada flecha (reactivos) va entre corchetes.
function rowText(row) {
  return row.mains
    .map((main, i) => {
      if (i === 0) return main.text;
      const labels = [...row.gaps[i - 1]].sort((a, b) => b.y - a.y).map((l) => l.text);
      return `${labels.length ? ` —[${labels.join(', ')}]→ ` : ' | '}${main.text}`;
    })
    .join('');
}

// Varias columnas de una sola línea = una fila de fórmulas. El texto pequeño entre dos fórmulas
// (KMnO₄, [O], - H₂O) es lo que está sobre la flecha de la reacción.
function columnsAsRow(cols) {
  const heights = cols.map((c) => Math.max(...c.map((s) => s.h)));
  const ref = Math.max(...heights);
  const isLabel = cols.map((c, i) => i > 0 && i < cols.length - 1 && heights[i] <= ref * 0.78 && c.length <= 3);
  if (cols.filter((c, i) => !isLabel[i]).some((c) => c.length !== 1) || isLabel.filter((v) => !v).length < 2) return null;

  const mains = [];
  const gaps = [];
  let labels = [];
  let first = null;
  cols.forEach((col, i) => {
    if (isLabel[i]) {
      labels.push(...col.map((s) => ({ text: s.text, y: s.y })));
      return;
    }
    if (mains.length) gaps.push(labels);
    else first = col[0];
    labels = [];
    mains.push({ text: col[0].text, x0: col[0].x0, x1: col[0].x1 });
  });

  // Sin reactivos solo es una fila si son textos cortos (nombres, fórmulas); si no, son columnas de texto.
  const limit = gaps.some((g) => g.length) ? 45 : 30;
  if (mains.some((m) => m.text.length > limit)) return null;

  const row = { composite: true, mains, gaps, y: first.y, h: ref, x: first.x0 };
  row.text = rowText(row);
  return row;
}

// Un reactivo suelto (p. ej. "- H₂O" bajo la flecha) que quedó en su propia franja se devuelve a su flecha.
function attachOrphanLabels(lines) {
  const used = new Set();
  lines.forEach((row, i) => {
    if (!row.composite) return;
    [i - 2, i - 1, i + 1, i + 2].forEach((j) => {
      const cand = lines[j];
      if (!cand || cand.composite || used.has(cand) || cand.x1 === undefined) return;
      if (cand.h > row.h * 0.78 || Math.abs(cand.y - row.y) > row.h * 2.2) return;
      const mid = (cand.x + cand.x1) / 2;
      const gap = row.mains.findIndex((m, k) => k < row.mains.length - 1 && mid >= m.x1 && mid <= row.mains[k + 1].x0);
      if (gap < 0) return;
      row.gaps[gap].push({ text: cand.text, y: cand.y });
      used.add(cand);
    });
    row.text = rowText(row);
  });
  return lines.filter((l) => !used.has(l));
}

function clusterLines(segs) {
  const sorted = [...segs].sort((a, b) => b.y - a.y);
  const rows = [];
  sorted.forEach((s) => {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - s.y) <= Math.max(2, Math.min(row.h, s.h) * 0.45)) row.segs.push(s);
    else rows.push({ y: s.y, h: s.h, segs: [s] });
  });
  return rows.map((row) => {
    const ordered = row.segs.sort((a, b) => a.x0 - b.x0);
    return { text: ordered.map((s) => s.text).join(' '), y: row.y, h: Math.max(...ordered.map((s) => s.h)), x: ordered[0].x0 };
  });
}

// Orden de lectura de una diapositiva: franjas de arriba hacia abajo, columnas de izquierda a derecha.
function xyCut(segs, minGap) {
  if (!segs.length) return [];
  if (segs.length === 1) return [segLine(segs[0])];
  const bands = splitBands(segs);
  if (bands.length > 1) return bands.flatMap((band) => xyCut(band, minGap));
  const cols = splitCols(segs, minGap);
  if (cols.length > 1) {
    const row = columnsAsRow(cols);
    if (row) return [row];
    return cols.flatMap((col) => {
      const lines = xyCut(col, minGap);
      if (lines.length) lines[0].colStart = true;
      return lines;
    });
  }
  return clusterLines(segs);
}

function modeHeight(lines) {
  const weight = new Map();
  lines.forEach((l) => {
    const key = Math.round(l.h * 2) / 2;
    weight.set(key, (weight.get(key) || 0) + l.text.length);
  });
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

function looksLikeTitle(text) {
  const words = text.split(/\s+/);
  if (text.length > 90 || words.length > 12) return false;
  if ((text.match(/[A-Za-zÀ-ÿ]/g) || []).length < 4) return false;
  if (/[,;.:→=]|\s\+\s/.test(text)) return false;
  // Una frase en minúsculas es un párrafo, no un título.
  return !(words.length >= 8 && words.filter((w) => /^[a-zà-ÿ]/.test(w)).length / words.length > 0.5);
}

function pickTitle(lines, pageHeight) {
  const title = pickTitleLines(lines, pageHeight);
  return title.length && looksLikeTitle(joinWrapped(title.map((l) => l.text))) ? title : [];
}

function pickTitleLines(lines, pageHeight) {
  const plain = lines.filter((l) => !l.composite);
  if (!plain.length) return [];
  const bodyH = modeHeight(plain);
  const upper = plain.filter((l) => l.y >= pageHeight * 0.5 && l.text.length <= 140 && !BULLET.test(l.text));
  const maxH = upper.length ? Math.max(...upper.map((l) => l.h)) : 0;

  if (maxH >= bodyH * 1.12) {
    const first = upper.filter((l) => l.h >= maxH * 0.92).sort((a, b) => b.y - a.y)[0];
    const title = [first];
    for (let i = lines.indexOf(first) + 1; i < lines.length; i += 1) {
      const line = lines[i];
      const last = title[title.length - 1];
      if (line.composite || line.colStart || BULLET.test(line.text) || Math.abs(line.h - first.h) > first.h * 0.08 || last.y - line.y > first.h * 1.7) break;
      title.push(line);
    }
    return title;
  }

  // Diapositiva de portada: poco texto, todo del mismo tamaño y grande.
  const chars = plain.reduce((sum, l) => sum + l.text.length, 0);
  if (plain.length === lines.length && plain.length <= 4 && chars <= 100 && plain.every((l) => l.h >= 20 && !BULLET.test(l.text))) return plain;
  return [];
}

function joinWrapped(parts) {
  let text = parts[0];
  for (let k = 1; k < parts.length; k += 1) {
    text = /[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(parts[k]) ? text.slice(0, -1) + parts[k] : `${text} ${parts[k]}`;
  }
  return text;
}

function linesToBlocks(lines) {
  const blocks = [];
  let current = null;
  let previous = null;

  lines.forEach((line) => {
    const bullet = BULLET.test(line.text);
    const numbered = NUMBERED.test(line.text);
    const continues =
      current &&
      previous &&
      !bullet &&
      !numbered &&
      !line.composite &&
      !previous.composite &&
      !line.colStart &&
      Math.abs(line.h - previous.h) <= previous.h * 0.15 &&
      previous.y - line.y > 0 &&
      previous.y - line.y <= previous.h * 2.05 &&
      line.x >= previous.x - previous.h * 0.8 &&
      line.x <= previous.x + previous.h * 2.8;

    if (continues) {
      // Renglón que sigue al anterior: se pega al párrafo o al punto de la lista.
      if (current.type === 'items') current.parts[current.parts.length - 1] = joinWrapped([current.parts[current.parts.length - 1], line.text]);
      else current.parts.push(line.text);
    } else if (line.composite) {
      if (current && current.type === 'row' && previous.composite) current.parts.push(line.text);
      else {
        current = { type: 'row', parts: [line.text] };
        blocks.push(current);
      }
    } else if (bullet || numbered) {
      const text = bullet ? `- ${line.text.replace(BULLET, '')}` : `${line.text.match(NUMBERED)[1]}. ${line.text.replace(NUMBERED, '')}`;
      if (current && current.type === 'items') current.parts.push(text);
      else {
        current = { type: 'items', parts: [text] };
        blocks.push(current);
      }
    } else {
      current = { type: 'p', parts: [line.text] };
      blocks.push(current);
    }
    previous = line;
  });

  return blocks.map((block) => (block.type === 'p' ? joinWrapped(block.parts) : block.parts.join('\n')));
}

function cleanOcr(text) {
  return (text || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => (l.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length >= 2)
    .join('\n');
}

function slideToMarkdown(page, number) {
  const items = mergeScripts(page.items).filter((i) => i.str.trim());
  const segments = toSegments(items);
  const lines = segments.length
    ? attachOrphanLabels(xyCut(segments, Math.max(8, modeHeight(segments.map((s) => ({ h: s.h, text: s.text }))) * 0.5)))
    : [];

  const titleLines = pickTitle(lines, page.height || 540);
  const body = lines.filter((l) => !titleLines.includes(l));
  const title = titleLines.length ? joinWrapped(titleLines.map((l) => l.text)) : '';

  const out = [`## Diapositiva ${number}${title ? `: ${title}` : ''}`];

  // Esquemas de estructuras químicas dibujados con texto: solo quedan etiquetas sueltas.
  const lengths = body.map((l) => l.text.length).sort((a, b) => a - b);
  if (body.length >= 8 && lengths[Math.floor(lengths.length / 2)] <= 14 && lengths[lengths.length - 1] <= 70) {
    out.push('*[Esquema o estructura química: las líneas siguientes son solo etiquetas sueltas; el dibujo y sus enlaces no se pudieron leer.]*');
  }
  out.push(...linesToBlocks(body));

  const ocr = cleanOcr(page.ocrText);
  if (ocr) {
    out.push(`*Texto leído de las imágenes de esta diapositiva (OCR, puede tener errores):*\n\n${ocr.split('\n').map((l) => `> ${l}`).join('\n')}`);
  } else if (!lines.length) {
    out.push(page.imageCount > 0 ? '*[Diapositiva formada solo por imágenes o diagramas; su contenido no se pudo leer como texto.]*' : '*[Diapositiva sin texto legible (solo gráficos).]*');
  }
  return out.join('\n\n');
}

function slidesToMarkdown(pages) {
  return pages.map((page, i) => slideToMarkdown(page, i + 1)).join('\n\n').trim();
}

/* Acepta una lista de páginas, cada una con { items, width, height, imageCount, ocrText },
   o directamente la lista de textos de cada página (documento sin medidas). */
export function pdfPagesToMarkdown(input) {
  const pages = input.map((p) => (Array.isArray(p) ? { items: p } : p));
  if (isSlideDeck(pages)) return slidesToMarkdown(pages);
  return documentToMarkdown(pages.map((p) => ({ ...p, items: mergeScripts(p.items) })));
}

/* Respaldo para una sola página cuando la IA falla: usa la lectura local.
   Con asSlide se conserva el formato "## Diapositiva N"; si no, se devuelve el texto de la página. */
export function fallbackPageToMarkdown(page, number, asSlide = true) {
  if (asSlide) return slideToMarkdown(page, number);
  const text = documentToMarkdown([{ ...page, items: mergeScripts(page.items || []) }]);
  return `## Página ${number}\n\n${text || '*[Página sin texto legible.]*'}`;
}
