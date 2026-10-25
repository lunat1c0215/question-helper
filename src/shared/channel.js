const ANSWER_MARKERS = Object.freeze(['【答案】', '[答案]', '答案：', '答案:']);
const EXPLANATION_MARKERS = Object.freeze([
  '【解析】',
  '[解析]',
  '解析：',
  '解析:',
  '【详解】',
  '[详解]',
]);

/**
 * @param {string} text
 * @param {readonly string[]} markers
 * @returns {{ index: number, length: number } | null}
 */
function findFirst(text, markers) {
  let best = null;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index !== -1 && (best === null || index < best.index)) {
      best = { index, length: marker.length };
    }
  }
  return best;
}

/**
 * Keeps the shortest suffix that could still become one of the markers.
 *
 * @param {string} text
 * @param {readonly string[]} markers
 */
function safeTail(text, markers) {
  const maxLength = Math.max(...markers.map((marker) => marker.length)) - 1;
  const limit = Math.min(text.length, maxLength);
  for (let size = limit; size > 0; size -= 1) {
    const tail = text.slice(-size);
    if (markers.some((marker) => marker.length > size && marker.startsWith(tail))) {
      return tail;
    }
  }
  return '';
}

/**
 * Splits a streamed model response into answer and explanation channels.
 * Text before the first answer marker is treated as preamble and dropped.
 */
export function createChannelSplitter() {
  let mode = 'before';
  let buffer = '';
  let answerStarted = false;
  let explanationStarted = false;

  /**
   * The model writes the marker on its own line, so the first chunk of each
   * channel usually starts with a newline. Drop leading whitespace once.
   *
   * @param {'answer' | 'explanation'} channel
   * @param {string} text
   */
  const polish = (channel, text) => {
    if (channel === 'answer') {
      if (answerStarted) return text;
      const trimmed = text.replace(/^\s+/, '');
      if (trimmed) answerStarted = true;
      return trimmed;
    }
    if (explanationStarted) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed) explanationStarted = true;
    return trimmed;
  };

  return {
    /**
     * @param {string} chunk
     * @returns {{ channel: 'answer' | 'explanation', text: string }[]}
     */
    push(chunk) {
      buffer += chunk;
      const out = [];

      for (;;) {
        if (mode === 'before') {
          const hit = findFirst(buffer, ANSWER_MARKERS);
          if (!hit) break;
          buffer = buffer.slice(hit.index + hit.length);
          mode = 'answer';
          continue;
        }

        if (mode === 'answer') {
          const hit = findFirst(buffer, EXPLANATION_MARKERS);
          if (!hit) {
            const tail = safeTail(buffer, EXPLANATION_MARKERS);
            const emit = buffer.slice(0, buffer.length - tail.length);
            if (emit) out.push({ channel: 'answer', text: polish('answer', emit) });
            buffer = tail;
            break;
          }
          const emit = buffer.slice(0, hit.index);
          if (emit) out.push({ channel: 'answer', text: polish('answer', emit) });
          buffer = buffer.slice(hit.index + hit.length);
          mode = 'explanation';
          continue;
        }

        if (buffer) out.push({ channel: 'explanation', text: polish('explanation', buffer) });
        buffer = '';
        break;
      }

      return out;
    },

    /**
     * Emits whatever is left. Without markers the whole text becomes the answer.
     * @returns {{ channel: 'answer' | 'explanation', text: string }[]}
     */
    end() {
      const out = [];
      if (buffer) {
        const channel = mode === 'explanation' ? 'explanation' : 'answer';
        out.push({ channel, text: polish(channel, buffer) });
        buffer = '';
      }
      return out;
    },
  };
}
