import { ERR, MSG, QhError } from '../shared/protocol.js';
import { getSettings, saveSettings } from './settings.js';
import { cropToJpeg } from './crop.js';
import { ask } from './llm.js';

const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source|data):/i;
const WEB_STORE_URL = /^https:\/\/chromewebstore\.google\.com\//i;
const MAX_SHOT_CHARS = 40_000_000;

/** @type {null | { requestId: string, tabId: number, shot: string | null, controller: AbortController, keepalive: number | null }} */
let session = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture' || command === 'capture_media') void captureActiveTab();
});

chrome.action.onClicked.addListener((tab) => {
  void captureActiveTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === MSG.REGION) {
    void handleRegion(message, sender);
    return false;
  }
  if (message.type === MSG.CANCEL) {
    abortSession();
    return false;
  }
  if (message.type === MSG.SAVE_DISPLAY) {
    void saveSettings({ display: message.display }).catch(() => {});
    return false;
  }
  return false;
});

/**
 * @param {chrome.tabs.Tab} [tabArgument]
 */
async function captureActiveTab(tabArgument) {
  const tab = tabArgument ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || typeof tab.id !== 'number') return;

  if (isRestricted(tab.url)) {
    await reportError(tab.id, new QhError(ERR.RESTRICTED_PAGE, '此页面不支持截图'));
    return;
  }

  abortSession();
  const requestId = crypto.randomUUID();

  try {
    const settings = await getSettings().catch(() => null);
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (typeof shot !== 'string' || shot.length > MAX_SHOT_CHARS) {
      throw new QhError(ERR.TOO_LARGE, '截图过大');
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/select.js', 'src/content/display.js'],
    });

    session = {
      requestId,
      tabId: tab.id,
      shot,
      controller: new AbortController(),
      keepalive: null,
    };

    await chrome.tabs.sendMessage(tab.id, {
      type: MSG.SHOW_SELECTOR,
      requestId,
      shot,
      examMode: Boolean(settings?.display?.examMode),
      selectionOpacity: settings?.display?.selectionOpacity,
    });
  } catch (error) {
    if (session?.requestId === requestId) session = null;
    await reportError(tab.id, toQhError(error));
  }
}

async function handleRegion(message, sender) {
  const tabId = sender.tab?.id;
  const current = session;
  if (!Number.isInteger(tabId) || !current || current.requestId !== message.requestId) return;

  const region = message.region;
  if (!region?.rect || !region?.viewport) return;

  try {
    const settings = await getSettings();
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.STREAM_START,
      requestId: current.requestId,
      anchor: region.rect,
      display: settings.display,
    });

    if (!settings.apiKey) throw new QhError(ERR.NO_KEY, '未配置 API Key，正在打开设置页');
    if (!current.shot) throw new QhError(ERR.BAD_RESPONSE, '截图已失效，请重新框选');

    const { dataUrl } = await cropToJpeg(current.shot, region.rect, region.viewport);
    current.shot = null;
    startKeepalive(current);

    const flusher = createFlusher(tabId, current.requestId);
    await ask({
      imageDataUrl: dataUrl,
      settings,
      signal: current.controller.signal,
      onDelta: flusher.push,
      onStatus: (text) => {
        if (!text) return;
        chrome.tabs
          .sendMessage(tabId, {
            type: MSG.STREAM_STATUS,
            requestId: current.requestId,
            text,
          })
          .catch(() => {});
      },
    });
    flusher.done();

    await chrome.tabs.sendMessage(tabId, {
      type: MSG.STREAM_DONE,
      requestId: current.requestId,
    });
  } catch (error) {
    const failure = toQhError(error);
    if (failure.code === ERR.ABORTED) return;

    await chrome.tabs
      .sendMessage(tabId, {
        type: MSG.STREAM_ERROR,
        requestId: current.requestId,
        code: failure.code,
        message: failure.message,
      })
      .catch(() => {});

    if (failure.code === ERR.NO_KEY) {
      void chrome.runtime.openOptionsPage().catch(() => {});
    }
  } finally {
    stopKeepalive(current);
    if (session === current) session = null;
  }
}

/**
 * @param {number} tabId
 * @param {string} requestId
 */
function createFlusher(tabId, requestId) {
  const buffered = { answer: '', explanation: '' };
  let timer = null;

  const flush = () => {
    timer = null;
    for (const channel of ['answer', 'explanation']) {
      const text = buffered[channel];
      if (!text) continue;
      buffered[channel] = '';
      chrome.tabs
        .sendMessage(tabId, { type: MSG.STREAM_DELTA, requestId, channel, text })
        .catch(() => {});
    }
  };

  return {
    /** @param {{ channel: 'answer' | 'explanation', text: string }} delta */
    push(delta) {
      if (!delta || (delta.channel !== 'answer' && delta.channel !== 'explanation')) return;
      buffered[delta.channel] += delta.text;
      if (!timer) timer = setTimeout(flush, 60);
    },
    done() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

async function reportError(tabId, error) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.STREAM_ERROR,
      requestId: null,
      code: error.code,
      message: error.message,
    });
  } catch {
    await flashBadge(tabId);
  }
}

async function flashBadge(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#B3261E' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }, 3000);
  } catch {
    /* tab already gone */
  }
}

function abortSession() {
  if (!session) return;
  const current = session;
  session = null;
  stopKeepalive(current);
  try {
    current.controller.abort();
  } catch {
    /* already aborted */
  }
}

/**
 * Service workers are recycled after ~30s idle. An in-flight fetch usually
 * keeps them alive, but a cheap periodic API call makes it deterministic.
 *
 * @param {{ keepalive: number | null }} current
 */
function startKeepalive(current) {
  if (current.keepalive !== null) return;
  current.keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
}

function stopKeepalive(current) {
  if (current.keepalive === null) return;
  clearInterval(current.keepalive);
  current.keepalive = null;
}

function toQhError(error) {
  if (error instanceof QhError) return error;
  if (error?.name === 'AbortError') return new QhError(ERR.ABORTED, '已取消');
  const message = error?.message ? String(error.message) : '操作失败';
  if (/cannot access|extensions gallery|chrome:\/\//i.test(message)) {
    return new QhError(ERR.RESTRICTED_PAGE, '此页面不支持截图');
  }
  return new QhError(ERR.NETWORK, message);
}

function isRestricted(url) {
  if (!url) return false;
  return RESTRICTED_URL.test(url) || WEB_STORE_URL.test(url);
}
