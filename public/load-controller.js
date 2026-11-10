export const MODES = Object.freeze({
  gentle: { name: '轻柔', duty: 0.12, label: '轻量计算' },
  cozy: { name: '温暖', duty: 0.30, label: '适中计算' },
  toasty: { name: '热烈', duty: 0.55, label: '较高计算' },
});
export const monotonicNow = () => performance.timeOrigin + performance.now();
export const workerCount = () => Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 2));

// Each run owns its Workers. Terminating the pool is synchronous and idempotent.
export class LoadController {
  workers = [];
  heartbeat = null;
  generation = 0;
  onFailure = () => {};

  async start(duty, endAt) {
    this.stop();
    const generation = this.generation;
    try {
      if (!('Worker' in window)) throw new Error('WORKER_UNAVAILABLE');
      const ready = [];
      for (let i = 0; i < workerCount(); i++) {
        const worker = new Worker(new URL('./load-worker.js', import.meta.url));
        this.workers.push(worker);
        ready.push(new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('WORKER_TIMEOUT')), 3000);
          worker.addEventListener('message', event => {
            if (event.data.type === 'ready') { clearTimeout(timeout); resolve(); }
            if (event.data.type === 'stopped' && generation === this.generation) {
              this.stop(); this.onFailure('计算已自动停止，请重新开启。');
            }
          });
          worker.addEventListener('error', () => {
            clearTimeout(timeout);
            if (generation === this.generation) {
              this.stop(); this.onFailure('计算线程未能运行。可以切换「仅看炉火」继续体验。');
            }
            reject(new Error('WORKER_ERROR'));
          });
        }));
      }
      await Promise.all(ready);
      if (generation !== this.generation) return false;
      if (document.hidden || monotonicNow() >= endAt) { this.stop(); return false; }
      this.workers.forEach((worker, index) => worker.postMessage({ type: 'start', duty, endAt, offset: index * 35 }));
      this.heartbeat = setInterval(() => {
        if (document.hidden || monotonicNow() >= endAt) { this.stop(); this.onFailure('本次暖手已结束。'); return; }
        for (const worker of this.workers) worker.postMessage({ type: 'heartbeat' });
      }, 250);
      return true;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  update(duty, endAt) {
    for (const worker of this.workers) worker.postMessage({ type: 'update', duty, endAt });
    // Recreate the deadline-aware heartbeat without replacing the pool.
    clearInterval(this.heartbeat);
    if (this.workers.length) this.heartbeat = setInterval(() => {
      if (document.hidden || monotonicNow() >= endAt) { this.stop(); this.onFailure('本次暖手已结束。'); return; }
      for (const worker of this.workers) worker.postMessage({ type: 'heartbeat' });
    }, 250);
  }

  stop() {
    this.generation++;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
