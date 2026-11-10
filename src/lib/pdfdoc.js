/* PDF "de documento" (artículos, informes, manuales): posiciones de texto -> Markdown.
   Detecta columnas, tablas, listas con niveles, bloques de código, títulos (por tamaño, negrita o numeración)
   y énfasis. Son funciones puras: se prueban desde Node con PDFs reales.

   Cada ítem de texto: { str, x, y, h, w, bold?, italic?, mono? }.  Entrada: páginas { items, width?, height? }. */
import { BULLET, NUMBERED, NUMBERED_HEADING, PAGE_NUMBER, SENTENCE_END, median } from './patterns.js';

const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', '­': '' };
const MARKER_ONLY = /^(?:[-–•·▪◦‣⁃■□●○◆◇▶►➢➤➔✓✔☑❖◼◾-]|\d{1,3}[.)]|[a-zA-Z][.)])$/;
const END_OF_SENTENCE = /[.!?:;»”"')\]]$/;
const MAX_HEADING_LEVEL = 6;

const fixLigatures = (text) => text.replace(/[ﬁﬂﬀﬃﬄﬅﬆ­]/g, (c) => LIGATURES[c]);
const escapeCell = (text) => text.replace(/\|/g, '\\|');

/* ---------- Segmentos: textos de una misma línea separados por huecos grandes ---------- */

// Texto con énfasis: la negrita/cursiva/código solo se marca en los tramos que difieren del resto del segmento.
function emphasize(parts, whole) {
  const groups = [];
  parts.forEach((part) => {
    const marker = MARKER_ONLY.test(part.text.trim());
    const style = marker ? '' : `${part.bold && !whole.bold ? 'b' : ''}${part.italic && !whole.italic ? 'i' : ''}${part.mono && !whole.mono ? 'c' : ''}`;
    const last = groups[groups.length - 1];
    if (last && last.style === style) last.text += part.text;
    else groups.push({ style, text: part.text });
  });
  return groups
    .map(({ style, text }) => {
      const core = text.trim();
      if (!style || !core) return text;
      const lead = text.match(/^\s*/)[0];
      const trail = text.match(/\s*$/)[0];
      let out = core;
      if (style.includes('c')) out = `\`${out}\``;
      if (style.includes('b') && style.includes('i')) out = `***${out}***`;
      else if (style.includes('b')) out = `**${out}**`;
      else if (style.includes('i')) out = `*${out}*`;
      return `${lead}${out}${trail}`;
    })
    .join('');
}

function clusterByY(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const clusters = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && Math.abs(current.y - item.y) <= Math.max(2, Math.min(current.h, item.h) * 0.45)) current.items.push(item);
    else clusters.push({ y: item.y, h: item.h, items: [item] });
  }
  return clusters;
}

function buildSegments(items) {
  const clean = items
    .map((i) => ({ ...i, str: fixLigatures(i.str || '') }))
    .filter((i) => i.str.trim());
  const segments = [];

  clusterByY(clean).forEach((cluster) => {
    let seg = null;
    let prevEnd = 0;
    let prevH = 0;
    cluster.items
      .sort((a, b) => a.x - b.x)
      .forEach((item) => {
        const gap = item.x - prevEnd;
        const markerOnly = seg && MARKER_ONLY.test(seg.parts.map((p) => p.text).join('').trim()) && gap <= item.h * 5;
        if (!seg || (gap > Math.min(prevH, item.h) * 1.0 && !markerOnly)) {
          seg = { parts: [], x0: item.x, x1: item.x, y: item.y, h: item.h };
          segments.push(seg);
        } else if (gap > item.h * 0.18 && !/\s$/.test(seg.parts[seg.parts.length - 1].text) && !/^\s/.test(item.str)) {
          seg.parts.push({ text: ' ' });
        }
        seg.parts.push({ text: item.str, bold: item.bold, italic: item.italic, mono: item.mono });
        seg.x1 = item.x + item.w;
        // El símbolo de la viñeta suele ser más grande que el texto: no cuenta para la altura ni la posición del renglón.
        const isMarker = seg.parts.length === 1 && MARKER_ONLY.test(item.str.trim());
        if (isMarker) {
          seg.h = item.h;
          seg.y = item.y;
          seg.markerOnly = true;
        } else if (seg.markerOnly) {
          seg.h = item.h;
          seg.y = item.y;
          seg.markerOnly = false;
        } else if (item.h > seg.h) {
          seg.h = item.h;
          seg.y = item.y;
        }
        prevEnd = item.x + item.w;
        prevH = item.h;
      });
  });

  return segments
    .map((seg) => {
      const styled = seg.parts.filter((p) => p.text.trim());
      const all = (flag) => styled.length > 0 && styled.every((p) => p[flag]);
      const whole = { bold: all('bold'), italic: all('italic'), mono: all('mono') };
      const raw = seg.parts.map((p) => p.text).join('');
      const text = raw.replace(/\s+/g, ' ').trim();
      return {
        text,
        md: emphasize(seg.parts, whole).replace(/\s+/g, ' ').trim(),
        x0: seg.x0,
        x1: seg.x1,
        y: seg.y,
        h: seg.h,
        top: seg.y + 0.8 * seg.h,
        bottom: seg.y - 0.2 * seg.h,
        ...whole,
        charW: text.length ? (seg.x1 - seg.x0) / text.length : 0,
      };
    })
    .filter((seg) => seg.text);
}

/* ---------- Encabezados y pies de página repetidos ---------- */

function rowsOf(segs) {
  return clusterByY(segs).map((c) => ({ y: c.y, h: c.h, segs: c.items.sort((a, b) => a.x0 - b.x0) }));
}

function dropEdges(pageSegs) {
  const rowText = (row) => row.segs.map((s) => s.text).join(' ');
  const key = (row) => rowText(row).toLowerCase().replace(/\d+/g, '#');
  const rowsByPage = pageSegs.map(rowsOf);
  const edge = (rows) => [...rows.slice(0, 2), ...rows.slice(-2)];
  const counts = new Map();
  rowsByPage.forEach((rows) => new Set(edge(rows).map(key)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
  const minPages = Math.max(2, Math.ceil(pageSegs.length * 0.5));

  return rowsByPage.map((rows, i) => {
    const edges = new Set(edge(rows));
    const dropped = new Set();
    rows.forEach((row) => {
      if (!edges.has(row)) return;
      if (PAGE_NUMBER.test(rowText(row)) || (pageSegs.length >= 2 && counts.get(key(row)) >= minPages)) row.segs.forEach((s) => dropped.add(s));
    });
    return pageSegs[i].filter((s) => !dropped.has(s));
  });
}

/* ---------- Tablas ---------- */

function rowsToTable(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (row) => [...row, ...Array(width - row.length).fill('')].map(escapeCell);
  const line = (row) => `| ${pad(row).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function runToTable(run, bodyH) {
  const segs = run.flatMap((r) => r.segs);
  const cells = segs.map((s) => s.text.length);
  if (median(cells) > 34 || Math.max(...cells) > 80) return null;

  // Columnas: zonas horizontales donde hay texto en alguna fila; los huecos entre ellas separan columnas.
  const spans = segs.map((s) => [s.x0, s.x1]).sort((a, b) => a[0] - b[0]);
  const columns = [];
  spans.forEach(([a, b]) => {
    const last = columns[columns.length - 1];
    if (last && a - last[1] <= bodyH * 0.3) last[1] = Math.max(last[1], b);
    else columns.push([a, b]);
  });
  if (columns.length < 2 || columns.length > 12) return null;

  const rows = [];
  let previousRow = null;
  run.forEach((row) => {
    const out = Array(columns.length).fill('');
    row.segs.forEach((s) => {
      const mid = (s.x0 + s.x1) / 2;
      let index = columns.findIndex(([a, b]) => mid >= a && mid <= b);
      if (index < 0) index = 0;
      out[index] = out[index] ? `${out[index]} ${s.md}` : s.md;
    });
    // Una sola celda llena y pegada a la fila de arriba: es la segunda línea de una celda.
    if (previousRow && row.segs.length === 1 && previousRow.row.y - row.y <= row.h * 1.5) {
      const index = out.findIndex(Boolean);
      previousRow.cells[index] = previousRow.cells[index] ? `${previousRow.cells[index]} ${out[index]}` : out[index];
      return;
    }
    previousRow = { row, cells: out };
    rows.push(out);
  });
  if (rows.length < 2 || rows.filter((r) => r.filter(Boolean).length >= 2).length < rows.length * 0.6) return null;

  return {
    table: true,
    md: rowsToTable(rows),
    x0: Math.min(...segs.map((s) => s.x0)),
    x1: Math.max(...segs.map((s) => s.x1)),
    top: Math.max(...run.map((r) => Math.max(...r.segs.map((s) => s.top)))),
    bottom: Math.min(...run.map((r) => Math.min(...r.segs.map((s) => s.bottom)))),
    segs,
  };
}

// Filas con varios textos separados por huecos grandes y alineados entre sí = tabla.
function extractTables(segs, bodyH) {
  const rows = rowsOf(segs);
  const runs = [];
  let run = [];
  let pending = null;
  const near = (a, b) => a.y - b.y <= Math.max(a.h, b.h) * 2.6;
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
    pending = null;
  };

  rows.forEach((row) => {
    const multi = row.segs.length >= 2;
    const last = run[run.length - 1];
    if (multi) {
      if (last && near(last, pending || row) && (!pending || near(pending, row))) {
        if (pending) run.push(pending);
        run.push(row);
        pending = null;
      } else {
        flush();
        run.push(row);
      }
    } else if (last && !pending && last.y - row.y <= Math.max(last.h, row.h) * 1.9 && row.segs[0].text.length <= 40) {
      pending = row; // fila con una sola celda llena: solo cuenta si después sigue otra fila de la tabla
    } else {
      if (pending && run.length >= 2) run.push(pending);
      flush();
    }
  });
  if (pending && run.length >= 2) run.push(pending);
  flush();

  const units = [];
  const used = new Set();
  runs.forEach((r) => {
    // "1 | Primer paso", "2 | Segundo paso": lista numerada cuyo número quedó aparte, no una tabla.
    const numbers = r.map((row) => (row.segs.length === 2 && /^\d{1,3}$/.test(row.segs[0].text) ? Number(row.segs[0].text) : null));
    if (numbers.every((n, k) => n !== null && (k === 0 || n === numbers[k - 1] + 1))) {
      r.forEach((row) => {
        const [num, body] = row.segs;
        used.add(num);
        body.text = `${num.text}. ${body.text}`;
        body.md = `${num.text}. ${body.md}`;
        body.x0 = num.x0;
      });
      return;
    }
    const table = runToTable(r, bodyH);
    if (!table) return;
    table.segs.forEach((s) => used.add(s));
    units.push(table);
  });
  return [...segs.filter((s) => !used.has(s)), ...units];
}

/* ---------- Orden de lectura: corte XY recursivo (columnas y franjas) ---------- */

function splitBands(units, gap) {
  const bands = [];
  let bottom = Infinity;
  [...units].sort((a, b) => b.top - a.top).forEach((u) => {
    if (bands.length && u.top >= bottom - gap) {
      bands[bands.length - 1].push(u);
      bottom = Math.min(bottom, u.bottom);
    } else {
      bands.push([u]);
      bottom = u.bottom;
    }
  });
  return bands;
}

function splitCols(units, gap) {
  const cols = [];
  let right = -Infinity;
  [...units].sort((a, b) => a.x0 - b.x0).forEach((u) => {
    if (cols.length && u.x0 - right <= gap) {
      cols[cols.length - 1].push(u);
      right = Math.max(right, u.x1);
    } else {
      cols.push([u]);
      right = u.x1;
    }
  });
  return cols;
}

const joinMd = (parts) => parts.join(' ');

function leafToLines(units) {
  const lines = [];
  const rest = [];
  units
    .sort((a, b) => b.top - a.top)
    .forEach((u) => {
      if (u.table) lines.push({ table: true, md: u.md, text: u.md, x: u.x0, x1: u.x1, y: u.top, h: 0 });
      else rest.push(u);
    });
  rowsOf(rest).forEach((row) => {
    const tallest = row.segs.reduce((a, b) => (b.h > a.h ? b : a));
    lines.push({
      text: row.segs.map((s) => s.text).join(' '),
      md: joinMd(row.segs.map((s) => s.md)),
      x: row.segs[0].x0,
      x1: row.segs[row.segs.length - 1].x1,
      y: row.y,
      h: tallest.h,
      bold: row.segs.every((s) => s.bold),
      italic: row.segs.every((s) => s.italic),
      mono: row.segs.every((s) => s.mono),
      charW: row.segs[0].charW,
    });
  });
  const ordered = lines.sort((a, b) => b.y - a.y);
  if (ordered.length) ordered[0].parStart = true;
  return ordered;
}

function xyCut(units, bandGap, colGap) {
  if (!units.length) return [];
  if (units.length === 1) return leafToLines(units);
  // Primero columnas: si hay un pasillo vertical libre, se lee una columna completa y luego la siguiente.
  // Un título a todo el ancho no deja pasillo libre, así que cae al corte por franjas y se separa del resto.
  const cols = splitCols(units, colGap);
  if (cols.length > 1) {
    return cols.flatMap((col) => {
      const lines = xyCut(col, bandGap, colGap);
      if (lines.length) lines[0].colStart = true;
      return lines;
    });
  }
  const bands = splitBands(units, bandGap);
  if (bands.length > 1) return bands.flatMap((band) => xyCut(band, bandGap, colGap));
  return leafToLines(units);
}

/* ---------- Estadísticas del documento ---------- */

function bodyStats(pageSegs) {
  const weight = new Map();
  let chars = 0;
  let boldChars = 0;
  pageSegs.flat().forEach((s) => {
    const key = Math.round(s.h * 2) / 2;
    weight.set(key, (weight.get(key) || 0) + s.text.length);
    chars += s.text.length;
    if (s.bold) boldChars += s.text.length;
  });
  const bodyH = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  return { bodyH, bodyBold: chars > 0 && boldChars / chars > 0.6 };
}

// Espacio en blanco normal entre renglones de un párrafo (para no cortar cada renglón como si fuera otro párrafo).
function lineWhitespace(pageSegs) {
  const gaps = [];
  pageSegs.forEach((segs) => {
    const rows = rowsOf(segs);
    for (let i = 1; i < rows.length; i += 1) {
      const above = Math.min(...rows[i - 1].segs.map((s) => s.bottom));
      const below = Math.max(...rows[i].segs.map((s) => s.top));
      const sameSize = Math.abs(rows[i].h - rows[i - 1].h) < 0.6;
      if (sameSize && above - below > 0) gaps.push(above - below);
    }
  });
  return median(gaps);
}

/* ---------- Líneas -> bloques Markdown ---------- */

function joinWrapped(parts) {
  let text = parts[0];
  for (let k = 1; k < parts.length; k += 1) {
    const next = parts[k];
    text = /[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(next) ? text.slice(0, -1) + next : `${text} ${next}`;
  }
  return text.replace(/\*\*\s+\*\*/g, ' ').replace(/`\s+`/g, ' ');
}

function numberedDepth(text) {
  const m = text.match(NUMBERED_HEADING);
  return m ? m[1].split('.').length : 0;
}

export function documentToMarkdown(pages) {
  const prepared = pages.map((p) => buildSegments(p.items || []));
  if (!prepared.some((segs) => segs.length)) return '';
  const { bodyH, bodyBold } = bodyStats(prepared);
  const cleaned = dropEdges(prepared);
  const whitespace = lineWhitespace(cleaned);
  const bandGap = Math.max(whitespace * 1.6, bodyH * 0.4);
  const colGap = Math.max(bodyH * 0.8, 8);

  // Líneas de todo el documento, en orden de lectura.
  const lines = [];
  cleaned.forEach((segs, p) => {
    const ordered = xyCut(extractTables(segs, bodyH), bandGap, colGap);
    ordered.forEach((line, i) => lines.push({ ...line, page: p, firstOnPage: i === 0 }));
  });
  if (!lines.length) return '';

  // Ancho típico del texto, para reconocer renglones cortos (fin de párrafo).
  const widths = lines.filter((l) => !l.table && l.h > 0).map((l) => l.x1 - l.x).sort((a, b) => a - b);
  const textWidth = widths.length ? widths[Math.floor(widths.length * 0.9)] : 0;

  const isItemText = (text) => BULLET.test(text) || NUMBERED.test(text);
  // Una línea sola en su bloque: la siguiente empieza otro bloque o tiene otro estilo (tamaño o negrita).
  const standalone = (i) => {
    const line = lines[i];
    const next = lines[i + 1];
    if (!line.parStart) return false;
    return !next || next.parStart || next.colStart || next.page !== line.page || Math.abs(next.h - line.h) > 0.5 || Boolean(next.bold) !== Boolean(line.bold);
  };
  const isNumberHead = (i) => {
    const line = lines[i];
    return !line.table && !line.mono && standalone(i) && NUMBERED_HEADING.test(line.text) && line.text.length <= 80 && !SENTENCE_END.test(line.text);
  };

  // Marca cada línea: ¿es un título? ¿con qué "peso" (para asignar niveles)?
  lines.forEach((line, i) => {
    if (line.table || line.mono || (isItemText(line.text) && !isNumberHead(i))) return;
    const ratio = line.h / bodyH;
    const text = line.text;
    if (ratio >= 1.18 && text.length <= 110 && !/[.;,]$/.test(text)) {
      line.heading = line.h;
    } else if (line.bold && !bodyBold && standalone(i) && text.length <= 90 && !/[.;,:]$/.test(text) && /[A-Za-zÀ-ÿ]/.test(text) && !BULLET.test(text)) {
      line.heading = bodyH - 0.0001;
    } else if (isNumberHead(i)) {
      const depth = numberedDepth(text);
      const neighbour = [i - 1, i + 1].some((j) => lines[j] && isNumberHead(j) && lines[j].page === line.page && depth === 1 && numberedDepth(lines[j].text) === 1);
      if (depth >= 2 || line.bold || ratio >= 1.05 || !neighbour) line.heading = bodyH - 0.0002 - 0.0001 * depth;
    }
  });

  // Niveles: los pesos distintos se ordenan de mayor a menor (el más grande es #).
  const weights = [...new Set(lines.filter((l) => l.heading).map((l) => l.heading))].sort((a, b) => b - a);
  const levelOf = (w) => Math.min(weights.indexOf(w) + 1, MAX_HEADING_LEVEL);

  const blocks = [];
  let para = null;
  let list = null; // { items: [{depth, text}], stack: [x...], x: x del último punto }
  let code = null;
  const tolX = Math.max(4, bodyH * 0.5);

  const closeAll = () => {
    if (para) blocks.push({ type: 'p', text: joinWrapped(para.parts) });
    if (code) blocks.push({ type: 'code', text: code.lines.join('\n') });
    if (list) blocks.push({ type: 'list', items: list.items });
    para = null;
    list = null;
    code = null;
  };
  const startsParagraph = (line, previous) => {
    if (line.parStart || line.colStart || !previous || previous.page !== line.page) return true;
    // Sangría de primera línea, o renglón corto que cerró una frase: empieza otro párrafo.
    if (line.x - previous.x >= bodyH * 0.9 && !previous.table) return true;
    const short = textWidth > 0 && previous.x1 - previous.x < textWidth * 0.6 && line.x <= previous.x + tolX;
    if (short && END_OF_SENTENCE.test(previous.text)) return true;
    // Renglón muy corto (no por partir una palabra) seguido de una mayúscula: fin de párrafo.
    if (short && previous.x1 - previous.x < textWidth * 0.5 && !/-$/.test(previous.text) && /^[A-ZÁÉÍÓÚÑÜ¿¡0-9]/.test(line.text)) return true;
    return false;
  };

  lines.forEach((line, i) => {
    const previous = lines[i - 1];

    if (line.table) {
      closeAll();
      blocks.push({ type: 'table', text: line.md });
      return;
    }

    if (line.mono) {
      if (para || list) closeAll();
      if (!code) code = { lines: [], x: line.x, last: null };
      else if (code.last && code.last.y - line.y > code.last.h * 2.2 && code.last.page === line.page) code.lines.push('');
      const indent = line.charW ? Math.max(0, Math.round((line.x - code.x) / line.charW)) : 0;
      code.lines.push(`${' '.repeat(indent)}${line.text}`);
      code.last = line;
      return;
    }
    if (code) closeAll();

    if (line.heading) {
      const last = blocks[blocks.length - 1];
      if (!para && !list && last && last.type === 'heading' && last.weight === line.heading && !line.parStart && previous && previous.page === line.page) {
        last.text += ` ${line.text}`;
      } else {
        closeAll();
        blocks.push({ type: 'heading', weight: line.heading, level: levelOf(line.heading), text: line.text });
      }
      return;
    }

    const newPara = startsParagraph(line, previous);
    const item = isItemText(line.text);

    if (item) {
      if (para) closeAll();
      const bullet = BULLET.test(line.text);
      const md = line.md;
      const body = bullet ? md.replace(BULLET, '') : md.replace(NUMBERED, '');
      const label = bullet ? '-' : `${line.text.match(NUMBERED)[1]}.`;
      // Pasar de viñetas a numeración (o al revés) en el nivel principal abre otra lista.
      if (list && list.items.length && list.items[list.items.length - 1].depth === 0 && list.items[list.items.length - 1].bullet !== bullet && line.x <= list.stack[0] + tolX) closeAll();
      if (!list) list = { items: [], stack: [] };
      const stack = list.stack;
      while (stack.length && line.x < stack[stack.length - 1] - tolX) stack.pop();
      if (!stack.length || line.x > stack[stack.length - 1] + tolX) stack.push(line.x);
      list.items.push({ depth: stack.length - 1, label, text: body, x: line.x, bullet });
      return;
    }

    const lastItem = list && list.items[list.items.length - 1];
    if (lastItem && !newPara && line.x >= lastItem.x - tolX) {
      lastItem.text = joinWrapped([lastItem.text, line.md]);
      return;
    }
    // Un renglón que sigue a un párrafo dentro de la misma página
    if (para && !newPara) {
      para.parts.push(line.md);
      return;
    }

    // Párrafo que sigue en la página (o columna) siguiente: el anterior no terminó la frase y este empieza en minúscula.
    const lastBlock = blocks[blocks.length - 1];
    const jump = Boolean(previous) && ((line.firstOnPage && previous.page !== line.page) || line.colStart);
    if (!para && !list && jump && lastBlock && lastBlock.type === 'p' && !END_OF_SENTENCE.test(lastBlock.text) && /^[a-zà-ÿ(]/.test(line.text)) {
      blocks.pop();
      para = { parts: [lastBlock.text, line.md] };
      return;
    }
    if (para && jump && !END_OF_SENTENCE.test(para.parts[para.parts.length - 1]) && /^[a-zà-ÿ(]/.test(line.text)) {
      para.parts.push(line.md);
      return;
    }
    if (lastItem && jump && !END_OF_SENTENCE.test(lastItem.text) && /^[a-zà-ÿ(]/.test(line.text)) {
      lastItem.text = joinWrapped([lastItem.text, line.md]);
      return;
    }

    closeAll();
    para = { parts: [line.bold && !bodyBold ? `**${line.text}**` : line.md] };
  });
  closeAll();

  const out = [];
  blocks.forEach((block) => {
    if (block.type === 'heading') out.push(`${'#'.repeat(block.level)} ${block.text}`);
    else if (block.type === 'table') out.push(block.text);
    else if (block.type === 'code') out.push(`\`\`\`\n${block.text}\n\`\`\``);
    else if (block.type === 'list') out.push(block.items.map((it) => `${'   '.repeat(it.depth)}${it.label} ${it.text}`).join('\n'));
    else out.push(block.text);
  });
  return out.join('\n\n').trim();
}

// Solo para pruebas.
export const internals = { buildSegments, extractTables, xyCut, rowsOf, runToTable };
