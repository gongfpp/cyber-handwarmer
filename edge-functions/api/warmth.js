import { getStore } from '@edgeone/pages-blob';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const runPattern = /^runs\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/(\d+)$/;
const publicHosts = new Set(['warm.gongfpp.icu', 'cyber-handwarmer-a0z0axp0.edgeone.dev']);
const cache = new Map();
export function aggregateRuns(blobs) {
  const visitors = new Set(), runs = new Map();
  for (const { key } of blobs) {
    const match = runPattern.exec(key); if (!match || !idPattern.test(match[1]) || !idPattern.test(match[2])) continue;
    const milliseconds = Number(match[3]); if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 86400000) continue;
    visitors.add(match[1]); const run = `${match[1]}/${match[2]}`;
    runs.set(run, Math.max(runs.get(run) || 0, milliseconds));
  }
  return { visitors: visitors.size, sessions: runs.size, litMs: [...runs.values()].reduce((sum,value) => sum + value, 0) };
}
const json = (data,status=200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
export async function handleStats(request, factory = getStore) {
  const url = new URL(request.url), scope = publicHosts.has(url.hostname) ? 'public' : 'preview';
  const name = scope === 'public' ? 'little-warmth-live-v1' : 'little-warmth-preview-v1';
  if (!['GET','POST'].includes(request.method)) return json({ error:'method' },405);
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return json({ error:'origin' },403);
  try {
    const store = factory({ name, consistency:'strong' });
    if (request.method === 'POST') {
      const text = await request.text(); if (text.length > 1024) return json({ error:'size' },413);
      let payload; try { payload = JSON.parse(text); } catch { return json({ error:'json' },400); }
      const { visitorId, runId, litMs } = payload || {};
      if (!idPattern.test(visitorId || '') || !idPattern.test(runId || '') || !Number.isSafeInteger(litMs) || litMs < 0 || litMs > 86400000) return json({ error:'data' },400);
      // Immutable checkpoints: retries and out-of-order requests cannot double-count or roll back a run.
      await store.set(`runs/${visitorId}/${runId}/${litMs}`, ''); cache.delete(name);
    }
    let entry = cache.get(name);
    if (!entry || Date.now() - entry.time > 30000) {
      const { blobs } = await store.list({ prefix:'runs/', consistency:'strong' });
      entry = { time:Date.now(), data:aggregateRuns(blobs) }; cache.set(name,entry);
    }
    return json({ ...entry.data, scope });
  } catch (error) { console.error('warmth-stats',error?.code || error?.name || 'unavailable'); return json({ available:false },503); }
}
export function onRequest({ request }) { return handleStats(request); }
