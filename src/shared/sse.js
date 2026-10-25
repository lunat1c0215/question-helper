/**
 * Incremental Server-Sent Events parser for OpenAI-compatible streams.
 *
 * @param {{ onMessage?: (payload: any) => void, onDone?: () => void, onWarn?: (error: Error) => void }} handlers
 */
export function createSseParser({ onMessage, onDone, onWarn } = {}) {
  let buffer = '';

  const dispatch = (rawEvent) => {
    const dataLines = [];
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;

    const payload = dataLines.join('\n').trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      onDone?.();
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      onWarn?.(new Error(`bad SSE payload: ${error.message}`));
      return;
    }
    onMessage?.(parsed);
  };

  return {
    push(chunk) {
      // Normalizing the whole buffer also repairs a CRLF pair split across chunks.
      buffer = (buffer + chunk).replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        dispatch(rawEvent);
      }
    },
    flush() {
      if (!buffer.trim()) return;
      const rawEvent = buffer;
      buffer = '';
      dispatch(rawEvent);
    },
  };
}
