(() => {
  if (globalThis.__QH_SELECT_INSTALLED) return;
  globalThis.__QH_SELECT_INSTALLED = true;

  const SHOW = 'QH_SHOW_SELECTOR';
  const REGION = 'QH_REGION';
  const CANCEL = 'QH_CANCEL';
  const MIN_SIDE = 8;

  /** @type {null | { host: HTMLElement, cleanup: () => void }} */
  let active = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== SHOW) return;
    try {
      start(message);
    } catch {
      /* stay silent: page scripts can wrap console */
    }
  });

  function start({ requestId, shot, examMode, selectionOpacity }) {
    teardown();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (typeof shot !== 'string' || !shot.startsWith('data:')) return;

    build(requestId, shot, viewport, examMode === true, selectionOpacity);
  }

  function build(requestId, shot, viewport, examMode, selectionOpacity) {
    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; display: block; position: fixed; left: 0; top: 0; width: 0; height: 0;';

    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; }
      .wrap { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; }
      .shot {
        position: absolute; left: 0; top: 0;
        width: 100vw; height: 100vh;
        object-fit: fill;
        user-select: none; -webkit-user-drag: none; pointer-events: none;
      }
      .sel {
        position: absolute; display: none;
        border: 1px solid rgba(255, 255, 255, 0.95);
        outline: 1px solid rgba(0, 0, 0, 0.35);
        pointer-events: none;
      }
      .hint {
        position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
        padding: 5px 10px; border-radius: 999px;
        background: rgba(0, 0, 0, 0.62); color: #fff;
        font: 12px/1.4 system-ui, sans-serif; letter-spacing: 0.2px;
        pointer-events: none; white-space: nowrap;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const image = document.createElement('img');
    image.className = 'shot';
    image.src = shot;
    image.draggable = false;
    image.alt = '';

    const selection = document.createElement('div');
    selection.className = 'sel';
    selection.style.opacity = String(normalizeOpacity(selectionOpacity));

    wrap.append(image, selection);
    // Exam mode keeps the viewport free of any chrome; the border alone
    // marks the selection.
    if (!examMode) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = '拖动框选题目 · Esc 取消';
      wrap.append(hint);
    }
    shadow.append(wrap);
    (document.body || document.documentElement).appendChild(host);

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let current = null;

    const paint = () => {
      if (!current) return;
      selection.style.left = `${current.x}px`;
      selection.style.top = `${current.y}px`;
      selection.style.width = `${current.w}px`;
      selection.style.height = `${current.h}px`;
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      current = { x: startX, y: startY, w: 0, h: 0 };
      selection.style.display = 'block';
      paint();
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best effort */
      }
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const x = event.clientX;
      const y = event.clientY;
      current = {
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        w: Math.abs(x - startX),
        h: Math.abs(y - startY),
      };
      paint();
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (!current || current.w < MIN_SIDE || current.h < MIN_SIDE) {
        current = null;
        selection.style.display = 'none';
        return;
      }
      const rect = current;
      teardown();
      sendRegion(requestId, rect, viewport);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      teardown();
      chrome.runtime.sendMessage({ type: CANCEL, requestId }).catch(() => {});
    };

    const onWheel = (event) => event.preventDefault();
    const onContextMenu = (event) => event.preventDefault();

    wrap.addEventListener('pointerdown', onPointerDown, true);
    wrap.addEventListener('pointermove', onPointerMove, true);
    wrap.addEventListener('pointerup', onPointerUp, true);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);

    active = {
      host,
      cleanup() {
        window.removeEventListener('keydown', onKeyDown, true);
        host.remove();
      },
    };
  }

  function teardown() {
    if (!active) return;
    try {
      active.cleanup();
    } finally {
      active = null;
    }
  }

  function normalizeOpacity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0.4;
    return Math.min(1, Math.max(0, number));
  }

  function sendRegion(requestId, rect, viewport) {
    chrome.runtime
      .sendMessage({
        type: REGION,
        requestId,
        region: {
          rect: {
            x: Math.max(0, Math.round(rect.x)),
            y: Math.max(0, Math.round(rect.y)),
            w: Math.round(rect.w),
            h: Math.round(rect.h),
          },
          viewport,
          dpr: window.devicePixelRatio || 1,
        },
      })
      .catch(() => {});
  }
})();
