export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  maxTokens: 900,
  search: Object.freeze({
    enabled: true,
    count: 5,
  }),
  display: Object.freeze({
    opacity: 0.85,
    selectionOpacity: 0.4,
    fontSize: 13,
    autoHideMs: 8000,
    examMode: false,
  }),
});

/**
 * @param {unknown} raw
 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const search = source.search && typeof source.search === 'object' ? source.search : {};
  const display = source.display && typeof source.display === 'object' ? source.display : {};

  return {
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    baseUrl:
      typeof source.baseUrl === 'string' && source.baseUrl.trim()
        ? source.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.baseUrl,
    model:
      typeof source.model === 'string' && source.model.trim()
        ? source.model.trim()
        : DEFAULT_SETTINGS.model,
    maxTokens: clampInt(source.maxTokens, 64, 8192, DEFAULT_SETTINGS.maxTokens),
    search: {
      enabled:
        typeof search.enabled === 'boolean' ? search.enabled : DEFAULT_SETTINGS.search.enabled,
      count: clampInt(search.count, 1, 10, DEFAULT_SETTINGS.search.count),
    },
    display: {
      opacity: clampNumber(display.opacity, 0.35, 1, DEFAULT_SETTINGS.display.opacity),
      selectionOpacity: clampNumber(
        display.selectionOpacity,
        0,
        1,
        DEFAULT_SETTINGS.display.selectionOpacity,
      ),
      fontSize: clampInt(display.fontSize, 12, 18, DEFAULT_SETTINGS.display.fontSize),
      autoHideMs: clampInt(display.autoHideMs, 0, 60000, DEFAULT_SETTINGS.display.autoHideMs),
      examMode: Boolean(display.examMode),
    },
  };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(stored.settings);
}

/**
 * @param {Partial<ReturnType<typeof normalizeSettings>> & { display?: Record<string, unknown> }} patch
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    ...patch,
    search: { ...current.search, ...(patch?.search ?? {}) },
    display: { ...current.display, ...(patch?.display ?? {}) },
  });
  await chrome.storage.local.set({ settings: next });
  return next;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
