export const cameraKey = camera => `${camera.deviceId}:${camera.channel}`;
export function retryableStreamError(error) {
  if(error.code==='authorization-updated')return true;
  if (['provider-auth-required', 'playback-auth-required', 'viewer-auth-required', 'account-changed', 'channel-unavailable', 'stream-limit', 'encrypted-stream', 'receiver-unavailable', 'provider-access-denied'].includes(error.code)) return false;
  if (['recorder-offline', 'server-unreachable', 'server-timeout', 'server-error', 'server-response-error', 'browser-offline', 'provider-unavailable', 'provider-timeout', 'provider-response-error', 'decode-failed', 'stream-timeout', 'stream-interrupted', 'sdk-start-failed', 'playback-rejected'].includes(error.code)) return true;
  if ([401, 403].includes(error.status)) return false;
  if (/could not decode|no decoded video|video stopped arriving|camera connection ended/i.test(error.message)) return true;
  return !/authorization|account|limit|shared with|encryption|not supported/i.test(error.message);
}
export function recorderGrid(channels) {
  const count = Math.min(16, Math.max(0, Number.isInteger(channels) ? channels : 0));
  return { count, grid: [1, 4, 9, 16].find(size => size >= count) };
}
export function pictureSize(width, height, viewportWidth, viewportHeight, fit) {
  const scale = fit === 'original' ? 1 : (fit === 'fill' ? Math.max : Math.min)(viewportWidth / width, viewportHeight / height);
  return { width: width * scale, height: height * scale };
}
export class Zoom {
  constructor() { this.reset(); }
  reset() { this.scale = 1; this.x = 0; this.y = 0; }
  clamp(width, height, viewportWidth, viewportHeight) {
    const x = Math.max(0, (width * this.scale - viewportWidth) / 2), y = Math.max(0, (height * this.scale - viewportHeight) / 2);
    this.x = Math.max(-x, Math.min(x, this.x)); this.y = Math.max(-y, Math.min(y, this.y));
  }
  zoom(value, x = 0, y = 0) {
    const next = Math.max(1, Math.min(8, value)), ratio = next / this.scale;
    this.x = x - (x - this.x) * ratio; this.y = y - (y - this.y) * ratio; this.scale = next;
    if (next === 1) this.x = this.y = 0;
  }
}
export class Retry {
  constructor({ schedule = (callback, delay) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer) } = {}) { this.schedule = schedule; this.cancel = cancel; this.attempt = 0; this.generation = 0; }
  stop() { this.generation++; this.cancel(this.timer); this.timer = null; }
  reset() { this.stop(); this.attempt = 0; }
  queue(callback) {
    if (this.timer) return;
    const generation = this.generation, delay = Math.min(30000, 2000 * 2 ** Math.min(this.attempt++, 4));
    this.timer = this.schedule(() => { if (generation !== this.generation) return; this.timer = null; callback(); }, delay);
    return delay;
  }
}
