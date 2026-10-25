// PCM audio is played only after an explicit user click. Every stop/channel
// change closes the connection and cancels queued sound immediately.
export class CameraAudio {
  constructor({ onChange = () => {}, onError = () => {}, Context = globalThis.AudioContext || globalThis.webkitAudioContext,
    Source = globalThis.EventSource } = {}) {
    this.Context = Context; this.Source = Source; this.onChange = onChange; this.onError = onError;
    this.enabled = false; this.generation = 0; this.nodes = new Set(); this.packets = 0;
  }
  async start() {
    this.stop();
    if (!this.Context || !this.Source) throw new Error('Audio playback is unavailable in this browser.');
    const generation = this.generation;
    const context = this.context = new this.Context();
    try { await context.resume(); }
    catch { if (generation !== this.generation) return; this.stop(); throw new Error('Allow sound in this browser, then click Unmute again.'); }
    if (generation !== this.generation) return;
    if (context.state !== 'running') { this.stop(); throw new Error('Click Unmute to allow browser sound.'); }
    this.enabled = true; this.nextTime = 0; this.onChange(true);
    const source = this.source = new this.Source('/api/live/audio');
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
    const bytes = Uint8Array.from(atob(packet.pcm), c => c.charCodeAt(0));
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
    if (this.nextTime > context.currentTime + 0.6 || this.nodes.size > 10) {
      for (const node of this.nodes) { try { node.stop(); } catch {} }
      this.nodes.clear(); this.nextTime = 0;
    }
    this.nextTime = Math.max(this.nextTime, context.currentTime + 0.12);
    const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination);
    this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect(); };
    node.start(this.nextTime); this.nextTime += buffer.duration; this.packets++;
  }
  stop() {
    this.generation++; this.enabled = false; clearTimeout(this.waiting);
    this.source?.close(); this.source = null;
    for (const node of this.nodes) { try { node.stop(); node.disconnect(); } catch {} }
    this.nodes.clear(); this.nextTime = 0;
    this.context?.close().catch(() => {}); this.context = null;
    this.onChange(false);
  }
}
