/* Ajustes de la lectura con IA. Las claves solo se guardan en este navegador si la persona lo pide. */
import { DEFAULT_PROVIDER, PROVIDERS, defaultModel, getProvider } from './providers.js';

const KEY = 'mdconv.ai.v2';

const blank = () => ({ enabled: false, provider: DEFAULT_PROVIDER, keys: {}, models: {}, baseUrl: getProvider('custom').baseUrl, remember: false });

export function loadAiSettings() {
  const base = blank();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const keys = saved.keys && typeof saved.keys === 'object' ? saved.keys : {};
    return {
      ...base,
      provider: PROVIDERS.some((p) => p.id === saved.provider) ? saved.provider : base.provider,
      keys,
      models: saved.models && typeof saved.models === 'object' ? saved.models : {},
      baseUrl: typeof saved.baseUrl === 'string' && saved.baseUrl ? saved.baseUrl : base.baseUrl,
      remember: Object.values(keys).some(Boolean),
      enabled: Boolean(saved.enabled),
    };
  } catch {
    return base;
  }
}

export function saveAiSettings(settings) {
  try {
    const keepKeys = settings.remember ? settings.keys : {};
    localStorage.setItem(
      KEY,
      JSON.stringify({ enabled: settings.enabled, provider: settings.provider, models: settings.models, baseUrl: settings.baseUrl, keys: keepKeys }),
    );
  } catch {
    // Sin almacenamiento (modo privado): todo vive solo mientras la pestaña esté abierta.
  }
}

// Ajustes -> lo que necesitan los lectores; null si falta algo (clave o modelo).
export function resolveAi(settings) {
  if (!settings.enabled) return { ai: null };
  const provider = getProvider(settings.provider);
  const apiKey = (settings.keys[provider.id] || '').trim();
  const model = (settings.models[provider.id] || defaultModel(provider.id)).trim();
  if (!apiKey && !provider.optionalKey) return { ai: null, problem: `Pega tu clave de ${provider.label.split(' (')[0]} para usar la lectura con IA, o desactívala.` };
  if (!model) return { ai: null, problem: 'Escribe el nombre del modelo con visión que quieres usar.' };
  if (provider.editableUrl && !/^https?:\/\//i.test(settings.baseUrl.trim())) return { ai: null, problem: 'La URL base debe empezar con http:// o https://.' };
  return { ai: { provider: provider.id, apiKey, model, baseUrl: provider.editableUrl ? settings.baseUrl.trim() : provider.baseUrl } };
}
