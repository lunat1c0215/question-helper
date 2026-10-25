import { createChannelSplitter } from '../shared/channel.js';
import { createSseParser } from '../shared/sse.js';
import { buildExtractText, buildUserText, EXTRACT_PROMPT, SYSTEM_PROMPT } from '../shared/prompt.js';
import {
  buildOriQuestion,
  buildSearchQuery,
  formatSearchContext,
  parseExtraction,
} from '../shared/search-context.js';
import { QhError, ERR } from '../shared/protocol.js';
import { webSearch } from './search.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * @param {{
 *   imageDataUrl: string,
 *   settings: any,
 *   signal: AbortSignal,
 *   onDelta: (delta: { channel: 'answer' | 'explanation', text: string }) => void,
 *   onStatus?: (text: string) => void,
 * }} options
 */
export async function ask({ imageDataUrl, settings, signal, onDelta, onStatus }) {
  const reference = await gatherReference({ imageDataUrl, settings, signal, onStatus });
  let attempt = 1;

  for (;;) {
    let emitted = false;
    try {
      await requestOnce({
        imageDataUrl,
        settings,
        reference,
        signal,
        onDelta: (delta) => {
          emitted = true;
          onDelta(delta);
        },
      });
      return;
    } catch (error) {
      const failure = toQhError(error);
      const retryable =
        !emitted &&
        failure.code === ERR.HTTP &&
        RETRYABLE_STATUS.has(failure.detail?.status) &&
        attempt < MAX_ATTEMPTS;

      if (!retryable) throw failure;
      attempt += 1;
      await delay(400 * 2 ** (attempt - 1), signal);
    }
  }
}

/**
 * Optional "vision extract -> search -> answer" prelude.
 *
 * Every failure here degrades to answering without references: search is an
 * accuracy aid, never a hard dependency.
 */
async function gatherReference({ imageDataUrl, settings, signal, onStatus }) {
  if (!settings?.search?.enabled) return '';

  let extraction;
  try {
    // Extraction stays silent: the panel should never advertise an OCR stage.
    extraction = await extractQuestion({ imageDataUrl, settings, signal });
  } catch (error) {
    throwIfAborted(error, signal);
    onStatus?.('作答中…');
    return '';
  }

  if (!extraction || extraction.needsSearch === false) {
    onStatus?.('作答中…');
    return '';
  }

  const query = buildSearchQuery(extraction);
  if (!query) {
    onStatus?.('作答中…');
    return '';
  }

  try {
    onStatus?.('联网检索…');
    const results = await webSearch({
      query,
      oriQuestion: buildOriQuestion(extraction),
      settings,
      signal,
    });
    const context = formatSearchContext(results);
    onStatus?.(context ? '作答中…' : '未检索到相关网页');
    return context;
  } catch (error) {
    throwIfAborted(error, signal);
    onStatus?.('检索失败，直接作答');
    return '';
  }
}

async function extractQuestion({ imageDataUrl, settings, signal }) {
  const body = {
    model: settings.model,
    stream: false,
    max_tokens: 800,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACT_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildExtractText() },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'original' } },
        ],
      },
    ],
  };

  const send = (payload) => {
    return fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  };

  let response;
  try {
    response = await send(body);
    // Some OpenAI-compatible deployments reject response_format on vision
    // requests; the prompt already demands JSON, so retry once without it.
    if (response.status === 400) {
      try {
        await response.body?.cancel();
      } catch {
        /* body already consumed or absent */
      }
      delete body.response_format;
      response = await send(body);
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new QhError(ERR.ABORTED, '已取消');
    throw new QhError(ERR.NETWORK, '网络请求失败');
  }

  if (!response.ok) {
    const text = await readText(response);
    throw new QhError(ERR.HTTP, explainStatus(response.status, text), {
      status: response.status,
      body: text.slice(0, 800),
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new QhError(ERR.BAD_RESPONSE, '题目识别返回格式异常');
  }

  return parseExtraction(data?.choices?.[0]?.message?.content);
}

function throwIfAborted(error, signal) {
  if (signal?.aborted || error?.code === ERR.ABORTED || error?.name === 'AbortError') {
    throw new QhError(ERR.ABORTED, '已取消');
  }
}

async function requestOnce({ imageDataUrl, settings, reference, signal, onDelta }) {
  const body = {
    model: settings.model,
    stream: true,
    max_tokens: settings.maxTokens,
    // Thinking is on by default and its CoT shares the max_tokens budget.
    // For a short answer we want the budget spent on content, not reasoning.
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserText('', reference) },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'original' } },
        ],
      },
    ],
  };

  let response;
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new QhError(ERR.ABORTED, '已取消');
    throw new QhError(ERR.NETWORK, '网络请求失败');
  }

  if (!response.ok) {
    const text = await readText(response);
    throw new QhError(ERR.HTTP, explainStatus(response.status, text), {
      status: response.status,
      body: text.slice(0, 800),
    });
  }
  if (!response.body) throw new QhError(ERR.BAD_RESPONSE, '响应为空');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const splitter = createChannelSplitter();
  let finishReason = null;
  let sawReasoning = false;
  let emittedAny = false;

  const parser = createSseParser({
    onMessage(payload) {
      if (payload?.error) {
        throw new QhError(ERR.HTTP, payload.error.message || '服务端返回错误');
      }
      const choice = payload?.choices?.[0];
      const delta = choice?.delta;

      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
        sawReasoning = true;
      }

      const text = delta?.content;
      if (typeof text === 'string' && text) {
        for (const chunk of splitter.push(text)) {
          if (!chunk.text) continue;
          emittedAny = true;
          onDelta(chunk);
        }
      }
    },
  });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();

  for (const chunk of splitter.end()) {
    if (!chunk.text) continue;
    emittedAny = true;
    onDelta(chunk);
  }

  if (!emittedAny) throw emptyStreamError({ finishReason, sawReasoning });
}

/**
 * @param {{ finishReason?: string | null, sawReasoning?: boolean }} outcome
 */
export function emptyStreamError({ finishReason, sawReasoning } = {}) {
  if (finishReason === 'length') {
    return new QhError(ERR.BAD_RESPONSE, '输出被截断：max_tokens 不足，请在设置页调大');
  }
  if (sawReasoning) {
    return new QhError(ERR.BAD_RESPONSE, '模型只返回了思考过程，未给出答案');
  }
  const suffix = finishReason ? `（finish_reason=${finishReason}）` : '';
  return new QhError(ERR.BAD_RESPONSE, `模型未返回内容${suffix}`);
}

function explainStatus(status, body = '') {
  if (status === 400) {
    const detail = body.trim().slice(0, 160);
    return `请求被拒绝${detail ? `：${detail}` : '（检查模型名或图片格式）'}`;
  }
  if (status === 401) return 'API Key 无效';
  if (status === 402) return '账户余额不足';
  if (status === 413) return '图片过大';
  if (status === 429) return '请求过于频繁';
  if (status >= 500) return `服务端错误（${status}）`;
  return `HTTP ${status}`;
}

/**
 * @param {Response} response
 */
async function readText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function toQhError(error) {
  if (error instanceof QhError) return error;
  if (error?.name === 'AbortError') return new QhError(ERR.ABORTED, '已取消');
  return new QhError(ERR.NETWORK, error?.message || '请求失败');
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
