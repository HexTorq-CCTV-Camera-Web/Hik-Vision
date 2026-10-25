export function adaptiveQuality(tile, context) {
  if (tile.qualityMode === 'hd' || tile.qualityMode === 'sd') return tile.qualityMode;
  return context.focusedId === tile.id || context.grid === 1 ? 'hd' : 'sd';
}

export function playbackPolicy(tile, context, index) {
  const intent = Boolean(tile.camera && (tile.wanted || tile.adaptivePaused || tile.recorder?.active));
  if (!intent) return { run: false, intent: false, reason: 'stopped' };
  if (!context.enabled) return { run: false, intent: true, reason: 'authorization' };
  // A quality restart would finish a recording; keep its current stream intact.
  if (tile.recorder?.active) return { run: true, intent: true, quality: tile.quality, reason: 'recording' };
  if (context.hidden || !context.live) {
    if (context.audioWanted && context.selectedId === tile.id) return { run: true, intent: true, quality: 'sd', reason: 'background-audio' };
    return { run: false, intent: true, reason: context.hidden ? 'hidden-tab' : 'other-page' };
  }
  if (context.focusedId !== null && context.focusedId !== undefined && context.focusedId !== tile.id) return { run: false, intent: true, reason: 'hidden-camera' };
  if (index >= context.grid && !context.warmIds?.has(tile.id)) return { run: false, intent: true, reason: 'outside-grid' };
  return { run: true, intent: true, quality: adaptiveQuality(tile, context), reason: index >= context.grid ? 'rotation-preload' : 'visible' };
}

// Target changes cancel stale work without waiting for slow camera startup.
// The adapter serializes only stop requests; independent cameras start in pairs.
export class AdaptiveStreams {
  constructor({ tiles, context, suspend, resume, report = () => {}, error = () => {} }) {
    Object.assign(this, { tiles, context, suspend, resume, report, error }); this.pending = new Map();
  }
  cancel() { this.pending.clear(); }
  reconcile() {
    const tiles = this.tiles(), context = this.context(), jobs = [], stops = [];
    const ordered = [...tiles].sort((a, b) => Number(b.id === context.focusedId) - Number(a.id === context.focusedId));
    for (const tile of ordered) {
      const plan = playbackPolicy(tile, context, tiles.indexOf(tile));
      if (!plan.intent) { this.pending.delete(tile.id); continue; }
      if (!plan.run) {
        this.pending.delete(tile.id);
        if (tile.wanted) { try { stops.push(Promise.resolve(this.suspend(tile, plan.reason)).catch(this.error)); } catch (error) { this.error(error); } }
        continue;
      }
      if (tile.wanted && !tile.adaptivePaused && tile.quality === plan.quality) continue;
      const key = tile.camera.key, signature = `${key}:${plan.quality}`;
      if (this.pending.get(tile.id)?.signature === signature) continue;
      const entry = { signature }; this.pending.set(tile.id, entry);
      if (tile.wanted) { try { stops.push(Promise.resolve(this.suspend(tile, 'quality-change')).catch(this.error)); } catch (error) { this.error(error); } }
      const valid = () => {
        if (this.pending.get(tile.id) !== entry || tile.camera?.key !== key) return false;
        const current = playbackPolicy(tile, this.context(), this.tiles().indexOf(tile));
        return current.run && current.quality === plan.quality;
      };
      jobs.push(async () => {
        try { if (valid()) await this.resume(tile, plan.quality, valid); }
        catch (error) { if (valid()) this.error(error); }
        finally { if (this.pending.get(tile.id) === entry) this.pending.delete(tile.id); }
      });
    }
    this.report(context);
    const queue = [...jobs];
    const workers = [0, 1].map(async () => { while (queue.length) await queue.shift()(); });
    return Promise.all([...stops, ...workers]);
  }
}
