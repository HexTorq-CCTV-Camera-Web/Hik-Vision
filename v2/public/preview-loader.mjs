// Fetch snapshots independently of tile playback, once per camera every five minutes.
export class PreviewLoader {
  constructor({ load, apply, state = () => {}, enabled = () => true, now = Date.now }) {
    Object.assign(this, { load, apply, state, enabled, now }); this.cameras = []; this.next = new Map(); this.generation = 0;
  }
  sync(cameras) { this.cameras = cameras; void this.pump(); }
  clear() { this.generation++; this.cameras = []; this.next.clear(); }
  async pump() {
    if (this.busy || !this.enabled()) return;
    const camera = this.cameras.find(camera => camera.device.status === 'online' && (this.next.get(camera.key) || 0) <= this.now());
    if (!camera) return;
    const generation = this.generation; this.busy = true; this.next.set(camera.key, this.now() + 300000); this.state(camera.key, 'loading');
    try {
      const value = await this.load(camera);
      if (generation === this.generation) { this.apply(camera.key, value); this.next.set(camera.key, Math.max(this.now() + 1000, value.capturedAt + 300000)); this.state(camera.key, 'ready'); }
    } catch { if (generation === this.generation) this.state(camera.key, 'unavailable'); }
    finally { this.busy = false; setTimeout(() => void this.pump(), 250); }
  }
}
