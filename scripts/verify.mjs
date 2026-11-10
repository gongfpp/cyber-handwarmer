import './verify-policy.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.TEST_URL || 'http://127.0.0.1:4173').replace(/\/?$/, '/');
const checks = [];
const args = process.env.TEST_GPU_BACKEND === 'metal' ? ['--use-angle=metal'] : [];
const browser = await chromium.launch({ headless: true, args });
async function instrument(cores = 8) {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
  window.__pool = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, ...rest) {
      super(url, ...rest);
      const entry = { url: String(url), terminated: false, sent: [], received: [] };
      window.__pool.push(entry); this.entry = entry;
      this.addEventListener('message', event => entry.received.push(event.data));
    }
    postMessage(data) { this.entry.sent.push(data); return super.postMessage(data); }
    terminate() { this.entry.terminated = true; return super.terminate(); }
  };
}
async function contextFor(target = browser, cores = 8) {
  const context = await target.newContext({ viewport: { width: 1440, height: 1050 } });
  context.setDefaultTimeout(12000); context.setDefaultNavigationTimeout(30000);
  await context.addInitScript(instrument, cores); return context;
}
const context = await contextFor();
const manifestResponse = await context.request.get(new URL('asset-manifest.json', base).href);
const manifest = manifestResponse.ok() ? await manifestResponse.json() : {};
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const liveCPU = () => page.evaluate(() => window.__pool.filter(w => /load-worker/.test(w.url) && !w.terminated));
async function lit() { await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true'); }
async function off() {
  await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'false');
  await page.waitForTimeout(160);
  assert(await page.evaluate(() => window.__pool.every(w => w.terminated)));
}
try {
  await page.goto(base);
  assert.equal(await page.locator('#heater').getAttribute('data-on'), 'false');
  assert.equal(await page.evaluate(() => window.__pool.length), 0);
  await page.locator('button[data-mode=toasty]').click(); await page.locator('[data-minutes="3"]').click();
  assert.equal(await page.evaluate(() => window.__pool.length), 0);
  assert.equal(await page.locator('#load-cap').innerText(), '目标工作比例 85%');
  checks.push('首次打开、预选不创建 Worker，页面显示目标工作比例 85%');
  await page.locator('#power').click(); await lit();
  await page.waitForFunction(() => window.__pool.filter(w => /load-worker/.test(w.url) && !w.terminated && w.sent.some(m => m.duty >= .849)).length === 8);
  let workers = await liveCPU(); assert.equal(workers.length, 8);
  assert(workers.some(w => w.sent.some(m => m.type === 'benchmark')));
  checks.push('8 核浏览器自动校准并升至 8 个 CPU Worker，目标工作比例 85%');
  await page.locator('button[data-mode=cozy]').click();
  await page.waitForFunction(() => window.__pool.filter(w => /load-worker/.test(w.url) && !w.terminated && w.sent.some(m => m.duty >= .81)).length === 6);
  await page.locator('[data-minutes="5"]').click();
  assert.equal(await page.locator('#countdown').textContent(), '05:00');
  await page.locator('button[data-mode=gentle]').click();
  await page.waitForFunction(() => window.__pool.filter(w => /load-worker/.test(w.url) && !w.terminated && w.sent.some(m => m.duty === .40)).length === 2);
  checks.push('运行中档位改变线程数，修改定时重新计时');
  await page.locator('#power').click(); await off(); checks.push('停止释放全部计算线程');
  await page.locator('#cpu').uncheck();
  const before = await page.evaluate(() => window.__pool.length);
  await page.locator('#power').click(); await lit();
  assert.equal(await page.evaluate(() => window.__pool.length), before);
  checks.push('CPU / GPU 均关闭时只显示炉火，无计算 Worker');
  for (const skin of ['nordic', 'retro']) {
    await page.locator(`button[data-skin=${skin}]`).click();
    for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${skin} overflow at ${width}`);
    }
  }
  checks.push('两种皮肤在七种开机视口宽度均无横向溢出');
  await page.locator('#power').click(); await off();
  const visibleText = await page.locator('body').innerText();
  for (const banned of ['灵感来自', '云游君', '由你开启', '离开就休息', '暖意因机而异', '工作占空比', '不产生计算负载']) assert(!visibleText.includes(banned));
  checks.push('主界面无来源页脚、说明条、提示卡和持续运行说明');
  await page.locator('#cpu').check(); await page.locator('#power').click(); await lit();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await off(); await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#heater').getAttribute('data-on'), 'false');
  checks.push('隐藏页面停止，返回不自动重启');
  await page.locator('#power').click(); await lit();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#heater').getAttribute('data-on'), 'true');
  await page.locator('#power').click(); await off();
  checks.push('失焦但网页可见时继续计算，便于并排查看活动监视器');
  for (const event of ['pagehide']) {
    await page.locator('#power').click(); await lit();
    await page.evaluate(event => window.dispatchEvent(new Event(event)), event); await off();
  }
  checks.push('离开页面终止计算');
  await page.locator('#open-manual').click(); assert(await page.locator('#manual').isVisible());
  await page.keyboard.press('Escape'); assert(!(await page.locator('#manual').isVisible()));
  checks.push('帮助面板可用并支持 Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#cpu').uncheck(); await page.locator('#power').click(); await lit();
  assert.equal(await page.locator('.tongue').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.locator('#power').click(); await off(); await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push('系统减少动态效果时取消炉火动画');
  await page.locator('[data-minutes="1"]').click(); await page.clock.install();
  await page.locator('#cpu').check(); await page.locator('#power').click(); await lit();
  await page.clock.fastForward(61000); await off(); assert.equal(await page.locator('#countdown').textContent(), '00:00');
  await page.locator('#cpu').uncheck(); await page.locator('#power').click(); await lit();
  await page.clock.fastForward(61000); await off();
  checks.push('计算和纯炉火两种模式到期关闭（窗口时钟加速）');
  const realContext = await contextFor(); const real = await realContext.newPage(); await real.goto(base);
  const independent = await real.evaluate(async path => {
    async function run(duration, heartbeat) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(path); let beat;
        const timeout = setTimeout(() => { worker.terminate(); clearInterval(beat); reject(new Error('self-stop timeout')); }, 6000);
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { worker.postMessage({ type: 'start', duty: .12, endAt: performance.timeOrigin + performance.now() + duration }); if (heartbeat) beat = setInterval(() => worker.postMessage({ type: 'heartbeat' }), 100); }
          if (data.type === 'stopped') { clearInterval(beat); clearTimeout(timeout); worker.terminate(); resolve(data.reason); }
        };
      });
    }
    return [await run(250, true), await run(5000, false)];
  }, manifest['load-worker.js'] || 'load-worker.js');
  assert.deepEqual(independent, ['deadline', 'heartbeat']); checks.push('CPU Worker 使用真实时钟独立到期和失去心跳自停');
  await real.locator('#cpu').uncheck(); await real.locator('#gpu').check(); await real.locator('button[data-mode=toasty]').click();
  await real.locator('#power').click();
  await real.waitForFunction(() => window.__pool.some(w => /gpu-worker/.test(w.url) && w.received.some(m => m.type === 'stats' || m.type === 'unavailable')));
  const hardware = await real.evaluate(() => window.__pool.some(w => /gpu-worker/.test(w.url) && w.received.some(m => m.type === 'stats')));
  if (hardware) {
    await real.waitForFunction(() => window.__pool.some(w => /gpu-worker/.test(w.url) && w.received.some(m => m.type === 'stats' && m.frames >= 3 && m.steps >= 384)));
    const timed = await real.evaluate(() => window.__pool.some(w => /gpu-worker/.test(w.url) && w.received.some(m => m.type === 'running' && m.device?.timerQueries)));
    if (timed) {
      await real.waitForFunction(() => window.__pool.some(w => /gpu-worker/.test(w.url) && w.received.some(m => m.type === 'stats' && m.gpuMs > 0 && m.measurement === 'gpu-timer')));
      checks.push('GPU 硬件计时扩展返回实际计算耗时，用于自适应校准');
    }
    await real.locator('#cpu').check();
    await real.waitForFunction(() => window.__pool.some(w => /load-worker/.test(w.url) && !w.terminated && w.sent.some(m => m.type === 'start' && m.mode === 'toasty' && m.duty > 0 && m.duty <= .85)));
    // The governor may reduce the pool while GPU work is active; the standalone check above verifies the eight-thread ceiling.
    const start = Date.now(); await real.locator('#power').click();
    await real.waitForFunction(() => window.__pool.every(w => w.terminated));
    assert(Date.now() - start < 1000);
    checks.push('硬件 GPU 着色器完成多个批次，CPU / GPU 同时高档时停止可响应');
    await real.locator('#cpu').uncheck(); await real.locator('#power').click();
    await real.waitForFunction(() => document.querySelector('#gpu').closest('.source').classList.contains('is-active'));
    await real.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await real.locator('#heater').getAttribute('data-on'), 'true');
    await real.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await real.waitForFunction(() => window.__pool.every(w => w.terminated));
    await real.evaluate(() => { delete document.hidden; });
    checks.push('GPU 可见时失焦继续运行，页面隐藏时释放 Worker');
    const gpuSelfStop = await real.evaluate(async path => {
      async function run(duration, heartbeat) {
        return new Promise((resolve, reject) => {
          const worker = new Worker(path, { type: 'module' }); let beat;
          const timeout = setTimeout(() => { worker.terminate(); clearInterval(beat); reject(new Error('GPU self-stop timeout')); }, 7000);
          worker.onmessage = ({ data }) => {
            if (data.type === 'ready') { worker.postMessage({ type: 'start', mode: 'gentle', endAt: performance.timeOrigin + performance.now() + duration }); if (heartbeat) beat = setInterval(() => worker.postMessage({ type: 'heartbeat' }), 100); }
            if (data.type === 'stopped') { clearInterval(beat); clearTimeout(timeout); worker.terminate(); resolve(data.reason); }
            if (data.type === 'unavailable') { clearInterval(beat); clearTimeout(timeout); worker.terminate(); reject(new Error(data.reason)); }
          };
        });
      }
      return [await run(300, true), await run(5000, false)];
    }, manifest['gpu-worker.js'] || 'gpu-worker.js');
    assert.deepEqual(gpuSelfStop, ['deadline', 'heartbeat']); checks.push('GPU Worker 使用真实时钟独立到期和失去心跳自停');
  } else checks.push('当前后端没有硬件 GPU：正确提示不可用，硬件负载路径未验');
  const failed = await realContext.newPage(); await failed.route('**/load-worker*.js', route => route.abort());
  await failed.goto(base); await failed.locator('#power').click();
  await failed.waitForFunction(() => document.querySelector('#cpu').disabled);
  assert.equal(await failed.locator('#heater').getAttribute('data-on'), 'true');
  await failed.locator('#power').click();
  checks.push('CPU Worker 加载失败自动降级为炉火展示');
  const race = await realContext.newPage();
  await race.route('**/load-worker*.js', async route => { await new Promise(resolve => setTimeout(resolve, 200)); await route.continue().catch(() => {}); });
  await race.goto(base); await race.locator('#power').click(); await race.locator('#power').click(); await race.waitForTimeout(350);
  assert.equal(await race.locator('#heater').getAttribute('data-on'), 'false'); assert(await race.evaluate(() => window.__pool.every(w => w.terminated)));
  checks.push('启动中取消不会被迟到的就绪事件重启');
  const smallContext = await contextFor(browser, 2); const small = await smallContext.newPage();
  await small.goto(base); await small.locator('button[data-mode=toasty]').click(); await small.locator('#power').click();
  await small.waitForFunction(() => window.__pool.filter(w => /load-worker/.test(w.url) && !w.terminated).length === 2);
  assert((await small.locator('#cpu-detail').textContent()).includes('2 个逻辑处理器'));
  await small.locator('#power').click(); await smallContext.close();
  checks.push('浏览器报告 2 核时自动使用 2 线程，区别于 8 核设备');
  await realContext.close(); assert.deepEqual(errors, []); checks.push('正常流程无页面 JavaScript 异常');
  console.log(JSON.stringify({ engine: 'Chromium', backend: process.env.TEST_GPU_BACKEND || 'default', passed: checks.length, checks }, null, 2));
} finally { await browser.close(); }
const softwareBrowser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const c = await contextFor(softwareBrowser); const p = await c.newPage(); await p.goto(base);
  await p.locator('#gpu').check(); await p.locator('#power').click();
  await p.waitForFunction(() => document.querySelector('#gpu').disabled);
  assert(!(await p.locator('#gpu').isChecked())); assert.equal(await p.locator('#heater').getAttribute('data-on'), 'true');
  assert(await p.evaluate(() => window.__pool.some(w => /load-worker/.test(w.url) && !w.terminated)));
  await p.locator('#power').click(); console.log('SwiftShader：拒绝将软件渲染当成 GPU，CPU 仍可运行。');
} finally { await softwareBrowser.close(); }
try {
  const wb = await webkit.launch({ headless: true });
  try {
    const p = await wb.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.goto(base); await p.locator('#power').click(); await p.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
    await p.locator('#power').click(); assert.equal(await p.locator('#heater').getAttribute('data-on'), 'false');
    console.log('WebKit：手机视口 CPU 启停通过。');
  } finally { await wb.close(); }
} catch (error) { if (/Executable doesn't exist/.test(error.message)) console.log('WebKit 未安装，未验证。'); else throw error; }
