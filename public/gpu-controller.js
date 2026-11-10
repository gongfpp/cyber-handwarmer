import { deviceCapabilities } from './adaptive-policy.js';
import { monotonicNow } from './load-controller.js';
const reasons = {
  'software-renderer': '浏览器使用软件渲染，无法调用硬件 GPU。',
  'unsupported': '当前浏览器未提供可用的 WebGL2 GPU。',
  'context-lost': 'GPU 连接已中断。',
  'gpu-timeout': 'GPU 响应超时，已停止 GPU 负载。',
};
export class GPUController {
  worker = null;
  active = false;
  generation = 0;
  heartbeat = null;
  endAt = 0;
  device = null; lastBeat = 0;
  pendingCancel = null;
  onStatus = () => {};
  onStats = () => {};
  async start(mode, endAt) {
    this.stop();
    this.endAt = endAt;
    const generation = this.generation;
    if (!('Worker' in window)) return { ok: false, reason: reasons.unsupported };
    try {
      const worker = new Worker(new URL('./gpu-worker.js', import.meta.url)); this.worker = worker;
      return await new Promise(resolve => {
        let settled = false;
        const finish = result => {
          if (settled) return; settled = true; clearTimeout(timeout); this.pendingCancel = null; resolve(result);
        };
        const timeout = setTimeout(() => { finish({ ok: false, reason: 'GPU 未能及时启动。' }); if (generation === this.generation) this.stop(); }, 4500);
        this.pendingCancel = () => finish({ ok: false, cancelled: true });
        worker.onmessage = ({ data }) => {
          if (generation !== this.generation) return;
          if (data.type === 'ready') worker.postMessage({ type: 'start', mode, endAt, memoryGiB: deviceCapabilities().memoryGiB });
          if (data.type === 'running') {
            if (document.hidden || monotonicNow() >= this.endAt) { this.stop(); return; }
            this.active = true; this.device = data.device || null; this.lastBeat = monotonicNow();
            this.heartbeat = setInterval(() => {
              if (document.hidden || monotonicNow() >= this.endAt) { this.stop(); return; }
              const time = monotonicNow(), mainLagMs = Math.max(0, time - this.lastBeat - 250); this.lastBeat = time;
              worker.postMessage({ type: 'heartbeat', mainLagMs });
            }, 250);
            finish({ ok: true }); this.onStatus('running');
          }
          if (data.type === 'stats') this.onStats(data);
          if (data.type === 'unavailable' || data.type === 'stopped') {
            const reason = reasons[data.reason] || 'GPU 负载已停止。';
            finish({ ok: false, reason }); this.stop(); this.onStatus('unavailable', reason);
          }
        };
        worker.onerror = () => {
          if (generation !== this.generation) return;
          const reason = 'GPU 线程无法运行，CPU 暖手仍可使用。';
          finish({ ok: false, reason }); this.stop(); this.onStatus('unavailable', reason);
        };
      });
    } catch { this.stop(); return { ok: false, reason: reasons.unsupported }; }
  }
  update(mode, endAt) {
    this.endAt = endAt;
    this.worker?.postMessage({ type: 'update', mode, endAt });
  }
  stop() {
    this.generation++; this.active = false;
    clearInterval(this.heartbeat); this.heartbeat = null;
    this.pendingCancel?.(); this.pendingCancel = null;
    const worker = this.worker; this.worker = null;
    if (worker) {
      // Let the Worker explicitly release its GL context; terminate even if it cannot respond.
      const timeout = setTimeout(() => worker.terminate(), 80);
      worker.onmessage = ({ data }) => { if (data.type === 'stopped' || data.type === 'unavailable') { clearTimeout(timeout); worker.terminate(); } };
      worker.postMessage({ type: 'stop' });
    }
  }
}
