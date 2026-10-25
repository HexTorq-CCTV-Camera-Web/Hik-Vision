import './vendor/jmuxer.mjs';
import { decodeBase64 } from './bytes.mjs';

export const supportsSmooth = () => Boolean(globalThis.VideoDecoder ||
  globalThis.JMuxer && globalThis.MediaSource?.isTypeSupported('video/mp4; codecs="avc1.42C028"'));

// MSE provides compressed H.264 playback where WebCodecs is unavailable.
// The canvas remains the capture, zoom and recording surface for both decoders.
export class MseSmoothPlayer {
  constructor(canvas, paint, error) {
    this.canvas = canvas; this.paint = paint; this.error = error; this.generation = 0;
  }
  start() {
    const generation = ++this.generation;
    const video = this.video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    this.canvas.parentElement.append(video);
    const fail = () => { if (this.generation === generation) { this.reset(); this.error(); } };
    this.ready = false; this.pending = []; this.firstFrame = false;
    this.muxer = new globalThis.JMuxer({ node: video, mode: 'video', fps: 25,
      flushingTime: 100, maxDelay: 2000, clearBuffer: true, debug: false,
      onError: fail, onUnsupportedCodec: fail, onLoggerErr() {},
      onReady: () => { if (this.generation !== generation) return; this.ready = true; for (const data of this.pending.splice(0)) this.muxer.feed(data); } });
    const draw = () => {
      if (this.generation !== generation) return;
      if (video.readyState >= 2 && video.videoWidth) {
        if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
          this.canvas.width = video.videoWidth; this.canvas.height = video.videoHeight;
        }
        this.canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0);
        this.firstFrame = true; this.paint();
      }
      if (video.requestVideoFrameCallback) this.frameCallback = video.requestVideoFrameCallback(draw);
      else this.animation = requestAnimationFrame(draw);
    };
    if (video.requestVideoFrameCallback) this.frameCallback = video.requestVideoFrameCallback(draw);
    else this.animation = requestAnimationFrame(draw);
    this.timer = setInterval(() => {
      if (this.generation !== generation || !video.buffered.length) return;
      if (!this.firstFrame && video.readyState >= 2 && video.videoWidth) {
        this.canvas.width = video.videoWidth; this.canvas.height = video.videoHeight;
        this.canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0);
        this.firstFrame = true; this.paint();
      }
      const end = video.buffered.end(video.buffered.length - 1), ahead = end - video.currentTime;
      if (ahead > 2.5) video.currentTime = Math.max(0, end - 0.9);
      if (video.paused && ahead >= 0.9) void video.play().catch(fail);
      else if (!video.paused && ahead < 0.08) video.pause();
    }, 100);
  }
  push(packet) {
    try {
      if (!this.muxer) { if (!packet.key) return; this.start(); }
      const duration = this.previous === undefined ? 40 : Math.max(10, Math.min(200, (packet.timestamp - this.previous) / 1000));
      this.previous = packet.timestamp;
      const data = { video: decodeBase64(packet.h264), duration, isLastVideoFrameComplete: true };
      if (this.ready) this.muxer.feed(data);
      else { this.pending.push(data); if (this.pending.length > 64) throw new Error('Decoder startup timeout'); }
    } catch { this.reset(); this.error(); }
  }
  reset() {
    this.generation++; clearInterval(this.timer); cancelAnimationFrame(this.animation);
    if (this.video) {
      if (this.frameCallback !== undefined) this.video.cancelVideoFrameCallback?.(this.frameCallback);
      this.video.pause();
    }
    this.muxer?.destroy(); this.video?.remove();
    this.pending = []; this.ready = false;
    this.video = this.muxer = this.previous = this.timer = this.frameCallback = undefined;
  }
}
