/* Proveedores de IA con visión. Cada uno define cómo se arma la petición y cómo se lee la respuesta.
   Todos se llaman directo desde el navegador con la clave de la persona (sin servidor intermedio). */

export const PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    free: true,
    format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    concurrency: 2,
    note: 'Gratis con límites por minuto y por día. En el plan gratis Google puede usar lo que envíes para mejorar sus productos: no subas documentos privados.',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (recomendado)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (más rápido, menos preciso)' },
      { id: 'gemma-4-31b-it', label: 'Gemma 4 31B (abierto)' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (modelos :free)',
    free: true,
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    concurrency: 1,
    note: 'Cuenta gratuita sin tarjeta. Los modelos :free tienen un límite diario bajo (aprox. 50 solicitudes al día; más si has cargado créditos) y los proveedores pueden registrar lo enviado.',
    models: [
      { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'NVIDIA Nemotron 3.5 Super VL (gratis)' },
      { id: 'google/gemma-4-31b-it:free', label: 'Google Gemma 4 31B (gratis)' },
      { id: 'openrouter/free', label: 'Automático: OpenRouter elige un modelo gratis' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq (Llama 4 Scout)',
    free: true,
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    concurrency: 2,
    note: 'Gratis, muy rápido (límite aprox. 1000 solicitudes al día). El modelo de visión está en "preview" y es menos preciso con esquemas complejos.',
    models: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B (visión)' }],
  },
  {
    id: 'custom',
    label: 'Personalizado / local (Ollama, LM Studio, OpenCode…)',
    free: true,
    format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    editableUrl: true,
    optionalKey: true,
    keyHint: '(opcional)',
    concurrency: 1,
    note: 'Cualquier servidor compatible con la API de OpenAI (/chat/completions) que acepte imágenes. Con Ollama o LM Studio en tu computadora es gratis y privado, pero el servidor debe permitir el origen de esta web (en Ollama: variable OLLAMA_ORIGINS). Escribe un modelo con visión, por ejemplo llama3.2-vision o qwen2.5vl.',
    models: [],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude (de pago)',
    free: false,
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    concurrency: 3,
    note: 'De pago, el más preciso con reacciones y esquemas. Cada página tiene un costo en tu cuenta de Anthropic.',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recomendado)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (más barato, menos preciso)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (el más preciso, el más caro)' },
    ],
  },
];

export const DEFAULT_PROVIDER = 'gemini';
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
export const defaultModel = (id) => getProvider(id).models[0]?.id || '';

const MAX_OUTPUT_TOKENS = 4096;

/* content: { system, text, image (base64 JPEG) } -> { url, headers, body } */
export function buildRequest({ provider, apiKey, model, baseUrl }, { system, text, image }) {
  const base = String(baseUrl || provider.baseUrl).replace(/\/+$/, '');
  const json = { 'content-type': 'application/json' };

  if (provider.format === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        ...json,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Obligatorio para llamar a la API desde un navegador, con la clave de la propia persona.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system,
        messages: [
          { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text }] },
        ],
      },
    };
  }

  if (provider.format === 'gemini') {
    // Gemma por la API de Gemini no acepta "systemInstruction": se antepone al mensaje.
    const inlineSystem = /^gemma/i.test(model);
    const parts = [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: inlineSystem ? `${system}\n\n---\n\n${text}` : text }];
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { ...json, 'x-goog-api-key': apiKey },
      body: {
        ...(inlineSystem ? {} : { systemInstruction: { parts: [{ text: system }] } }),
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
      },
    };
  }

  // Compatible con OpenAI (OpenRouter, Groq, Ollama, LM Studio, OpenCode Zen...)
  return {
    url: `${base}/chat/completions`,
    headers: { ...json, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
          ],
        },
      ],
    },
  };
}

/* data: JSON de la respuesta -> { text, truncated } (lanza Error con mensaje legible si no hay texto) */
export function parseResponse(provider, data) {
  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'La API devolvió un error.');
  }

  if (provider.format === 'anthropic') {
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { text, truncated: data.stop_reason === 'max_tokens' };
  }

  if (provider.format === 'gemini') {
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini bloqueó esta página (${data.promptFeedback.blockReason}).`);
    const candidate = data.candidates?.[0];
    // Se ignoran las partes de "pensamiento" de los modelos con razonamiento.
    const text = (candidate?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('\n');
    return { text, truncated: candidate?.finishReason === 'MAX_TOKENS' };
  }

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const text = Array.isArray(content) ? content.map((p) => p.text || '').join('\n') : content || '';
  return { text, truncated: choice?.finish_reason === 'length' };
}

/* Devuelve { message, fatal, kind, retryAfter } para un error HTTP. raw = texto JSON de la respuesta. */
export function classifyHttpError(status, raw, { provider, model }) {
  let apiMessage = '';
  try {
    const parsed = JSON.parse(raw);
    apiMessage = parsed?.error?.message || parsed?.message || '';
  } catch {
    apiMessage = String(raw || '').slice(0, 200);
  }
  const all = `${apiMessage} ${raw || ''}`;
  const delay = all.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const retryAfter = delay ? Number(delay[1]) : undefined;

  const fatal = (message, kind) => ({ message, fatal: true, kind, retryAfter });

  if (status === 401 || (status === 400 && /api key not valid|invalid api key|incorrect api key/i.test(all))) {
    return fatal('La clave de API no es válida. Revisa que esté completa y sin espacios.', 'auth');
  }
  if (status === 403) return fatal(`Tu clave no tiene permiso para usar este servicio o modelo${apiMessage ? ` (${apiMessage.slice(0, 120)})` : ''}.`, 'auth');
  if (status === 402 || (status === 400 && /credit|balance|billing/i.test(all))) {
    return fatal('Tu cuenta no tiene saldo o créditos suficientes.', 'quota');
  }
  if (status === 404) {
    return fatal(
      provider.editableUrl
        ? 'No se encontró el servidor o el modelo. Revisa la URL base y el nombre del modelo.'
        : `El modelo ${model} no está disponible con tu clave. Elige otro modelo.`,
      'model',
    );
  }
  if (status === 429 && /per.?day|daily|quota.*(exceeded|exhausted)|resource.?exhausted.*day/i.test(all)) {
    return fatal('Se agotó el límite diario gratuito de este proveedor. Espera a que se reinicie (o usa otro proveedor) y vuelve a intentarlo.', 'quota');
  }
  if (status === 429) return { message: 'El proveedor pidió esperar por exceso de solicitudes.', fatal: false, kind: 'rate', retryAfter };
  if (status >= 500) return { message: 'El servicio del proveedor está saturado o falló.', fatal: false, kind: 'server', retryAfter };
  if (status === 400 && /image|vision|multimodal|modalit/i.test(all)) {
    return fatal(`El modelo ${model} no acepta imágenes. Elige un modelo con visión.`, 'model');
  }
  return { message: `El proveedor rechazó esta página (${status}): ${apiMessage.slice(0, 160) || 'sin detalle'}`, fatal: false, kind: 'other', retryAfter };
}
