// PCM audio is played only after an explicit user click. Every stop/channel
// change closes the connection and cancels queued sound immediately.
import { decodeBase64 } from './bytes.mjs';
export class CameraAudio {
  constructor({ onChange = () => {}, onError = () => {}, Context = globalThis.AudioContext || globalThis.webkitAudioContext,
    Source = globalThis.EventSource } = {}) {
    this.Context = Context; this.Source = Source; this.onChange = onChange; this.onError = onError;
    this.enabled = false; this.generation = 0; this.nodes = new Set(); this.packets = 0;
  }
  async start({ url = '/api/live/audio', external = false, monitor = true, record = false, bufferDelay = 0.2 } = {}) {
    this.stop();
    if (!this.Context || (!external && !this.Source)) throw new Error('Audio playback is unavailable in this browser.');
    const generation = this.generation;
    const context = this.context = new this.Context();
    try { await context.resume(); }
    catch { if (generation !== this.generation) return; this.stop(); throw new Error('Allow sound in this browser, then click Unmute again.'); }
    if (generation !== this.generation) return;
    if (context.state !== 'running') { this.stop(); throw new Error('Click Unmute to allow browser sound.'); }
    this.gain = context.createGain?.();
    if (this.gain) { this.gain.gain.value = this.volume ?? 1; if (monitor) this.gain.connect(context.destination); }
    this.monitor = monitor;
    if (record) {
      this.recordDestination = context.createMediaStreamDestination();
      this.gain.connect(this.recordDestination);
    }
    this.enabled = true; this.nextTime = 0; this.bufferDelay = Number.isFinite(bufferDelay) ? Math.max(0.12, Math.min(1.5, bufferDelay)) : 0.2; this.underruns = 0; this.onChange(true);
    if (external) return;
    const source = this.source = new this.Source(url);
    this.waiting = setTimeout(() => { this.stop(); this.onError('No audio arrived from this channel. Try another channel or retry Unmute.'); }, 10000);
    source.onmessage = event => {
      if (generation !== this.generation || !this.enabled) return;
      try {
        this.play(JSON.parse(event.data));
      } catch {
        this.stop(); this.onError('Audio playback was interrupted. Click Unmute to retry.');
      }
    };
    source.onerror = () => {
      if (generation !== this.generation) return;
      this.stop(); this.onError('The audio connection ended. Click Unmute to reconnect.');
    };
  }
  play(packet) {
    if (!this.enabled || !this.context) return;
    if (packet.sampleRate !== 16000 || !Number.isInteger(packet.samples) || packet.samples < 1 || packet.samples > 8000 || typeof packet.pcm !== 'string' || packet.pcm.length > 24000) return;
    const bytes = decodeBase64(packet.pcm);
    if (bytes.byteLength !== packet.samples * 2) return;
    const context = this.context;
    if (context.state !== 'running') throw new Error('Audio context suspended');
    clearTimeout(this.waiting);
    const samples = new DataView(bytes.buffer);
    const buffer = context.createBuffer(1, packet.samples, 16000);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < packet.samples; i++) output[i] = samples.getInt16(i * 2, true) / 32768;
    // Bound latency after a network burst/background tab. Never accumulate a
    // long queue of old audio or replay it after mute/unmute.
    if (this.nextTime > context.currentTime + 3 || this.nodes.size > 60) {
      for (const node of this.nodes) { try { node.stop(); node.disconnect(); } catch {} }
      this.nodes.clear(); this.nextTime = 0;
    }
    // Consecutive buffers must be contiguous. Moving every packet to now +
    // a safety margin inserts tiny audible gaps on ordinary arrival jitter.
    if (!this.nextTime) this.nextTime = context.currentTime + this.bufferDelay;
    else if (this.nextTime < context.currentTime + 0.015) {
      this.underruns++; this.bufferDelay = Math.min(1.5, this.bufferDelay + 0.1);
      this.nextTime = context.currentTime + this.bufferDelay;
    }
    const node = context.createBufferSource(); node.buffer = buffer; node.connect(this.gain || context.destination);
    this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect(); };
    node.start(this.nextTime); this.nextTime += buffer.duration; this.packets++;
  }
  stop() {
    this.generation++; this.enabled = false; clearTimeout(this.waiting);
    this.source?.close(); this.source = null;
    for (const node of this.nodes) { try { node.stop(); node.disconnect(); } catch {} }
    this.nodes.clear(); this.nextTime = 0;
    this.context?.close().catch(() => {}); this.context = null;
    this.gain = null; this.recordDestination = null;
    this.onChange(false);
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); if (this.gain) this.gain.gain.value = this.volume; }
}
