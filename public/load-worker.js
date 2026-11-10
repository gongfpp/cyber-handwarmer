/* No network, no persistent storage. This Worker performs bounded arithmetic. */
let duty = 0, endAt = 0, lastHeartbeat = 0, task = null, active = false;
let accumulator = 0.123;
const now = () => performance.timeOrigin + performance.now();
const clampDuty = value => Math.max(0, Math.min(0.55, Number(value) || 0));
function shutDown(reason) {
  active = false;
  clearTimeout(task);
  postMessage({ type: 'stopped', reason });
  close();
}
function canRun() {
  if (!active) return false;
  if (now() >= endAt) { shutDown('deadline'); return false; }
  if (performance.now() - lastHeartbeat > 1400) { shutDown('heartbeat'); return false; }
  return true;
}
function cycle() {
  if (!canRun()) return;
  const cycleStart = performance.now();
  let remaining = 100 * duty;
  function slice() {
    if (!canRun()) return;
    const begin = performance.now();
    const budget = Math.min(8, remaining);
    // Yield after at most 8 ms to service deadline, heartbeat and control messages.
    while (performance.now() - begin < budget) {
      for (let i = 0; i < 200; i++) accumulator = Math.sin(accumulator + i) * Math.cos(i + accumulator) + 0.5;
    }
    remaining -= performance.now() - begin;
    if (remaining > 0.2) task = setTimeout(slice, 0);
    else task = setTimeout(cycle, Math.max(0, 100 - (performance.now() - cycleStart)));
  }
  slice();
}
onmessage = ({ data }) => {
  if (data.type === 'heartbeat') { lastHeartbeat = performance.now(); return; }
  if (data.type === 'start' || data.type === 'update') {
    duty = clampDuty(data.duty);
    endAt = Math.min(Number(data.endAt) || now(), now() + 5 * 60 * 1000);
    lastHeartbeat = performance.now();
    if (!active && data.type === 'start') { active = true; task = setTimeout(cycle, data.offset || 0); }
  }
};
postMessage({ type: 'ready' });
