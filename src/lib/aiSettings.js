/* Ajustes de la lectura con IA. La clave solo se guarda en este navegador si la persona lo pide. */
import { VISION_DEFAULT_MODEL, VISION_MODELS } from './vision.js';

const KEY = 'mdconv.ai.v1';

export function loadAiSettings() {
  const base = { enabled: false, apiKey: '', model: VISION_DEFAULT_MODEL, remember: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      ...base,
      model: VISION_MODELS.some((m) => m.id === saved.model) ? saved.model : base.model,
      apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
      remember: Boolean(saved.apiKey),
      enabled: Boolean(saved.apiKey) && Boolean(saved.enabled),
    };
  } catch {
    return base;
  }
}

export function saveAiSettings(settings) {
  try {
    if (settings.remember && settings.apiKey) {
      localStorage.setItem(KEY, JSON.stringify({ apiKey: settings.apiKey, model: settings.model, enabled: settings.enabled }));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Sin almacenamiento (modo privado): la clave solo vive mientras la pestaña esté abierta.
  }
}
