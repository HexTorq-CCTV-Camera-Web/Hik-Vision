import { CameraAudio } from './audio.mjs';

export function filename(name, extension) { return `camera-${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70)}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`; }
export function frameCanvas(image, width, height) {
  if (!(image instanceof HTMLCanvasElement) && (!image.complete || !image.naturalWidth)) throw new Error('Wait for a camera picture first.');
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width || image.naturalWidth || image.width); canvas.height = Math.round(height || image.naturalHeight || image.height);
  if (canvas.width < 1 || canvas.height < 1 || canvas.width > 8192 || canvas.height > 8192) throw new Error('This picture size is not supported for capture.');
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
}
export async function snapshot(image, width, height, name) {
  const canvas = frameCanvas(image, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('The snapshot could not be created.');
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename(name, 'jpg'); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export class ClipRecorder {
  constructor({ onComplete, onError, onBytes = () => {} }) { this.onComplete = onComplete; this.onError = onError; this.onBytes = onBytes; this.bytes = 0; }
  async start(image, width, height, name, withAudio) {
    if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Clip recording is unavailable in this browser.');
    this.canvas = frameCanvas(image, width, height); this.image = image; this.name = name; this.started = Date.now(); this.active = true;
    this.stream = this.canvas.captureStream(30);
    try {
      if (withAudio) {
        this.audio = new CameraAudio(); await this.audio.start({ external: true, monitor: false, record: true, bufferDelay: image instanceof HTMLCanvasElement ? 0.9 : 0.2 });
        if (!this.active) { this.audio.stop(); return; }
        for (const track of this.audio.recordDestination.stream.getAudioTracks()) this.stream.addTrack(track);
      }
      const candidates = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('No supported clip recording format was found.');
      const recorder = this.recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 2500000 });
      this.parts = [];
      recorder.ondataavailable = event => { if (event.data.size) { this.parts.push(event.data); this.bytes += event.data.size; this.onBytes(); if (this.bytes >= 128 * 1024 * 1024) this.stop(); } };
      recorder.onerror = () => { this.onError('Recording was interrupted. Any received clip data will be offered for download.'); this.stop(); };
      recorder.onstop = () => {
        this.active = false; this.cleanup();
        if (this.parts.length) this.onComplete(new Blob(this.parts, { type: mimeType }), { name: filename(this.name, mimeType.includes('mp4') ? 'mp4' : 'webm'), duration: Date.now() - this.started, audio: withAudio });
        this.parts = [];
      };
      recorder.start(1000);
      this.draw(); this.limit = setTimeout(() => this.stop(), 15 * 60000);
    } catch (error) { this.active = false; this.cleanup(); throw error; }
  }
  stop() { this.active = false; if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); else this.cleanup(); }
  draw() { if (this.active && (this.image instanceof HTMLCanvasElement || this.image.complete && this.image.naturalWidth)) this.canvas.getContext('2d').drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height); }
  cleanup() { clearTimeout(this.limit); cancelAnimationFrame(this.animation); this.audio?.stop(); for (const track of this.stream?.getTracks() || []) track.stop(); }
}
