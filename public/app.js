import { LoadController, MODES, monotonicNow } from './load-controller.js';
import { GPUController } from './gpu-controller.js';
const $ = id => document.getElementById(id);
const cpu = new LoadController();
const gpu = new GPUController();
const state = { phase: 'idle', mode: 'gentle', minutes: 1, cpu: true, gpu: false, endAt: 0, remaining: 60, token: 0, gpuError: '', skin: 'nordic' };
const running = () => state.phase === 'running';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ticker, toastTimer, lastSecond;
function feedback(message) {
  clearTimeout(toastTimer);
  $('feedback-text').textContent = message;
  $('feedback').classList.toggle('visible', !!message);
  if (message) toastTimer = setTimeout(() => $('feedback').classList.remove('visible'), 3400);
}
function drawTime(seconds) {
  const text = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const target = $('countdown');
  if (!target.querySelector('.digit')) target.replaceChildren(...Array.from(text, char => {
    const span = document.createElement('span'); span.className = char === ':' ? 'colon' : 'digit'; span.textContent = char; return span;
  }));
  else Array.from(target.children).forEach((span, index) => {
    if (span.textContent !== text[index]) {
      span.textContent = text[index]; span.classList.remove('changed');
      if (!reducedMotion.matches && !document.hidden) { void span.offsetWidth; span.classList.add('changed'); }
    }
  });
}
function render() {
  drawTime(Math.max(0, Math.ceil(state.remaining)));
  $('heater').dataset.on = String(running()); $('heater').dataset.mode = state.mode;
  $('power').setAttribute('aria-pressed', String(state.phase !== 'idle'));
  $('power').setAttribute('aria-label', state.phase === 'starting' ? '取消启动' : running() ? '停止' : '点火');
  $('power').classList.toggle('is-starting', state.phase === 'starting');
  $('state-dot').title = state.phase === 'starting' ? '启动中' : running() ? '运行中' : '已停止';
  $('modes').style.setProperty('--selected', Object.keys(MODES).indexOf(state.mode));
  $('cpu').checked = state.cpu; $('gpu').checked = state.gpu;
  $('cpu').closest('.source').classList.toggle('is-active', running() && state.cpu);
  $('gpu').closest('.source').classList.toggle('is-active', gpu.active);
  $('gpu').closest('.source').classList.toggle('has-error', !!state.gpuError);
  $('gpu').setAttribute('aria-label', state.gpuError ? `GPU：${state.gpuError}` : 'GPU');
  $('cpu-detail').textContent = cpu.description(state.mode);
  if (!gpu.active) $('gpu-detail').textContent = state.gpuError || (state.gpu ? '待启动' : '未开启');
  document.querySelectorAll('button[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
  document.querySelectorAll('button[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === state.minutes)));
  document.querySelectorAll('button[data-skin]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.skin === state.skin)));
}
function stop(message = '', completed = false) {
  state.token++; state.phase = 'idle';
  cpu.stop(); gpu.stop(); clearInterval(ticker); ticker = null;
  state.remaining = completed ? 0 : state.minutes * 60;
  render(); feedback(message);
}
function tick() {
  if (!running()) return;
  if (document.hidden) { stop('已停止'); return; }
  state.remaining = Math.max(0, (state.endAt - monotonicNow()) / 1000);
  if (state.remaining <= 0) { stop('时间到', true); return; }
  const second = Math.ceil(state.remaining);
  if (second !== lastSecond) { lastSecond = second; render(); }
}
async function start() {
  if (document.hidden) return;
  state.phase = 'starting'; state.remaining = state.minutes * 60; state.endAt = monotonicNow() + state.remaining * 1000; state.gpuError = '';
  const token = ++state.token; render(); feedback('');
  try {
    const [cpuStarted, gpuResult] = await Promise.all([
      state.cpu ? cpu.start(state.mode, state.endAt) : true,
      state.gpu ? gpu.start(state.mode, state.endAt) : { ok: false, skipped: true },
    ]);
    if (state.token !== token) return;
    if (!cpuStarted || document.hidden) { stop(); return; }
    if (state.gpu && !gpuResult.ok) {
      state.gpu = false; state.gpuError = gpuResult.reason || 'GPU 不可用'; feedback('GPU 不可用');
    }
    state.phase = 'running'; lastSecond = null; tick(); ticker = setInterval(tick, 100); render();
  } catch { if (state.token === token) stop('无法启动计算'); }
}
cpu.onConfig = () => { $('cpu-detail').textContent = cpu.description(state.mode); };
cpu.onFailure = () => {
  if (state.phase === 'idle') return;
  const completed = state.endAt <= monotonicNow();
  stop(completed ? '时间到' : '计算已停止', completed);
};
gpu.onStatus = (status, reason) => {
  if (status === 'unavailable' && state.phase === 'running') {
    state.gpu = false; state.gpuError = reason; render();
    if (running() && state.endAt > monotonicNow()) feedback('GPU 已停止');
  }
};
gpu.onStats = stats => {
  $('gpu-detail').textContent = `${stats.renderer || 'WebGL2'} · 自动 ${stats.side}×${stats.side} / ${stats.steps} 次迭代 · ${stats.gpuMs ? `GPU 计时 ${stats.gpuMs}ms` : `完成等待 ${stats.batchMs}ms`} / 批。不是整机 GPU 使用率。`;
};
$('power').addEventListener('click', () => state.phase === 'idle' ? start() : stop());
$('modes').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button || button.dataset.mode === state.mode) return;
  if (state.phase === 'starting') stop();
  state.mode = button.dataset.mode;
  if (running()) { if (state.cpu) cpu.update(state.mode, state.endAt); if (gpu.active) gpu.update(state.mode, state.endAt); }
  render();
});
$('durations').addEventListener('click', event => {
  const button = event.target.closest('button[data-minutes]');
  if (!button || Number(button.dataset.minutes) === state.minutes) return;
  if (state.phase === 'starting') stop();
  state.minutes = Number(button.dataset.minutes); state.remaining = state.minutes * 60;
  if (running()) {
    state.endAt = monotonicNow() + state.remaining * 1000;
    if (state.cpu) cpu.update(state.mode, state.endAt); if (gpu.active) gpu.update(state.mode, state.endAt);
  }
  render();
});
for (const source of ['cpu', 'gpu']) $(source).addEventListener('change', async event => {
  if (state.phase === 'starting') stop();
  state[source] = event.target.checked; state.gpuError = ''; render();
  if (!running()) return;
  const token = state.token;
  if (source === 'cpu') {
    if (!state.cpu) cpu.stop();
    else { try { await cpu.start(state.mode, state.endAt); } catch { if (state.token === token) stop('无法启动 CPU'); } }
  } else {
    if (!state.gpu) gpu.stop();
    else {
      const result = await gpu.start(state.mode, state.endAt);
      if (state.token !== token || !state.gpu || result.cancelled) return;
      if (!result.ok) { state.gpu = false; state.gpuError = result.reason || 'GPU 不可用'; feedback('GPU 不可用'); }
    }
  }
  if (state.token === token) render();
});
document.querySelector('.skins').addEventListener('click', event => {
  const button = event.target.closest('button[data-skin]');
  if (button) { state.skin = button.dataset.skin; document.body.dataset.skin = state.skin; render(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.phase !== 'idle') stop(); });
window.addEventListener('pagehide', () => stop());
document.addEventListener('freeze', () => stop());
window.addEventListener('pageshow', event => { if (event.persisted) stop(); });
const manual = $('manual');
$('open-manual').addEventListener('click', () => manual.showModal());
$('close-manual').addEventListener('click', () => manual.close());
manual.addEventListener('click', event => { if (event.target === manual) { const r = manual.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) manual.close(); } });
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let tiltFrame;
function resetTilt() { cancelAnimationFrame(tiltFrame); $('heater').classList.remove('is-tilting'); $('heater').style.removeProperty('--tilt-x'); }
$('heater').addEventListener('pointermove', event => {
  if (!finePointer.matches || reducedMotion.matches || innerWidth <= 700) return;
  const rect = $('heater').getBoundingClientRect(), x = ((event.clientX - rect.left) / rect.width - .5) * 2;
  cancelAnimationFrame(tiltFrame); tiltFrame = requestAnimationFrame(() => { $('heater').classList.add('is-tilting'); $('heater').style.setProperty('--tilt-x', `${x.toFixed(2)}deg`); });
});
$('heater').addEventListener('pointerleave', resetTilt); $('heater').addEventListener('pointercancel', resetTilt);
reducedMotion.addEventListener('change', resetTilt); document.addEventListener('visibilitychange', () => { if (document.hidden) resetTilt(); });
render();
