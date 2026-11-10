import { LoadController, MODES, monotonicNow } from './load-controller.js';
import { deviceCapabilities } from './adaptive-policy.js';
import { GPUController } from './gpu-controller.js';
import { FireSound } from './fire-sound.js';
import { Shutdown } from './shutdown.js';
const $ = id => document.getElementById(id);
const cpu = new LoadController();
const gpu = new GPUController();
const sound = new FireSound();
const shutdown = new Shutdown($('heater'));
const available = { cpu: deviceCapabilities().cpuAvailable, gpu: true };
const sourceRequests = { cpu: 0, gpu: 0 };
const state = { phase: 'idle', mode: 'gentle', minutes: 1, cpu: available.cpu, gpu: false, endAt: 0, remaining: 60, token: 0, gpuError: '', cpuError: available.cpu ? '' : '浏览器未提供计算线程。', skin: 'nordic' };
const running = () => state.phase === 'running';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ticker, lastSecond, lastTelemetry = 0;
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
const statusNames = { stopped: '已停止', starting: '启动中', applying: '应用中', running: '运行中', waiting: '等待数据', disabled: '已关闭', unavailable: '不可用' };
function setText(id, value) { const node = $(id); if (node.textContent !== value) node.textContent = value; }
function renderTelemetry() {
  const snapshots = { cpu: cpu.snapshot(), gpu: gpu.snapshot() };
  for (const source of ['cpu', 'gpu']) {
    const snapshot = snapshots[source];
    const status = !available[source] ? 'unavailable' : !state[source] ? 'disabled' : (state.phase === 'idle' || state.phase === 'ending') ? 'stopped'
      : snapshot.status === 'stopped' ? 'starting' : snapshot.status;
    const row = $(`${source}-readout`);
    if (source === 'cpu') row.dataset.cores = String(cpu.device.logical);
    else { row.dataset.backend = snapshot.backend || ''; row.dataset.measurement = snapshot.measurement || ''; }
    setText(`${source}-target`, `目标 ${Math.round((source === 'cpu' ? MODES[state.mode].duty : MODES[state.mode].gpuDuty) * 100)}%`);
    row.dataset.status = status; row.dataset.mode = snapshot.mode || ''; row.dataset.revision = String(snapshot.revision || 0);
    setText(`${source}-status`, statusNames[status]);
    const live = status === 'running' || status === 'applying';
    $(source).closest('.source').classList.toggle('is-active', live && (source === 'cpu' ? snapshot.count > 0 : !!snapshot.batchesPerSecond));
    let value = '—', detail = '';
    if (source === 'cpu' && live && snapshot.count) {
      value = `${snapshot.count} 线程`;
      detail = `${new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(snapshot.iterationsPerSecond)}次/秒`;
    }
    if (source === 'gpu' && live && snapshot.batchesPerSecond > 0) {
      value = `${snapshot.batchesPerSecond.toFixed(1)} 批/秒`;
      detail = snapshot.gpuMs > 0 ? `GPU ${snapshot.gpuMs.toFixed(2)} ms/批` : snapshot.backend === 'page-webgl2' ? '兼容计算' : '后台计算';
    }
    setText(`${source}-value`, value); setText(`${source}-metric`, detail);
  }
}
function render() {
  drawTime(Math.max(0, Math.ceil(state.remaining)));
  $('heater').dataset.on = String(running()); $('heater').dataset.mode = state.mode;
  $('power').setAttribute('aria-pressed', String(state.phase === 'starting' || running()));
  $('power').setAttribute('aria-label', state.phase === 'starting' ? '取消启动' : running() ? '停止' : '点火');
  $('power').classList.toggle('is-starting', state.phase === 'starting');
  $('state-dot').title = state.phase === 'starting' ? '启动中' : running() ? '运行中' : '已停止';
  $('modes').style.setProperty('--selected', Object.keys(MODES).indexOf(state.mode));
  $('cpu').checked = state.cpu; $('gpu').checked = state.gpu;
  for (const source of ['cpu', 'gpu']) {
    $(source).disabled = !available[source];
    $(source).closest('.source').classList.toggle('is-unavailable', !available[source]);
  }
  renderTelemetry();
  $('gpu').closest('.source').classList.toggle('has-error', !!state.gpuError);
  $('gpu').setAttribute('aria-label', state.gpuError ? `GPU：${state.gpuError}` : 'GPU');
  document.querySelectorAll('button[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
  document.querySelectorAll('button[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === state.minutes)));
  document.querySelectorAll('button[data-skin]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.skin === state.skin)));
}
function stop(message = '', completed = false, immediate = false) {
  const animate = running() && !immediate && !document.hidden && !reducedMotion.matches;
  const token = ++state.token; sourceRequests.cpu++; sourceRequests.gpu++;
  shutdown.cancel(); state.phase = animate ? 'ending' : 'idle';
  cpu.stop(); gpu.stop(); clearInterval(ticker); ticker = null;
  state.remaining = completed ? 0 : state.minutes * 60;
  render();
  if (animate) {
    sound.extinguish();
    shutdown.play().then(finished => {
      if (finished && token === state.token && state.phase === 'ending') { state.phase = 'idle'; render(); }
    });
  } else sound.stop(immediate || document.hidden);
}
function tick() {
  if (!running()) return;
  if (document.hidden) { stop('', false, true); return; }
  if (monotonicNow() - lastTelemetry > 400) { lastTelemetry = monotonicNow(); renderTelemetry(); }
  state.remaining = Math.max(0, (state.endAt - monotonicNow()) / 1000);
  if (state.remaining <= 0) { stop('', true); return; }
  const second = Math.ceil(state.remaining);
  if (second !== lastSecond) { lastSecond = second; render(); }
}
function disableSource(source, reason) {
  state[source] = false; available[source] = false;
  state[`${source}Error`] = reason || `${source.toUpperCase()} 不可用`;
  if (source === 'cpu') cpu.stop(); else gpu.stop();
}
async function fallbackCPU(token) {
  if (!available.cpu || state.cpu || document.hidden || monotonicNow() >= state.endAt) return;
  const request = ++sourceRequests.cpu; state.cpu = true; render();
  const ok = await cpu.start(state.mode, state.endAt);
  if (token !== state.token || request !== sourceRequests.cpu) return;
  if (!ok) disableSource('cpu', '浏览器无法运行计算线程。');
  render();
}
async function start() {
  if (document.hidden) return;
  shutdown.cancel(); sound.stop(true, false); sound.arm();
  state.phase = 'starting'; state.remaining = state.minutes * 60; state.endAt = monotonicNow() + state.remaining * 1000;
  const token = ++state.token; render();
  const [cpuStarted, gpuResult] = await Promise.all([
    state.cpu ? cpu.start(state.mode, state.endAt) : true,
    state.gpu ? gpu.start(state.mode, state.endAt) : { ok: false, skipped: true },
  ]);
  if (state.token !== token) return;
  if (document.hidden || monotonicNow() >= state.endAt) { stop(); return; }
  if (!cpuStarted) disableSource('cpu', '浏览器无法运行计算线程。');
  if (state.gpu && !gpuResult.ok) {
    disableSource('gpu', gpuResult.reason);
    await fallbackCPU(token);
  }
  if (state.token !== token) return;
  state.phase = 'running'; sound.start(state.mode, state.skin); lastSecond = null; tick(); ticker = setInterval(tick, 100); render();
}
cpu.onConfig = renderTelemetry;
cpu.onTelemetry = renderTelemetry; gpu.onTelemetry = renderTelemetry;
cpu.onFailure = () => {
  if (state.phase === 'idle') return;
  if (document.hidden || state.endAt <= monotonicNow()) { stop('', state.endAt <= monotonicNow()); return; }
  disableSource('cpu', '计算线程已中断。'); render();
};
gpu.onStatus = (status, reason) => {
  if (status === 'unavailable' && state.phase === 'running') {
    if (document.hidden || state.endAt <= monotonicNow()) { stop('', state.endAt <= monotonicNow()); return; }
    disableSource('gpu', reason); render(); fallbackCPU(state.token);
  }
};
$('power').addEventListener('click', () => state.phase === 'idle' || state.phase === 'ending' ? start() : stop());
$('modes').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button || button.dataset.mode === state.mode) return;
  if (state.phase === 'starting') stop();
  state.mode = button.dataset.mode; sound.update(state.mode, state.skin);
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
  const checked = event.target.checked;
  if (state.phase === 'starting') stop();
  state[source] = checked; render();
  if (!running()) return;
  const token = state.token, request = ++sourceRequests[source];
  if (!checked) { if (source === 'cpu') cpu.stop(); else gpu.stop(); render(); return; }
  if (source === 'cpu') {
    const ok = await cpu.start(state.mode, state.endAt);
    if (state.token !== token || request !== sourceRequests[source]) return;
    if (!ok) disableSource('cpu', '浏览器无法运行计算线程。');
  } else {
    const result = await gpu.start(state.mode, state.endAt);
    if (state.token !== token || request !== sourceRequests[source] || result.cancelled) return;
    if (!result.ok) { disableSource('gpu', result.reason); await fallbackCPU(token); }
  }
  if (state.token === token) render();
});
document.querySelector('.skins').addEventListener('click', event => {
  const button = event.target.closest('button[data-skin]');
  if (button) { if (state.phase === 'ending') stop('', false, true); state.skin = button.dataset.skin; document.body.dataset.skin = state.skin; sound.update(state.mode, state.skin); render(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state.phase !== 'idle') stop('', false, true); else sound.stop(true); } });
window.addEventListener('pagehide', () => stop('', false, true));
document.addEventListener('freeze', () => stop('', false, true));
window.addEventListener('pageshow', event => { if (event.persisted) stop('', false, true); });
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let tiltFrame;
function resetTilt() { cancelAnimationFrame(tiltFrame); $('heater').classList.remove('is-tilting'); $('heater').style.removeProperty('--tilt-x'); }
$('heater').addEventListener('pointermove', event => {
  if (!finePointer.matches || reducedMotion.matches || innerWidth <= 700) return;
  const rect = $('heater').getBoundingClientRect(), x = ((event.clientX - rect.left) / rect.width - .5) * 2;
  cancelAnimationFrame(tiltFrame); tiltFrame = requestAnimationFrame(() => { $('heater').classList.add('is-tilting'); $('heater').style.setProperty('--tilt-x', `${x.toFixed(2)}deg`); });
});
$('heater').addEventListener('pointerleave', resetTilt); $('heater').addEventListener('pointercancel', resetTilt);
reducedMotion.addEventListener('change', () => { resetTilt(); if (reducedMotion.matches && state.phase === 'ending') stop('', false, true); }); document.addEventListener('visibilitychange', () => { if (document.hidden) resetTilt(); });
render();
