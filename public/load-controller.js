export const MODES = Object.freeze({
  gentle: { name: '轻柔', duty: 0.30, threads: 2, label: '轻量计算' },
  cozy: { name: '温暖', duty: 0.65, threads: 4, label: '多核计算' },
  toasty: { name: '热烈', duty: 0.92, threads: 8, label: '高强度计算' },
});
export const monotonicNow = () => performance.timeOrigin + performance.now();
export const workerCount = (mode = 'gentle') => Math.max(1, Math.min(MODES[mode].threads, (navigator.hardwareConcurrency || 4) - 2));

// A new pool owns each run. Mode changes resize it and retain the same deadline.
export class LoadController {
  workers = [];
  heartbeat = null;
  generation = 0;
  configuration = null;
  pending = new Set();
  onFailure = () => {};

  async start(mode, endAt) {
    this.stop();
    const generation = this.generation;
    this.configuration = { duty: MODES[mode].duty, count: workerCount(mode), endAt };
    try {
      if (!('Worker' in window)) throw new Error('WORKER_UNAVAILABLE');
      const ready = [];
      for (let i = 0; i < this.configuration.count; i++) {
        const worker = new Worker(new URL('./load-worker.js', import.meta.url));
        this.workers.push(worker);
        ready.push(new Promise((resolve, reject) => {
          const cancel = () => { clearTimeout(timeout); this.pending.delete(cancel); reject(new Error('CANCELLED')); };
          const timeout = setTimeout(() => { this.pending.delete(cancel); reject(new Error('WORKER_TIMEOUT')); }, 3000);
          this.pending.add(cancel);
          worker.addEventListener('message', event => {
            if (event.data.type === 'ready') { clearTimeout(timeout); this.pending.delete(cancel); resolve(); }
            if (event.data.type === 'stopped' && generation === this.generation) {
              this.stop(); this.onFailure('计算已自动停止，请重新开启。');
            }
          });
          worker.addEventListener('error', () => {
            clearTimeout(timeout); this.pending.delete(cancel);
            if (generation === this.generation) {
              this.stop(); this.onFailure('计算线程未能运行。可以切换「仅看炉火」继续体验。');
            }
            reject(new Error('WORKER_ERROR'));
          });
        }));
      }
      await Promise.all(ready);
      if (generation !== this.generation) return false;
      if (document.hidden || monotonicNow() >= this.configuration.endAt) { this.stop(); return false; }
      this.workers.forEach((worker, index) => worker.postMessage({ type: 'start', ...this.configuration, offset: index * 12 }));
      this.heartbeat = setInterval(() => {
        if (document.hidden || monotonicNow() >= this.configuration.endAt) { this.stop(); this.onFailure('本次暖手已结束。'); return; }
        for (const worker of this.workers) worker.postMessage({ type: 'heartbeat' });
      }, 250);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop(); throw error;
    }
  }

  update(mode, endAt) {
    const count = workerCount(mode);
    if (count !== this.workers.length) {
      void this.start(mode, endAt).catch(() => this.onFailure('计算线程未能运行，请重新开启。'));
      return;
    }
    this.configuration = { duty: MODES[mode].duty, count, endAt };
    for (const worker of this.workers) worker.postMessage({ type: 'update', ...this.configuration });
  }

  stop() {
    this.generation++;
    clearInterval(this.heartbeat); this.heartbeat = null;
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    for (const cancel of [...this.pending]) cancel();
    this.configuration = null;
  }
}
