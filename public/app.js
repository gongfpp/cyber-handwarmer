import { LoadController, MODES, workerCount, monotonicNow } from './load-controller.js';
const $ = id => document.getElementById(id);
const load = new LoadController();
const state = { phase: 'idle', mode: 'gentle', minutes: 1, demo: false, endAt: 0, remaining: 60, token: 0 };
let ticker = null, lastAnnounced = null;
const running = () => state.phase === 'running';
function feedback(message) { $('feedback-text').textContent = message; }
function render() {
  const mode = MODES[state.mode];
  const seconds = Math.max(0, Math.ceil(state.remaining));
  $('countdown').replaceChildren(document.createTextNode(String(Math.floor(seconds / 60)).padStart(2, '0')), Object.assign(document.createElement('span'), { textContent: ':' }), document.createTextNode(String(seconds % 60).padStart(2, '0')));
  $('heater').dataset.on = String(running());
  $('heater').dataset.mode = state.mode;
  $('heater').classList.toggle('is-starting', state.phase === 'starting');
  $('device-state').textContent = running() ? (state.demo ? '炉火演示' : '暖手中') : state.phase === 'starting' ? '启动中' : state.remaining === 0 ? '已结束' : '待机中';
  $('display-label').textContent = running() ? 'A LITTLE TIME FOR YOURSELF' : state.remaining === 0 ? 'TIME FOR A LITTLE REST' : 'READY WHEN YOU ARE';
  $('display-mode').textContent = mode.name;
  $('display-kind').textContent = state.demo ? '仅看炉火' : running() ? '计算运行' : '计算待机';
  $('power-label').textContent = state.phase === 'starting' ? '取消启动' : running() ? '关闭暖炉' : state.demo ? '点亮炉火' : '开启暖手';
  $('power').setAttribute('aria-label', $('power-label').textContent);
  $('power').setAttribute('aria-pressed', String(running() || state.phase === 'starting'));
  $('stop').disabled = state.phase === 'idle';
  $('progress').style.transform = `scaleX(${state.remaining / (state.minutes * 60)})`;
  $('load-title').textContent = state.demo ? `${mode.name} · 炉火演示` : `${mode.name} · ${mode.label}`;
  $('load-description').textContent = state.demo ? '只播放视觉动效，不启动计算线程' : `${running() ? '运行中' : '启动后'}，${workerCount()} 个计算线程 / ${Math.round(mode.duty * 100)}% 工作占空比`;
  $('session-heading').textContent = running() ? '留一点时间，暖暖自己' : '一点温暖，刚刚好';
  $('session-copy').textContent = running() ? `${state.demo ? '炉火演示' : '设备暖手'}进行中，离开页面自动停止。` : `已选 ${state.minutes} 分钟，到点自动关机。`;
  document.querySelectorAll('[data-mode]').forEach(button => { if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)); });
  document.querySelectorAll('[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === state.minutes)));
}
function stop(message, completed = false) {
  state.token++;
  state.phase = 'idle';
  load.stop();
  clearInterval(ticker); ticker = null;
  state.remaining = completed ? 0 : state.minutes * 60;
  render();
  if (message) feedback(message);
}
function tick() {
  if (!running()) return;
  if (document.hidden) { stop('你离开了一会儿，小暖已自动停止。回来后需要手动开启。'); return; }
  state.remaining = Math.max(0, (state.endAt - monotonicNow()) / 1000);
  if (state.remaining <= 0) { stop('时间到，暖炉已关闭。伸伸手，休息一下吧。', true); return; }
  const seconds = Math.ceil(state.remaining);
  if (seconds !== lastAnnounced) { lastAnnounced = seconds; render(); }
}
async function start() {
  if (document.hidden) return;
  state.phase = 'starting';
  state.remaining = state.minutes * 60;
  state.endAt = monotonicNow() + state.remaining * 1000;
  const token = ++state.token;
  render();
  feedback(state.demo ? '正在点亮炉火…' : '正在启动计算线程…');
  try {
    const started = state.demo || await load.start(MODES[state.mode].duty, state.endAt);
    if (state.token !== token) return;
    if (!started || document.hidden) { stop('启动已取消。按下电源可以重新开启。'); return; }
    state.phase = 'running';
    feedback(state.demo ? `炉火已点亮，只看光，不产生计算负载。${state.minutes} 分钟后自动熄灭。` : `${MODES[state.mode].name}档已开启，将增加耗电。${state.minutes} 分钟后自动停止。`);
    lastAnnounced = null;
    tick();
    ticker = setInterval(tick, 100);
    render();
  } catch {
    if (state.token === token) stop('计算线程无法启动。请通过 HTTP(S) 打开，或切换「仅看炉火」体验。');
  }
}
load.onFailure = message => {
  if (running() || state.phase === 'starting') {
    const ended = state.endAt <= monotonicNow();
    stop(ended ? '时间到，暖炉已关闭。伸伸手，休息一下吧。' : message, ended);
  }
};
$('power').addEventListener('click', () => state.phase === 'idle' ? start() : stop('暖炉已关闭。想暖一会儿时，再按电源。'));
$('stop').addEventListener('click', () => stop('已停止运行，计算线程已释放。'));
$('modes').addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button || state.mode === button.dataset.mode) return;
  if (state.phase === 'starting') stop();
  state.mode = button.dataset.mode;
  if (running() && !state.demo) load.update(MODES[state.mode].duty, state.endAt);
  render(); feedback(`已切换为${MODES[state.mode].name}档${running() ? '，剩余时间保持不变。' : '，按下电源开始。'}`);
});
$('durations').addEventListener('click', event => {
  const button = event.target.closest('button[data-minutes]');
  if (!button || Number(button.dataset.minutes) === state.minutes) return;
  if (state.phase === 'starting') stop();
  state.minutes = Number(button.dataset.minutes);
  state.remaining = state.minutes * 60;
  if (running()) { state.endAt = monotonicNow() + state.remaining * 1000; if (!state.demo) load.update(MODES[state.mode].duty, state.endAt); }
  render(); feedback(running() ? `已从 ${state.minutes} 分钟重新计时，到点自动关闭。` : `定时已设为 ${state.minutes} 分钟。`);
});
$('demo').addEventListener('change', event => {
  stop(); state.demo = event.target.checked; render();
  feedback(state.demo ? '已选仅看炉火。按下电源点亮，不产生计算负载。' : '已选设备暖手。按下电源后将启动计算并增加耗电。');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.phase !== 'idle') stop('你离开了一会儿，小暖已自动停止。回来后需要手动开启。'); });
window.addEventListener('pagehide', () => stop());
document.addEventListener('freeze', () => stop());
window.addEventListener('pageshow', event => { if (event.persisted) stop('欢迎回来，暖炉保持关闭。按下电源重新开启。'); });
const manual = $('manual');
$('open-manual').addEventListener('click', () => manual.showModal());
$('close-manual').addEventListener('click', () => manual.close());
$('manual-done').addEventListener('click', () => manual.close());
manual.addEventListener('click', event => { if (event.target === manual) { const r = manual.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) manual.close(); } });
render();
