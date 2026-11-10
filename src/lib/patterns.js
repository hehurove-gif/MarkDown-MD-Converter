/* Patrones y utilidades compartidas por convert.js y pdfdoc.js. */

// Guiones y asteriscos exigen espacio; los símbolos (•, ➢, ✓, ❖, Wingdings...) pueden ir pegados al texto.
export const BULLET = /^(?:[-*–]\s+|[•·▪◦‣⁃■□●○◆◇▶►➢➤➔✓✔☑❖◼◾-]\s*)/;
export const NUMBERED = /^(\d{1,3})[.)]\s+/;
export const SENTENCE_END = /[.!?…;,]$/;
export const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+[A-ZÁÉÍÓÚÑÜ¿¡]/;
export const PAGE_NUMBER = /^(?:p[aá]g(?:ina)?\.?|page)?\s*\d{1,4}(?:\s*(?:\/|de|of)\s*\d{1,4})?$/i;

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
