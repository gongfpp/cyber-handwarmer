import { deviceCapabilities } from './adaptive-policy.js';
import { monotonicNow } from './load-controller.js';
import { createGPUEngine } from './gpu-engine.js';
const reasons = {
  'software-renderer': '浏览器使用软件渲染。',
  unsupported: '浏览器未提供可用的 WebGL2。',
  'context-lost': 'GPU 连接已中断。',
  'gpu-timeout': 'GPU 响应超时。',
};
export class GPUController {
  worker = null; engine = null; active = false; generation = 0; heartbeat = null;
  endAt = 0; device = null; lastBeat = 0; pendingCancel = null;
  revision = 0; configuration = null; startedAt = 0; stats = null; statsAt = 0; applied = null;
  onStatus = () => {}; onStats = () => {}; onTelemetry = () => {};
  async start(mode, endAt) {
    this.stop(); this.endAt = endAt;
    const generation = this.generation, hints = deviceCapabilities();
    this.startedAt = monotonicNow();
    const configuration = this.configuration = { type: 'start', mode, endAt, revision: ++this.revision, memoryGiB: hints.memoryGiB, mobile: hints.mobile };
    if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
      const result = await this.launch(configuration, generation, true);
      if (result.ok || result.cancelled || generation !== this.generation) return result;
      this.disposeBackend();
      // Software rendering is not improved by moving the same work onto the page.
      if (result.code === 'software-renderer') return result;
    }
    if (generation !== this.generation || document.hidden || monotonicNow() >= endAt) return { ok: false, cancelled: true };
    return this.launch(configuration, generation, false);
  }
  launch(configuration, generation, useWorker) {
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true; clearTimeout(timeout); this.pendingCancel = null; resolve(result);
      };
      const unavailable = code => {
        const reason = reasons[code] || 'GPU 不可用。';
        if (!settled) finish({ ok: false, reason, code });
        else { this.stop(); this.onStatus('unavailable', reason); }
      };
      const timeout = setTimeout(() => {
        finish({ ok: false, reason: 'GPU 启动超时。', code: 'startup-timeout' }); this.disposeBackend();
      }, 3000);
      this.pendingCancel = () => finish({ ok: false, cancelled: true });
      const receive = data => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') this.worker?.postMessage(configuration);
        if (data.type === 'running') {
          if (document.hidden || monotonicNow() >= this.endAt) { this.stop(); return; }
          this.active = true; this.device = data.device; this.lastBeat = monotonicNow();
          this.heartbeat = setInterval(() => {
            if (document.hidden || monotonicNow() >= this.endAt) { this.stop(); return; }
            const time = monotonicNow(), mainLagMs = Math.max(0, time - this.lastBeat - 250); this.lastBeat = time;
            this.send({ type: 'heartbeat', mainLagMs });
          }, 250);
          finish({ ok: true }); this.onStatus('running');
        }
        if (data.type === 'applied') { this.applied = data; this.onTelemetry(); }
        if (data.type === 'stats') { this.stats = data; this.statsAt = monotonicNow(); this.onStats(data); this.onTelemetry(); }
        if (data.type === 'unavailable' || data.type === 'stopped') unavailable(data.reason);
      };
      try {
        if (useWorker) {
          const worker = new Worker(new URL('./gpu-worker.js', import.meta.url), { type: 'module' });
          this.worker = worker; worker.onmessage = event => receive(event.data);
          worker.onerror = event => { event.preventDefault(); unavailable('unsupported'); };
        } else {
          this.engine = createGPUEngine({
            createCanvas: () => {
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
              canvas.className = 'gpu-surface'; canvas.setAttribute('aria-hidden', 'true');
              document.body.append(canvas); return canvas;
            },
            // Deliver after assignment so cancellation always has an engine to release.
            emit: data => queueMicrotask(() => receive(data)), mobile: !!configuration.mobile, mainThread: true,
          });
          this.engine.receive(configuration);
        }
      } catch { unavailable('unsupported'); }
    }).then(result => { if (!result.ok && generation === this.generation) this.disposeBackend(); return result; });
  }
  send(data) { this.worker?.postMessage(data); this.engine?.receive(data); }
  update(mode, endAt) {
    this.endAt = endAt; this.startedAt = monotonicNow();
    this.configuration = { ...this.configuration, mode, endAt, revision: ++this.revision };
    this.send({ type: 'update', mode, endAt, revision: this.revision }); this.onTelemetry();
  }
  snapshot() {
    if (!this.configuration) return { status: 'stopped' };
    const recent = this.stats?.revision === this.configuration.revision && monotonicNow() - this.statsAt < 2200;
    const status = this.active && recent && this.applied?.revision === this.configuration.revision ? 'running'
      : monotonicNow() - this.startedAt < 2200 ? (this.stats ? 'applying' : 'starting') : 'waiting';
    return { status, ...(recent ? this.stats : {}), backend: this.device?.backend, revision: this.configuration.revision };
  }
  disposeBackend() {
    clearInterval(this.heartbeat); this.heartbeat = null; this.active = false; this.stats = null; this.statsAt = 0; this.applied = null;
    const engine = this.engine; this.engine = null; engine?.stop();
    const worker = this.worker; this.worker = null;
    if (worker) {
      const timeout = setTimeout(() => worker.terminate(), 80);
      worker.onerror = null;
      worker.onmessage = ({ data }) => { if (data.type === 'stopped' || data.type === 'unavailable') { clearTimeout(timeout); worker.terminate(); } };
      worker.postMessage({ type: 'stop' });
    }
  }
  stop() {
    this.generation++; this.configuration = null; this.pendingCancel?.(); this.pendingCancel = null; this.disposeBackend();
  }
}
