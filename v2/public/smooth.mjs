// H.264 decoding with a bounded presentation queue; never accumulate old frames.
import { decodeBase64 } from './bytes.mjs';
export class SmoothPlayer {
  constructor(canvas, paint, error) {
    this.canvas = canvas; this.paint = paint; this.error = error; this.frames = []; this.needsKey = true; this.generation = 0;
  }
  push(packet) {
    try {
      if (!globalThis.VideoDecoder) throw new Error('H264 decoding is unavailable in this browser.');
      if (this.decoder?.decodeQueueSize > 32) this.reset();
      if (this.needsKey && !packet.key) return;
      if (!this.decoder) {
        const generation = this.generation;
        this.decoder = new VideoDecoder({
          output: frame => {
            if (generation !== this.generation) { frame.close(); return; }
            this.frames.push(frame);
            while (this.frames.length > 50) this.frames.shift().close();
            const now = performance.now();
            if (this.anchor === undefined) this.anchor = now + 900 - frame.timestamp / 1000;
            if (!this.animation) this.animation = requestAnimationFrame(now => this.draw(now));
          }, error: () => { if (generation === this.generation) { this.reset(); this.error(); } }
        });
        this.decoder.configure({ codec: packet.codec, codedWidth: packet.width, codedHeight: packet.height, optimizeForLatency: true });
      }
      this.needsKey = false;
      const bytes = decodeBase64(packet.h264);
      this.decoder.decode(new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: packet.timestamp, data: bytes }));
    } catch { this.reset(); this.error(); }
  }
  draw(now) {
    this.animation = null;
    if (!this.frames.length) return;
    let due = this.anchor + this.frames[0].timestamp / 1000;
    // Rebase a discontinuity, not normal network jitter. The queue must hold
    // the complete playout buffer (six frames cannot buffer a 25fps second).
    if (due - now > 1800 || now - due > 1200) {
      this.anchor = now + 900 - this.frames[0].timestamp / 1000;
      due = now + 900;
    }
    if (now < due - 1) {
      this.animation = requestAnimationFrame(time => this.draw(time)); return;
    }
    let frame = this.frames.shift();
    while (this.frames.length && this.anchor + this.frames[0].timestamp / 1000 <= now) {
      frame.close(); frame = this.frames.shift();
    }
    if (frame) {
      try {
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth; this.canvas.height = frame.displayHeight;
        }
        this.canvas.getContext('2d', { alpha: false }).drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        this.lastDraw = now;
        this.paint();
      } finally { frame.close(); }
    }
    if (this.frames.length) this.animation = requestAnimationFrame(time => this.draw(time));
  }
  reset() {
    this.generation++; cancelAnimationFrame(this.animation); this.animation = null;
    for (const frame of this.frames) frame.close(); this.frames = [];
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); this.decoder = null;
    this.needsKey = true; this.lastDraw = this.anchor = undefined;
  }
}
