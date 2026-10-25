/** Message names shared by the service worker and content scripts. */
export const MSG = Object.freeze({
  SHOW_SELECTOR: 'QH_SHOW_SELECTOR',
  REGION: 'QH_REGION',
  CANCEL: 'QH_CANCEL',
  STREAM_START: 'QH_STREAM_START',
  STREAM_DELTA: 'QH_STREAM_DELTA',
  STREAM_DONE: 'QH_STREAM_DONE',
  STREAM_ERROR: 'QH_STREAM_ERROR',
  STREAM_STATUS: 'QH_STREAM_STATUS',
  TOGGLE_EXPLANATION: 'QH_TOGGLE_EXPLANATION',
  TOGGLE_VISIBLE: 'QH_TOGGLE_VISIBLE',
  COPY: 'QH_COPY',
  SAVE_DISPLAY: 'QH_SAVE_DISPLAY',
});

export const ERR = Object.freeze({
  NO_KEY: 'NO_KEY',
  HTTP: 'HTTP',
  NETWORK: 'NETWORK',
  RESTRICTED_PAGE: 'RESTRICTED_PAGE',
  TOO_LARGE: 'TOO_LARGE',
  BAD_RESPONSE: 'BAD_RESPONSE',
  ABORTED: 'ABORTED',
});

export class QhError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [detail]
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'QhError';
    this.code = code;
    this.detail = detail;
  }
}
