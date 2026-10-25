// A page remains visible until the next page has real, buffered pictures.
export class BufferedRotation {
  constructor({ prepare, ready, swap, report = () => {}, now = Date.now,
    schedule = (fn, ms) => setTimeout(fn, ms), cancel = timer => clearTimeout(timer) }) {
    Object.assign(this, { prepare, ready, swap, report, now, schedule, cancel }); this.generation = 0;
  }
  start(pages, current, interval) {
    this.stop();
    if (pages.length < 2) return false;
    this.running = true; this.pages = pages; this.interval = interval;
    this.next = current < 0 ? 0 : (current + 1) % pages.length;
    this.due = this.now() + interval; this.load(this.generation); return true;
  }
  async load(generation) {
    const valid = () => this.running && generation === this.generation;
    this.report({ phase: 'warming', ready: 0, total: this.pages[this.next].length });
    try {
      const stage = await this.prepare(this.pages[this.next], valid);
      if (!valid()) return;
      this.stage = stage; this.tick(generation);
    } catch (error) {
      if (valid()) { this.report({ phase: 'error', message: error.message }); this.stop(); }
    }
  }
  tick(generation) {
    if (!this.running || generation !== this.generation) return;
    const total = this.stage.length, ready = this.stage.filter(entry => this.ready(entry)).length;
    const remaining = Math.max(0, this.due - this.now());
    this.report({ phase: ready === total ? 'ready' : remaining ? 'warming' : 'waiting', ready, total, remaining });
    if (ready === total && !remaining) {
      this.swap(this.stage); this.stage = null;
      this.next = (this.next + 1) % this.pages.length; this.due = this.now() + this.interval;
      void this.load(generation);
    } else this.timer = this.schedule(() => this.tick(generation), 250);
  }
  stop() { this.running = false; this.generation++; this.cancel(this.timer); this.timer = null; this.stage = null; }
}

export function rotationPages(pool, size) {
  return Array.from({ length: Math.ceil(pool.length / size) }, (_, index) => pool.slice(index * size, (index + 1) * size));
}
