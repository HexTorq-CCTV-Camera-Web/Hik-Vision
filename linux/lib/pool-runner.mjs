import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const pools = new Map();
let sequence = 0;
class Pool {
  constructor(key, command) {
    this.key = key; this.children = new Map();
    this.child = spawn(command, [fileURLToPath(new URL('../native/pool.py', import.meta.url))],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume(); this.child.stdin.on('error', () => {});
    let pending = '';
    this.child.stdout.on('data', data => {
      pending += data.toString();
      if (pending.length > 8_000_000) return this.child.kill();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        const child = this.children.get(event.streamId); if (!child) continue;
        if (event.stage === 'pool-ended') child.finish(event.exitCode);
        else { delete event.streamId; child.stdout.write(JSON.stringify(event) + '\n'); }
      }
    });
    const ended = () => { for (const child of [...this.children.values()]) child.finish(1); if (pools.get(key) === this) pools.delete(key); };
    this.child.on('error', ended); this.child.on('close', ended);
  }
  send(message) { if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
}
export function spawnPooled(command) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let pool, identifier, pending = '', done = false;
  child.finish = code => {
    if (done) return; done = true;
    pool?.children.delete(identifier); child.stdout.end(); child.stderr.end(); child.emit('close', code);
    if (pool && !pool.children.size) {
      pool.idle = setTimeout(() => { if (!pool.children.size) pool.child.stdin.end(); }, 30000);
      pool.idle.unref();
    }
  };
  child.stdin = new Writable({
    write(data, encoding, complete) {
      pending += data.toString(); const lines = pending.split('\n'); pending = lines.pop();
      try {
        for (const line of lines.filter(Boolean)) {
          const message = JSON.parse(line);
          if (!pool) {
            const key = createHash('sha256').update(message.accessToken).digest('hex');
            pool = pools.get(key);
            if (!pool || pool.child.stdin.writableEnded) { pool = new Pool(key, command); pools.set(key, pool); }
            clearTimeout(pool.idle); do { sequence = (sequence + 1) % 1000000; } while (pool.children.has(sequence)); identifier = sequence; pool.children.set(identifier, child);
            pool.send({ action: 'start', streamId: identifier, config: message });
          } else pool.send({ action: 'command', streamId: identifier, command: message });
        }
        complete();
      } catch (error) { complete(error); queueMicrotask(() => child.finish(1)); }
    },
    final(complete) { pool?.send({ action: 'stop', streamId: identifier }); if (!pool) queueMicrotask(() => child.finish(0)); complete(); }
  });
  child.kill = () => {
    pool?.send({ action: 'stop', streamId: identifier }); child.finish(1);
    // A stuck receiver is retired as a group rather than leaving stale sessions.
    if (pool && !pool.children.size) pool.child.stdin.end();
    return true;
  };
  return child;
}

export function closeReceiverPools() {
  for (const pool of pools.values()) {
    clearTimeout(pool.idle); pool.child.stdin.end();
    const force = setTimeout(() => pool.child.kill(), 5000); force.unref();
    pool.child.once('close', () => clearTimeout(force));
  }
}
