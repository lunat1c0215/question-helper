(() => {
  if (globalThis.__QH_DISPLAY_INSTALLED) return;
  globalThis.__QH_DISPLAY_INSTALLED = true;

  const MSG = {
    START: 'QH_STREAM_START',
    DELTA: 'QH_STREAM_DELTA',
    DONE: 'QH_STREAM_DONE',
    ERROR: 'QH_STREAM_ERROR',
    STATUS: 'QH_STREAM_STATUS',
  };
  const GAP = 10;
  const DEFAULT_DISPLAY = { opacity: 0.85, fontSize: 13, autoHideMs: 8000, examMode: false };
  const OPACITY_MIN = 0.35;
  const OPACITY_MAX = 1;
  const OPACITY_STEP = 0.05;

  const state = { current: null };
  let opacitySaveTimer = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    try {
      handle(message);
    } catch {
      /* stay silent: page scripts can wrap console */
    }
  });

  window.addEventListener('keydown', onKeyDown, true);

  function handle(message) {
    switch (message.type) {
      case MSG.START:
        start(message);
        break;
      case MSG.DELTA:
        append(message);
        break;
      case MSG.DONE:
        finish(message);
        break;
      case MSG.ERROR:
        fail(message);
        break;
      case MSG.STATUS:
        status(message);
        break;
      default:
        break;
    }
  }

  function start(message) {
    cleanup();
    const anchor = normalizeRect(message.anchor);
    const display = { ...DEFAULT_DISPLAY, ...(message.display || {}) };
    if (display.examMode) {
      display.autoHideMs = Math.min(display.autoHideMs || 3500, 3500);
    }
    state.current = {
      requestId: message.requestId,
      anchor,
      display,
      sampled: sampleStyle(anchor),
      answer: '',
      explanation: '',
      statusText: '',
      visible: false,
      expanded: false,
      done: false,
      host: null,
      panel: null,
      answerEl: null,
      explanationEl: null,
      hideTimer: null,
      moveHandler: null,
      dismissHandlers: null,
      side: 'right',
    };
  }

  function append(message) {
    const current = state.current;
    if (!current || message.requestId !== current.requestId) return;

    if (message.channel === 'answer') {
      current.answer += message.text;
      current.statusText = '';
      ensureHost(current);
      if (current.answerEl) {
        current.answerEl.classList.remove('status');
        current.answerEl.textContent = current.answer;
      }
    } else if (message.channel === 'explanation') {
      current.explanation += message.text;
      if (current.expanded && current.explanationEl) {
        current.explanationEl.textContent = current.explanation;
      }
    }
  }

  function status(message) {
    const current = state.current;
    if (!current || message.requestId !== current.requestId) return;
    if (current.answer) return;

    const text = typeof message.text === 'string' ? message.text : '';
    if (!text) return;

    current.statusText = text;
    ensureHost(current);
    if (current.answerEl) {
      current.answerEl.classList.add('status');
      current.answerEl.textContent = text;
    }
  }

  function finish(message) {
    const current = state.current;
    if (!current || message.requestId !== current.requestId) return;
    current.done = true;
    current.statusText = '';

    if (!current.answer) {
      current.answer = current.explanation ? '（无答案）' : '未返回结果';
      ensureHost(current);
      if (current.answerEl) current.answerEl.textContent = current.answer;
    }
    if (current.answerEl) current.answerEl.classList.remove('status');
    scheduleHide(current);
  }

  function fail(message) {
    const current = state.current;
    if (!current) return;
    if (message.requestId !== null && message.requestId !== current.requestId) return;

    const note = message.message || message.code || '请求失败';
    current.statusText = '';
    current.answer = current.answer ? `${current.answer}\n（中断：${note}）` : note;
    current.done = true;
    ensureHost(current);
    if (current.answerEl) {
      current.answerEl.classList.remove('status');
      current.answerEl.textContent = current.answer;
    }
    scheduleHide(current, 12000);
  }

  function ensureHost(current) {
    if (!current || current.visible) return;
    if (!document.documentElement) return;

    const host = document.createElement('div');
    host.style.cssText = 'all: initial; display: block; width: 0; height: 0;';

    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; }
      .panel {
        position: fixed;
        z-index: 2147483647;
        max-width: min(42vw, 420px);
        min-width: 120px;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        pointer-events: none;
        font-weight: 400;
        letter-spacing: 0;
      }
      .ans { white-space: pre-wrap; }
      .ans.status { opacity: 0.72; }
      .expl {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid currentColor;
        opacity: 0.88;
        font-size: 0.92em;
        max-height: 40vh;
        overflow: auto;
        pointer-events: auto;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.fontFamily = current.sampled.fontFamily;
    panel.style.fontSize = `${current.display.fontSize}px`;
    panel.style.color = current.sampled.color;
    panel.style.opacity = String(current.display.opacity);
    panel.style.textShadow = `0 0 3px ${current.sampled.background}, 0 0 6px ${current.sampled.background}`;

    const answerEl = document.createElement('div');
    answerEl.className = 'ans';
    answerEl.textContent = current.answer;
    panel.append(answerEl);
    shadow.append(panel);
    (document.body || document.documentElement).appendChild(host);

    current.host = host;
    current.panel = panel;
    current.answerEl = answerEl;
    current.visible = true;
    current.expanded = false;

    place(current);
    watchPointer(current);
    watchDismiss(current);
  }

  function place(current) {
    const rect = current.anchor;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const approxWidth = Math.min(Math.max(200, viewportWidth * 0.3), 420);
    const style = current.panel.style;

    style.left = '';
    style.right = '';
    style.top = '';
    style.bottom = '';

    let side;
    if (rect.x + rect.w + GAP + approxWidth <= viewportWidth) side = 'right';
    else if (rect.x - GAP - approxWidth >= 0) side = 'left';
    else if (rect.y + rect.h + GAP + 70 <= viewportHeight) side = 'below';
    else side = 'above';
    current.side = side;

    if (side === 'right') {
      style.left = `${Math.round(rect.x + rect.w + GAP)}px`;
      style.top = `${Math.round(clamp(rect.y, 8, Math.max(8, viewportHeight - 80)))}px`;
    } else if (side === 'left') {
      style.right = `${Math.round(viewportWidth - rect.x + GAP)}px`;
      style.top = `${Math.round(clamp(rect.y, 8, Math.max(8, viewportHeight - 80)))}px`;
    } else if (side === 'below') {
      style.top = `${Math.round(rect.y + rect.h + GAP)}px`;
      style.left = `${Math.round(clamp(rect.x, 8, Math.max(8, viewportWidth - 220)))}px`;
    } else {
      style.bottom = `${Math.round(viewportHeight - rect.y + GAP)}px`;
      style.left = `${Math.round(clamp(rect.x, 8, Math.max(8, viewportWidth - 220)))}px`;
    }
  }

  function watchPointer(current) {
    if (current.moveHandler) return;
    current.moveHandler = (event) => {
      if (!current.panel) return;
      const box = current.panel.getBoundingClientRect();
      const near =
        event.clientX >= box.left - 8 &&
        event.clientX <= box.right + 8 &&
        event.clientY >= box.top - 8 &&
        event.clientY <= box.bottom + 8;
      if (near) {
        if (current.hideTimer) {
          clearTimeout(current.hideTimer);
          current.hideTimer = null;
        }
      } else if (!current.hideTimer && current.done && !current.expanded) {
        scheduleHide(current);
      }
    };
    window.addEventListener('mousemove', current.moveHandler, { passive: true });
  }

  function watchDismiss(current) {
    if (current.dismissHandlers) return;

    const insidePanel = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      return current.host ? path.includes(current.host) : false;
    };

    const onWheel = (event) => {
      if (!current.visible || insidePanel(event)) return;
      hide(current);
    };

    const onPointerDown = (event) => {
      if (!current.visible || insidePanel(event)) return;
      hide(current);
    };

    const onScroll = (event) => {
      if (!current.visible || insidePanel(event)) return;
      hide(current);
    };

    const hideNow = () => {
      if (current.visible) hide(current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hideNow();
    };
    const onBlur = () => hideNow();
    const onPageHide = () => hideNow();

    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);

    current.dismissHandlers = {
      onWheel,
      onPointerDown,
      onScroll,
      onVisibility,
      onBlur,
      onPageHide,
    };
  }

  function clearDismiss(current) {
    if (!current.dismissHandlers) return;
    window.removeEventListener('wheel', current.dismissHandlers.onWheel, true);
    window.removeEventListener('pointerdown', current.dismissHandlers.onPointerDown, true);
    window.removeEventListener('scroll', current.dismissHandlers.onScroll, true);
    document.removeEventListener('visibilitychange', current.dismissHandlers.onVisibility, true);
    window.removeEventListener('blur', current.dismissHandlers.onBlur);
    window.removeEventListener('pagehide', current.dismissHandlers.onPageHide);
    current.dismissHandlers = null;
  }

  function scheduleHide(current, overrideMs) {
    if (current.hideTimer) {
      clearTimeout(current.hideTimer);
      current.hideTimer = null;
    }
    const delay = overrideMs ?? current.display.autoHideMs;
    if (!delay) return;
    current.hideTimer = setTimeout(() => {
      current.hideTimer = null;
      hide(current);
    }, delay);
  }

  function hide(current) {
    if (!current) return;
    clearDismiss(current);
    if (current.hideTimer) {
      clearTimeout(current.hideTimer);
      current.hideTimer = null;
    }
    if (current.host) current.host.remove();
    current.host = null;
    current.panel = null;
    current.answerEl = null;
    current.explanationEl = null;
    current.visible = false;
    current.expanded = false;
  }

  function show(current) {
    if (!current) return;
    ensureHost(current);
    scheduleHide(current);
  }

  function toggleExplanation(current) {
    if (!current || !current.visible || !current.explanation) return;
    current.expanded = !current.expanded;

    if (current.expanded) {
      if (!current.explanationEl) {
        const el = document.createElement('div');
        el.className = 'expl';
        current.panel.append(el);
        current.explanationEl = el;
      }
      current.explanationEl.textContent = current.explanation;
    } else if (current.explanationEl) {
      current.explanationEl.remove();
      current.explanationEl = null;
    }

    scheduleHide(current, current.expanded ? 30000 : undefined);
  }

  function onKeyDown(event) {
    const current = state.current;
    if (!current) return;

    if (event.key === 'Escape') {
      if (current.visible) {
        event.preventDefault();
        event.stopPropagation();
        hide(current);
      }
      return;
    }

    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

    if (key === 'z') {
      // Ctrl+Shift+Z is redo in most editors, so only take it while the answer
      // is on screen and never while an editable field has focus.
      if (!current.visible || isEditableTarget(event.target)) return;
      toggleExplanation(current);
      event.preventDefault();
      event.stopPropagation();
    } else if (key === 'h') {
      if (current.visible) hide(current);
      else show(current);
      event.preventDefault();
      event.stopPropagation();
    } else if (key === 'y') {
      copyText(current);
      event.preventDefault();
      event.stopPropagation();
    } else if (
      key === 'arrowup' ||
      key === 'arrowdown' ||
      key === '0' ||
      event.code === 'Digit0' ||
      event.code === 'Numpad0'
    ) {
      if (!current.visible || isEditableTarget(event.target)) return;
      adjustOpacity(current, key);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function adjustOpacity(current, key) {
    let value = current.display.opacity;
    if (key === 'arrowup') value += OPACITY_STEP;
    else if (key === 'arrowdown') value -= OPACITY_STEP;
    else value = DEFAULT_DISPLAY.opacity;

    value = Math.round(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value)) * 100) / 100;
    if (value === current.display.opacity) return;

    current.display.opacity = value;
    if (current.panel) current.panel.style.opacity = String(value);
    if (current.done) scheduleHide(current);
    persistOpacity(value);
  }

  function persistOpacity(value) {
    if (opacitySaveTimer) clearTimeout(opacitySaveTimer);
    opacitySaveTimer = setTimeout(() => {
      opacitySaveTimer = null;
      chrome.runtime
        .sendMessage({ type: 'QH_SAVE_DISPLAY', display: { opacity: value } })
        .catch(() => {});
    }, 250);
  }

  function copyText(current) {
    const text =
      current.expanded && current.explanation
        ? `${current.answer}\n\n${current.explanation}`
        : current.answer;
    if (!text) return;

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
    document.documentElement.append(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      /* clipboard unavailable */
    }
    area.remove();
  }

  function cleanup() {
    const current = state.current;
    if (!current) return;
    clearDismiss(current);
    if (current.hideTimer) clearTimeout(current.hideTimer);
    if (current.moveHandler) window.removeEventListener('mousemove', current.moveHandler);
    if (current.host) current.host.remove();
    state.current = null;
  }

  function sampleStyle(anchor) {
    const x = clamp(anchor.x + anchor.w / 2, 0, Math.max(0, window.innerWidth - 1));
    const y = clamp(anchor.y + anchor.h / 2, 0, Math.max(0, window.innerHeight - 1));
    let element = null;
    try {
      element = document.elementFromPoint(x, y);
    } catch {
      element = null;
    }
    if (!element || element.nodeType !== 1) element = document.body;
    if (!element) return { fontFamily: 'system-ui, sans-serif', color: '#111', background: '#fff' };

    const computed = getComputedStyle(element);
    const background = effectiveBackground(element);
    return {
      fontFamily: computed.fontFamily || 'system-ui, sans-serif',
      color: ensureContrast(computed.color || '#111', background),
      background,
    };
  }

  function effectiveBackground(element) {
    let node = element;
    while (node && node.nodeType === 1) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && !isTransparent(background)) return background;
      node = node.parentElement;
    }
    const bodyBackground = document.body ? getComputedStyle(document.body).backgroundColor : '';
    return bodyBackground && !isTransparent(bodyBackground) ? bodyBackground : 'rgb(255, 255, 255)';
  }

  function isTransparent(value) {
    return /^rgba\(0, 0, 0, 0\)$/i.test(value) || /^transparent$/i.test(value);
  }

  function ensureContrast(color, background) {
    const foreground = parseColor(color);
    const backdrop = parseColor(background);
    if (!foreground || !backdrop) return color;

    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(backdrop);
    const ratio =
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    if (ratio >= 3) return color;
    return backgroundLuminance > 0.5 ? 'rgb(20, 20, 20)' : 'rgb(240, 240, 240)';
  }

  function parseColor(value) {
    if (typeof value !== 'string') return null;
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
    if (!match) return null;
    return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
  }

  function luminance(rgb) {
    const [r, g, b] = rgb.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function normalizeRect(rect) {
    return {
      x: Number(rect?.x) || 0,
      y: Number(rect?.y) || 0,
      w: Math.max(0, Number(rect?.w) || 0),
      h: Math.max(0, Number(rect?.h) || 0),
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
})();
