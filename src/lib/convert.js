/* Lógica de conversión a Markdown. Son funciones puras (sin React ni librerías del navegador)
   para poder probarlas con documentos reales desde Node. Los lectores de archivos viven en readers.js. */

const BULLET = /^(?:[-*•·▪◦–•])\s+/;
const NUMBERED = /^(\d{1,3})[.)]\s+/;
const SENTENCE_END = /[.!?…;,]$/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+[A-ZÁÉÍÓÚÑÜ¿¡]/;
const PAGE_NUMBER = /^(?:p[aá]g(?:ina)?\.?|page)?\s*\d{1,4}(?:\s*(?:\/|de|of)\s*\d{1,4})?$/i;

/* ---------- Texto plano ---------- */

export function normalizeText(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/\f/g, '\n\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => line.replace(/(\S)[ ]{2,}/g, '$1 ').replace(/\s+$/, ''))
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

function convertBlock(lines, { isFirst, hasNext }) {
  const first = lines[0].trim();

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

  const flushPara = () => {
    if (para.length) out.push(joinParagraph(para));
    para = [];
  };
  const flushItems = () => {
    if (items.length) out.push(items.join('\n'));
    items = [];
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

  lines.forEach((line, index) => {
    const t = line.trim();
    const kind = lineKind(line);

    if (kind === 'bullet' || kind === 'number') {
      flushPara();
      flushPass();
      items.push(kind === 'bullet' ? `- ${t.replace(BULLET, '')}` : `${t.match(NUMBERED)[1]}. ${t.replace(NUMBERED, '')}`);
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
    part.text
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
    case 'code':
      return `\`${children().trim()}\``;
    case 'br':
      return '\n';
    case 'img':
      return '';
    case 'a': {
      const text = children().trim();
      const href = node.getAttribute('href') || '';
      if (!text) return '';
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

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children).map((cell) => inline(cell).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()),
  );
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

function walkBlocks(parent, out) {
  Array.from(parent.childNodes).forEach((node) => {
    if (node.nodeType === TEXT) {
      const t = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = inline(node).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
    } else if (tag === 'p') {
      const text = inline(node).replace(/[ ]*\n[ ]*/g, '\n').trim();
      if (!text) return;
      const plain = text.replace(/\*\*/g, '');
      out.push(isBoldTitle(node, plain) ? `## ${plain}` : text);
    } else if (tag === 'ul' || tag === 'ol') {
      out.push(listToMarkdown(node, 0));
    } else if (tag === 'table') {
      const md = tableToMarkdown(node);
      if (md) out.push(md);
    } else if (tag === 'pre') {
      out.push(`\`\`\`\n${node.textContent.replace(/\n+$/, '')}\n\`\`\``);
    } else if (tag === 'blockquote') {
      const inner = [];
      walkBlocks(node, inner);
      out.push(inner.join('\n\n').split('\n').map((l) => `> ${l}`.trimEnd()).join('\n'));
    } else if (tag === 'hr') {
      out.push('---');
    } else if (tag === 'img' || tag === 'figure' || tag === 'script' || tag === 'style') {
      // Las imágenes no aportan texto: se omiten.
    } else {
      walkBlocks(node, out);
    }
  });
}

export function htmlToMarkdown(root) {
  const out = [];
  walkBlocks(root, out);
  return out.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- PDF (posiciones de texto -> Markdown) ---------- */

export function toPdfItems(textContent) {
  return textContent.items
    .filter((item) => typeof item.str === 'string')
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      h: Math.abs(item.transform[3]) || item.height || 10,
      w: item.width || 0,
    }));
}

function buildLines(items) {
  const sorted = items.filter((i) => i.str !== '').sort((a, b) => b.y - a.y);
  const clusters = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && Math.abs(current.y - item.y) <= Math.max(2, Math.min(current.h, item.h) * 0.45)) current.items.push(item);
    else clusters.push({ y: item.y, h: item.h, items: [item] });
  }

  return clusters
    .map((cluster) => {
      cluster.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd = null;
      let tallest = cluster.items[0];
      for (const item of cluster.items) {
        if (item.str.trim().length > tallest.str.trim().length) tallest = item;
        const gap = prevEnd === null ? 0 : item.x - prevEnd;
        if (prevEnd !== null && gap > item.h * 0.18 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
        text += item.str;
        prevEnd = item.x + item.w;
      }
      return { text: text.replace(/\s+/g, ' ').trim(), y: cluster.y, h: tallest.h, x: cluster.items[0].x };
    })
    .filter((line) => line.text);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function dropRepeatedHeadersAndFooters(pages) {
  const key = (line) => line.text.toLowerCase().replace(/\d+/g, '#');
  const edge = (lines) => [...lines.slice(0, 2), ...lines.slice(-2)];
  const counts = new Map();
  pages.forEach((lines) => {
    new Set(edge(lines).map(key)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  });
  const minPages = Math.max(2, Math.ceil(pages.length * 0.5));

  return pages.map((lines) => {
    const edges = new Set(edge(lines));
    return lines.filter((line) => {
      if (!edges.has(line)) return true;
      if (PAGE_NUMBER.test(line.text)) return false;
      return !(pages.length >= 2 && counts.get(key(line)) >= minPages);
    });
  });
}

export function pdfPagesToMarkdown(pagesItems) {
  const pages = dropRepeatedHeadersAndFooters(pagesItems.map(buildLines).filter((p) => p.length));
  const all = pages.flat();
  if (!all.length) return '';

  // Tamaño de letra del cuerpo: el que más caracteres acumula.
  const weight = new Map();
  all.forEach((l) => weight.set(Math.round(l.h * 2) / 2, (weight.get(Math.round(l.h * 2) / 2) || 0) + l.text.length));
  const bodyH = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Interlineado típico, para distinguir un salto de párrafo de un simple salto de línea.
  const gaps = [];
  pages.forEach((lines) => {
    for (let i = 1; i < lines.length; i += 1) {
      const gap = lines[i - 1].y - lines[i].y;
      if (Math.abs(lines[i].h - bodyH) < 0.6 && gap >= bodyH * 0.9 && gap <= bodyH * 2.4) gaps.push(gap);
    }
  });
  const leading = median(gaps) || bodyH * 1.3;

  // Marca cada línea: ¿empieza un bloque nuevo?
  const flat = [];
  pages.forEach((lines, p) => {
    lines.forEach((line, i) => {
      const previous = i === 0 ? null : lines[i - 1];
      flat.push({ ...line, page: p, breakBefore: previous ? previous.y - line.y > leading * 1.45 : true, firstOnPage: i === 0 });
    });
  });

  const blocks = [];
  let para = null;
  const pushPara = () => {
    if (para) blocks.push(para);
    para = null;
  };

  flat.forEach((line, i) => {
    const ratio = line.h / bodyH;
    const next = flat[i + 1];
    const standalone = line.breakBefore && (!next || next.breakBefore);
    const numbered = line.text.match(NUMBERED_HEADING);

    let level = 0;
    if (ratio >= 1.18 && line.text.length <= 110 && !/[.;,]$/.test(line.text)) level = ratio >= 1.7 ? 1 : ratio >= 1.35 ? 2 : 3;
    else if (numbered && standalone && line.text.length <= 80 && !SENTENCE_END.test(line.text)) level = Math.min(numbered[1].split('.').length + 1, 5);

    if (level) {
      const previous = blocks[blocks.length - 1];
      if (para === null && previous && previous.type === 'heading' && previous.level === level && !line.breakBefore) {
        previous.text += ` ${line.text}`;
      } else {
        pushPara();
        blocks.push({ type: 'heading', level, text: line.text });
      }
      return;
    }

    const isItem = BULLET.test(line.text) || NUMBERED.test(line.text);
    if (isItem) {
      pushPara();
      const bullet = BULLET.test(line.text);
      blocks.push({
        type: 'item',
        text: bullet ? `- ${line.text.replace(BULLET, '')}` : `${line.text.match(NUMBERED)[1]}. ${line.text.replace(NUMBERED, '')}`,
      });
      return;
    }

    const previousBlock = blocks[blocks.length - 1];
    let continuesBlock = !line.breakBefore;
    if (line.firstOnPage && line.page > 0 && previousBlock && !para) {
      continuesBlock = previousBlock.type === 'item' ? !SENTENCE_END.test(previousBlock.text) : false;
    } else if (line.firstOnPage && line.page > 0 && para) {
      continuesBlock = !/[.!?:;»”"')\]]$/.test(para.lines[para.lines.length - 1]);
    }

    if (continuesBlock && para) {
      para.lines.push(line.text);
    } else if (continuesBlock && previousBlock && previousBlock.type === 'item') {
      previousBlock.text += ` ${line.text}`;
    } else {
      pushPara();
      para = { type: 'p', lines: [line.text] };
    }
  });
  pushPara();

  const out = [];
  blocks.forEach((block, i) => {
    if (block.type === 'heading') out.push(`${'#'.repeat(block.level)} ${block.text}`);
    else if (block.type === 'item') {
      if (blocks[i - 1] && blocks[i - 1].type === 'item') out[out.length - 1] += `\n${block.text}`;
      else out.push(block.text);
    } else {
      let text = block.lines[0];
      for (let k = 1; k < block.lines.length; k += 1) {
        const nextLine = block.lines[k];
        text = /[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(nextLine) ? text.slice(0, -1) + nextLine : `${text} ${nextLine}`;
      }
      out.push(text);
    }
  });
  return out.join('\n\n').trim();
}
