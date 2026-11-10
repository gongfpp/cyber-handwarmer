/* Bounded CPU work, locally calibrated against the same arithmetic kernel. */
let duty = 0, endAt = 0, lastHeartbeat = 0, task = null, active = false;
let accumulator = .123, batchSize = 200, windowStart = performance.now(), busyMs = 0, iterations = 0, worstOverrun = 0;
const channel = new MessageChannel();
let queuedSlice = null;
channel.port1.onmessage = () => { const next = queuedSlice; queuedSlice = null; next?.(); };
const now = () => performance.timeOrigin + performance.now();
function defer(next) { queuedSlice = next; channel.port2.postMessage(0); }
function kernel(count) {
  for (let i = 0; i < count; i++) accumulator = Math.sin(accumulator + i) * Math.cos(i + accumulator) + .5;
}
function shutDown(reason) {
  active = false; clearTimeout(task); queuedSlice = null; channel.port1.close(); channel.port2.close();
  postMessage({ type: 'stopped', reason }); close();
}
function canRun() {
  if (!active) return false;
  if (now() >= endAt) { shutDown('deadline'); return false; }
  if (performance.now() - lastHeartbeat > 1400) { shutDown('heartbeat'); return false; }
  return true;
}
function benchmark() {
  let rounds = 0, measuredMs = 0, measuredIterations = 0;
  function sample() {
    const begin = performance.now(); let count = 0;
    while (performance.now() - begin < 6) { kernel(200); count += 200; }
    const elapsed = performance.now() - begin;
    // Warm the JIT first, then measure 12 short slices, yielding between every slice.
    if (rounds >= 2) { measuredMs += elapsed; measuredIterations += count; }
    rounds++;
    if (rounds < 14) defer(sample);
    else postMessage({ type: 'benchmark', iterationsPerMs: measuredIterations / measuredMs, measuredMs, checksum: accumulator });
  }
  sample();
}
function cycle() {
  if (!canRun()) return;
  const cycleStart = performance.now(); let remaining = 100 * duty;
  function slice() {
    if (!canRun()) return;
    const begin = performance.now(), budget = Math.min(6, remaining);
    let count = 0;
    while (performance.now() - begin < budget) { kernel(batchSize); count += batchSize; }
    const elapsed = performance.now() - begin;
    remaining -= elapsed; busyMs += elapsed; iterations += count;
    if (remaining > .2) defer(slice);
    else {
      const duration = performance.now() - cycleStart;
      worstOverrun = Math.max(worstOverrun, duration - 100);
      if (performance.now() - windowStart >= 700) {
        postMessage({ type: 'stats', busyMs, wallMs: performance.now() - windowStart, iterations, overrunMs: Math.max(0, worstOverrun) });
        windowStart = performance.now(); busyMs = 0; iterations = 0; worstOverrun = 0;
      }
      task = setTimeout(cycle, Math.max(0, 100 - duration));
    }
  }
  slice();
}
onmessage = ({ data }) => {
  if (data.type === 'benchmark' && !active) { benchmark(); return; }
  if (data.type === 'heartbeat') { lastHeartbeat = performance.now(); return; }
  if (data.type === 'start' || data.type === 'update') {
    duty = Math.max(0, Math.min(.85, Number(data.duty) || 0));
    batchSize = Math.max(128, Math.min(8192, Number(data.batchSize) || 200));
    endAt = Math.min(Number(data.endAt) || now(), now() + 300000); lastHeartbeat = performance.now();
    if (!active && data.type === 'start') { queuedSlice = null; active = true; windowStart = performance.now(); task = setTimeout(cycle, data.offset || 0); }
  }
};
postMessage({ type: 'ready' });
