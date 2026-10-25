import { getSettings, saveSettings } from '../background/settings.js';

const $ = (id) => document.getElementById(id);

const status = $('status');
let statusTimer = null;

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = kind;
  if (statusTimer) clearTimeout(statusTimer);
  if (text) {
    statusTimer = setTimeout(() => {
      status.textContent = '';
      status.className = '';
    }, 5000);
  }
}

function fill(settings) {
  $('apiKey').value = settings.apiKey;
  $('model').value = settings.model;
  $('baseUrl').value = settings.baseUrl;
  $('maxTokens').value = String(settings.maxTokens);
  $('searchEnabled').checked = Boolean(settings.search.enabled);
  $('searchCount').value = String(settings.search.count);
  $('opacity').value = String(settings.display.opacity);
  $('opacityValue').textContent = settings.display.opacity.toFixed(2);
  $('selectionOpacity').value = String(settings.display.selectionOpacity);
  $('selectionOpacityValue').textContent = settings.display.selectionOpacity.toFixed(2);
  $('fontSize').value = String(settings.display.fontSize);
  $('autoHideMs').value = String(settings.display.autoHideMs);
  $('examMode').checked = Boolean(settings.display.examMode);
}

function readForm() {
  return {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || 'deepseek-flash',
    baseUrl: $('baseUrl').value.trim() || 'https://api.deepseek.com',
    maxTokens: Number($('maxTokens').value) || 900,
    search: {
      enabled: $('searchEnabled').checked,
      count: Number($('searchCount').value) || 5,
    },
    display: {
      opacity: Number($('opacity').value),
      selectionOpacity: Number($('selectionOpacity').value),
      fontSize: Number($('fontSize').value),
      autoHideMs: Number($('autoHideMs').value),
      examMode: $('examMode').checked,
    },
  };
}

async function persist() {
  const settings = await saveSettings(readForm());
  fill(settings);
  return settings;
}

$('opacity').addEventListener('input', () => {
  $('opacityValue').textContent = Number($('opacity').value).toFixed(2);
});

$('selectionOpacity').addEventListener('input', () => {
  $('selectionOpacityValue').textContent = Number($('selectionOpacity').value).toFixed(2);
});

$('save').addEventListener('click', async () => {
  try {
    await persist();
    setStatus('已保存', 'ok');
  } catch (error) {
    setStatus(`保存失败：${error.message}`, 'error');
  }
});

$('test').addEventListener('click', async () => {
  const button = $('test');
  button.disabled = true;
  setStatus('测试中…');

  try {
    const settings = await persist();
    if (!settings.apiKey) throw new Error('请先填写 API Key');

    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new Error(`HTTP ${response.status} ${detail}`);
    }

    if (!settings.search.enabled) {
      setStatus('连接正常（检索已关闭）', 'ok');
      return;
    }

    const searchResponse = await fetch(`${settings.baseUrl}/v1/tools/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({ query: 'DeepSeek', count: 1, need_content: false }),
    });
    if (!searchResponse.ok) {
      const detail = (await searchResponse.text()).slice(0, 200);
      throw new Error(`对话正常，检索失败 HTTP ${searchResponse.status} ${detail}`);
    }
    setStatus('连接正常 · 检索正常', 'ok');
  } catch (error) {
    setStatus(`失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
});

$('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
});

async function renderShortcutState() {
  const node = $('shortcutState');
  try {
    const commands = await chrome.commands.getAll();
    const capture = commands.find((command) => command.name === 'capture');
    const media = commands.find((command) => command.name === 'capture_media');
    const parts = [capture?.shortcut ? `框选：${capture.shortcut}` : '框选：未分配'];
    if (media?.shortcut) parts.push(`单键：${media.shortcut}`);

    node.textContent = parts.join(' · ');
    if (capture?.shortcut) {
      node.className = 'hint';
    } else {
      node.textContent = `${parts.join(' · ')}：点「修改快捷键」手动设置`;
      node.className = 'hint warn';
    }
  } catch {
    node.textContent = '';
  }
}

window.addEventListener('focus', renderShortcutState);
await renderShortcutState();
fill(await getSettings());
