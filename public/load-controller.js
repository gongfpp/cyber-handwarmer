import { MODES, deviceCapabilities, cpuProfile, adaptCPU, calibratedBatch } from './adaptive-policy.js';
export { MODES };
export const monotonicNow = () => performance.timeOrigin + performance.now();
export const workerCount = (mode = 'gentle') => cpuProfile(mode, deviceCapabilities()).maxCount;
export class LoadController {
  workers = []; records = new Map(); generation = 0; configuration = null;
  heartbeat = null; governor = null; calibration = null; device = deviceCapabilities();
  adaptive = null; profile = null; peakLag = 0; lastBeat = 0;
  onFailure = () => {}; onConfig = () => {};
  fail(generation) {
    if (generation !== this.generation) return;
    this.stop(); this.onFailure('计算已停止');
  }
  loseWorker(worker, generation) {
    if (generation !== this.generation || !this.records.has(worker)) return;
    const record = this.records.get(worker);
    this.records.delete(worker); this.workers = this.workers.filter(item => item !== worker);
    record.cancel?.(); record.benchmark?.(null); worker.terminate();
    if (this.workers.length) {
      this.device.capacity = Math.min(this.device.capacity, this.workers.length);
      this.profile.maxCount = this.workers.length; this.adaptive.count = this.workers.length; this.onConfig();
    } else if (this.heartbeat) this.fail(generation);
  }
  addWorker(startOnReady = true) {
    const generation = this.generation;
    const worker = new Worker(new URL('./load-worker.js', import.meta.url));
    this.workers.push(worker);
    const record = { ready: false, stats: null, statsAt: 0, benchmark: null, cancel: null, startOnReady };
    this.records.set(worker, record);
    return new Promise(resolve => {
      const finish = result => { clearTimeout(timeout); record.cancel = null; resolve(result); };
      const timeout = setTimeout(() => this.loseWorker(worker, generation), 3000);
      record.cancel = () => finish(false);
      worker.addEventListener('message', ({ data }) => {
        if (generation !== this.generation || !this.records.has(worker)) return;
        if (data.type === 'ready') { record.ready = true; if (record.startOnReady) this.send(worker, 'start'); finish(true); }
        if (data.type === 'benchmark') record.benchmark?.(data);
        if (data.type === 'stats') { record.stats = data; record.statsAt = monotonicNow(); }
        if (data.type === 'stopped') this.loseWorker(worker, generation);
      });
      worker.addEventListener('error', event => { event.preventDefault(); this.loseWorker(worker, generation); });
    });
  }
  send(worker, type = 'update') {
    if (!this.configuration) return;
    worker.postMessage({ type, ...this.configuration, batchSize: calibratedBatch(this.calibration?.iterationsPerMs), offset: this.workers.indexOf(worker) * 4 });
  }
  resize(count) {
    while (this.workers.length > count) {
      const worker = this.workers.pop(), record = this.records.get(worker);
      this.records.delete(worker); record?.cancel?.(); record?.benchmark?.(null); worker.terminate();
    }
    const ready = [];
    try { while (this.workers.length < count) ready.push(this.addWorker(true)); } catch { this.device.capacity = Math.max(1, this.workers.length); this.profile.maxCount = this.device.capacity; this.adaptive.count = this.device.capacity; }
    return ready;
  }
  async start(mode, endAt) {
    this.stop(); const generation = this.generation;
    this.device = deviceCapabilities(); this.profile = cpuProfile(mode, this.device);
    this.adaptive = { count: this.profile.initialCount, duty: this.profile.initialDuty, healthy: 0, strained: 0 };
    this.configuration = { mode, endAt, duty: this.adaptive.duty };
    try {
      if (!this.device.cpuAvailable) throw new Error('UNAVAILABLE');
      const ready = await this.addWorker(false);
      if (generation !== this.generation) return false;
      if (!ready) { this.stop(); return false; }
      if (!this.calibration) {
        const worker = this.workers[0], record = this.records.get(worker);
        const result = await new Promise(resolve => {
          const timeout = setTimeout(() => resolve(null), 800);
          record.benchmark = result => { clearTimeout(timeout); record.benchmark = null; resolve(result); };
          worker.postMessage({ type: 'benchmark' });
        });
        if (generation !== this.generation) return false;
        this.calibration = result || { iterationsPerMs: 600, fallback: true };
      }
      if (document.hidden || monotonicNow() >= endAt) { this.stop(); return false; }
      this.lastBeat = monotonicNow();
      this.heartbeat = setInterval(() => {
        const time = monotonicNow();
        if (document.hidden || time >= this.configuration.endAt) { this.fail(generation); return; }
        this.peakLag = Math.max(this.peakLag, time - this.lastBeat - 250); this.lastBeat = time;
        for (const worker of this.workers) worker.postMessage({ type: 'heartbeat' });
      }, 250);
      this.send(this.workers[0], 'start');
      await Promise.all(this.resize(this.adaptive.count));
      if (generation !== this.generation) return false;
      this.governor = setInterval(() => this.tune(), 750);
      this.onConfig(); return true;
    } catch {
      if (generation === this.generation) this.stop();
      return false;
    }
  }
  tune() {
    if (!this.configuration || document.hidden) return;
    const recent = [...this.records.values()].filter(r => r.stats && monotonicNow() - r.statsAt < 2000);
    const overrun = recent.length ? recent.reduce((sum, r) => sum + r.stats.overrunMs, 0) / recent.length : 0;
    const next = adaptCPU(this.adaptive, this.profile, { mainLagMs: this.peakLag, workerOverrunMs: overrun });
    this.peakLag = 0; this.adaptive = next; this.configuration.duty = next.duty;
    this.resize(next.count);
    for (const [worker, record] of this.records) if (record.ready) this.send(worker);
    this.onConfig();
  }
  update(mode, endAt) {
    if (!this.configuration) return;
    const changed = mode !== this.configuration.mode;
    this.profile = cpuProfile(mode, this.device);
    if (changed) this.adaptive = { count: this.profile.initialCount, duty: this.profile.initialDuty, healthy: 0, strained: 0 };
    this.configuration = { mode, endAt, duty: this.adaptive.duty };
    this.resize(this.adaptive.count);
    for (const [worker, record] of this.records) if (record.ready) this.send(worker);
    this.onConfig();
  }
  description(mode) {
    const target = cpuProfile(mode, this.device);
    const config = this.configuration;
    return `${this.device.logical} 个逻辑处理器${this.device.reportedCores ? '' : '（默认估计）'} · 自动 ${config ? this.workers.length : target.maxCount} 线程 · 工作比例 ${Math.round((config?.duty || target.targetDuty) * 100)}%${this.calibration && !this.calibration.fallback ? ' · 已校准' : ''}`;
  }
  stop() {
    this.generation++; clearInterval(this.heartbeat); clearInterval(this.governor); this.heartbeat = null; this.governor = null;
    for (const worker of this.workers) {
      const record = this.records.get(worker); record?.cancel?.(); record?.benchmark?.(null); worker.terminate();
    }
    this.workers = []; this.records.clear(); this.configuration = null; this.peakLag = 0;
    this.onConfig();
  }
}
