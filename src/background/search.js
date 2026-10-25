import { ERR, QhError } from '../shared/protocol.js';

const SEARCH_PATH = '/v1/tools/search';
const TIMEOUT_MS = 9000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * POST /v1/tools/search (DeepSeek Search tool).
 *
 * Docs: 1-128 char query, count 1-50 (we cap at 10), need_content defaults to
 * false so only `summary`/`snippet` come back. Billed per successful request.
 *
 * @param {{
 *   query: string,
 *   oriQuestion?: string,
 *   settings: { baseUrl: string, apiKey: string, search?: { count?: number } },
 *   signal: AbortSignal,
 * }} options
 * @returns {Promise<unknown[]>}
 */
export async function webSearch({ query, oriQuestion, settings, signal }) {
  const cleaned = typeof query === 'string' ? query.trim() : '';
  if (!cleaned) return [];

  const body = {
    query: cleaned,
    count: clampCount(settings?.search?.count),
    need_content: false,
  };
  const ori = typeof oriQuestion === 'string' ? oriQuestion.trim() : '';
  if (ori) body.ori_question = ori;

  let attempt = 1;
  for (;;) {
    try {
      return await requestOnce({ body, settings, signal });
    } catch (error) {
      const failure = toQhError(error);
      const retryable =
        failure.code === ERR.HTTP &&
        RETRYABLE_STATUS.has(failure.detail?.status) &&
        attempt < MAX_ATTEMPTS;
      if (!retryable) throw failure;
      attempt += 1;
      await delay(300, signal);
    }
  }
}

async function requestOnce({ body, settings, signal }) {
  const url = `${settings.baseUrl}${SEARCH_PATH}`;
  const timeout = createTimeout(signal, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new QhError(ERR.ABORTED, '已取消');
    if (error?.name === 'AbortError') throw new QhError(ERR.NETWORK, '检索超时');
    throw new QhError(ERR.NETWORK, '检索请求失败');
  } finally {
    timeout.dispose();
  }

  if (!response.ok) {
    const text = await readText(response);
    throw new QhError(ERR.HTTP, explainStatus(response.status), {
      status: response.status,
      body: text.slice(0, 400),
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new QhError(ERR.BAD_RESPONSE, '检索返回格式异常');
  }

  return Array.isArray(data?.results) ? data.results : [];
}

function clampCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.min(10, Math.max(1, Math.round(number)));
}

function explainStatus(status) {
  if (status === 401) return 'API Key 无效，检索已跳过';
  if (status === 402) return '账户余额不足，检索已跳过';
  if (status === 403) return '检索请求被安全策略拒绝';
  if (status === 429) return '检索请求过于频繁';
  if (status >= 500) return `检索服务端错误（${status}）`;
  return `检索 HTTP ${status}`;
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Node and older browsers may lack AbortSignal.any/timeout; the extension only
 * needs Chrome 116+, but the fallback keeps the module testable.
 *
 * @param {AbortSignal | undefined} parent
 * @param {number} ms
 */
function createTimeout(parent, ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(ms);
    const signal =
      parent && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([parent, timeout])
        : timeout;
    return { signal, dispose: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  parent?.addEventListener('abort', onAbort, { once: true });

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function toQhError(error) {
  if (error instanceof QhError) return error;
  if (error?.name === 'AbortError') return new QhError(ERR.ABORTED, '已取消');
  return new QhError(ERR.NETWORK, error?.message || '检索失败');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new QhError(ERR.ABORTED, '已取消'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new QhError(ERR.ABORTED, '已取消'));
      },
      { once: true },
    );
  });
}
