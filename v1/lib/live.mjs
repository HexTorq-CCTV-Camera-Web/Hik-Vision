import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class LiveError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

export class NativeLive extends EventEmitter {
  constructor(credentials, device, channel, quality, { runner = spawn } = {}) {
    super();
    this.deviceId = device.id; this.deviceName = device.name; this.channel = channel; this.quality = quality;
    this.state = 'connecting'; this.clients = new Set(); this.lastFrame = null; this.lastFrameAt = 0;
    this.audioClients = new Set(); this.audioState = 'unknown'; this.lastAudioAt = 0; this.audioSamples = 0;
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.ready.catch(() => {});
    const child = this.child = runner(process.env.HIK_PYTHON || 'python', [fileURLToPath(new URL('../native/probe.py', import.meta.url))],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 8_000_000) return this.fail('The video receiver exceeded its output limit.');
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.stage === 'audio-stream') {
          this.audioState = event.available ? 'waiting' : 'unavailable';
        } else if (event.stage === 'audio-error') {
          this.audioState = 'error';
        } else if (event.stage === 'audio') {
          if (['stopped', 'failed'].includes(this.state)) continue;
          if (event.sampleRate !== 16000 || !Number.isInteger(event.samples) || event.samples < 1 || event.samples > 8000 || typeof event.pcm !== 'string' || event.pcm.length > 24000) continue;
          const pcm = Buffer.from(event.pcm, 'base64');
          if (pcm.length !== event.samples * 2) continue;
          this.audioState = 'available'; this.lastAudioAt = Date.now(); this.audioSamples += event.samples;
          const message = `data: ${JSON.stringify({ pcm: event.pcm, sampleRate: 16000, samples: event.samples })}\n\n`;
          for (const res of this.audioClients) {
            // Disconnect slow listeners instead of playing a growing backlog.
            if (res.destroyed) { this.audioClients.delete(res); continue; }
            if (res.writableLength > 64000) { res.end(); this.audioClients.delete(res); continue; }
            res.write(message);
          }
        } else if (event.stage === 'frame') {
          if (['stopped', 'failed'].includes(this.state)) continue;
          if (typeof event.jpeg !== 'string' || event.jpeg.length > 6_000_000) continue;
          const jpeg = Buffer.from(event.jpeg, 'base64');
          if (jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216) continue;
          if (!Number.isInteger(event.width) || !Number.isInteger(event.height)) continue;
          this.lastFrame = jpeg; this.lastFrameAt = Date.now(); this.width = event.width; this.height = event.height;
          this.displayWidth = Number.isFinite(event.displayWidth) ? event.displayWidth : event.width;
          this.codec = event.codec === 'hevc' ? 'H265' : event.codec === 'h264' ? 'H264' : 'Video'; this.state = 'playing';
          this.resolve(this.status());
          for (const res of this.clients) this.sendFrame(res);
        } else if (event.stage === 'playback-event' && event.event === 0) this.fail('The camera rejected playback. Check the official app and try again.');
        else if (event.stage === 'camera-capabilities' && event.encrypted) this.fail('This camera requires its video encryption code. Encrypted playback is not configured yet.');
        else if (['probe-failed', 'decode-timeout', 'media-overflow', 'decoder-ended'].includes(event.stage)) this.fail('The video receiver could not decode this stream. Try SD or reconnect the account.');
        else if (['initialize', 'set-session', 'start-video', 'device-details'].includes(event.stage) && event.result !== 0) this.fail('The SDK could not start this camera. Reconnect your account and retry.');
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => this.fail('The video receiver could not start. Check Python, PyAV, Pillow, and the installed iVMS SDK.'));
    child.on('close', () => { if (!['stopped', 'failed'].includes(this.state)) this.fail('The camera connection ended. Start the channel again.'); });
    child.stdin.write(JSON.stringify({ accessToken: credentials.sdkAccessToken || credentials.sessionId, serial: device.serial, channel,
      streamType: quality === 'hd' ? 1 : 2, play: true, decode: true, stream: true }) + '\n');
    this.deadline = setTimeout(() => this.fail('No decoded video arrived. Try SD or check the camera in the official app.'), 40000);
    this.ready.then(() => { clearTimeout(this.deadline); if (this.state !== 'playing') return; this.idle = setTimeout(() => { if (!this.clients.size) this.stop(); }, 15000); }, () => {});
    this.watchdog = setInterval(() => { if (this.state === 'playing' && Date.now() - this.lastFrameAt > 12000) this.fail('Live video stopped arriving. Start the channel again.'); }, 3000);
    this.watchdog.unref();
  }
  status() {
    return { state: this.state, deviceId: this.deviceId, deviceName: this.deviceName, channel: this.channel, quality: this.quality,
      width: this.width || null, height: this.height || null, displayWidth: this.displayWidth || null, codec: this.codec || null,
      lastFrameAt: this.lastFrameAt || null, audio: this.audioState === 'available', audioState: this.audioState,
      lastAudioAt: this.lastAudioAt || null, audioSamples: this.audioSamples, delivery: 'mjpeg', error: this.error || null };
  }
  sendFrame(res) {
    if (!this.lastFrame || res.destroyed || res.writableLength > 2_000_000) return;
    const header = Buffer.from(`--hikframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${this.lastFrame.length}\r\n\r\n`);
    res.write(Buffer.concat([header, this.lastFrame, Buffer.from('\r\n')]));
  }
  subscribe(res) {
    if (this.state !== 'playing') throw new LiveError(this.error || 'Start a camera first.', 409);
    clearTimeout(this.idle);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=hikframe', 'Cache-Control': 'no-store, private', 'X-Accel-Buffering': 'no' });
    this.clients.add(res); this.sendFrame(res);
    res.on('close', () => {
      this.clients.delete(res);
      if (!this.clients.size && this.state === 'playing') this.idle = setTimeout(() => this.stop(), 3000);
    });
  }
  subscribeAudio(res) {
    if (this.state !== 'playing') throw new LiveError(this.error || 'Start a camera first.', 409);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, private', 'X-Accel-Buffering': 'no' });
    res.write(': audio connected\n\n');
    this.audioClients.add(res);
    res.on('close', () => this.audioClients.delete(res));
  }
  fail(message) {
    if (['failed', 'stopped'].includes(this.state)) return;
    this.error = message; this.state = 'failed'; this.reject(new LiveError(message)); this.cleanup();
  }
  stop() {
    if (this.state === 'stopped') return;
    this.state = 'stopped'; this.reject(new LiveError('Playback was stopped.', 409)); this.cleanup();
  }
  cleanup() {
    clearTimeout(this.deadline); clearTimeout(this.idle); clearInterval(this.watchdog);
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill(), 5000); kill.unref();
    this.child.once('close', () => clearTimeout(kill));
    for (const res of this.clients) res.end();
    for (const res of this.audioClients) res.end();
    this.audioClients.clear(); this.audioState = 'unavailable';
    this.clients.clear(); this.lastFrame = null;
  }
}
