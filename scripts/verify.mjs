import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const checks = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
context.setDefaultTimeout(10000);
context.setDefaultNavigationTimeout(30000);
const instrumentWorkers = () => {
  window.__pool = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      const record = { terminated: false, messages: [] };
      window.__pool.push(record); this.record = record;
    }
    postMessage(data) { this.record.messages.push(data); return super.postMessage(data); }
    terminate() { this.record.terminated = true; return super.terminate(); }
  };
};
await context.addInitScript(instrumentWorkers);
const manifestResponse = await context.request.get(new URL('asset-manifest.json', base.endsWith('/') ? base : base + '/').href);
const workerPath = manifestResponse.ok() ? (await manifestResponse.json())['load-worker.js'] : 'load-worker.js';
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const on = () => page.locator('#heater').getAttribute('data-on');
const pool = () => page.evaluate(() => window.__pool);
const off = async () => { await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'false'); assert((await pool()).every(w => w.terminated)); };
try {
  await page.goto(base);
  assert.equal(await on(), 'false'); assert.equal((await pool()).length, 0);
  await page.locator('button[data-mode=toasty]').click();
  await page.locator('[data-minutes="3"]').click();
  assert.equal((await pool()).length, 0); checks.push('初始与预选档位均不创建 Worker');
  await page.locator('#power').click();
  await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  let workers = await pool(); assert(workers.length >= 1 && workers.length <= 2);
  assert(workers.every(w => w.messages.some(m => m.type === 'start' && m.duty === .55)));
  assert.match(await page.locator('#countdown').innerText(), /0[23]:[0-5][0-9]/);
  checks.push('主动启动真实 Worker，热烈档 55%，最多两个线程');
  await page.locator('button[data-mode=cozy]').click();
  assert((await pool()).every(w => w.messages.some(m => m.type === 'update' && m.duty === .30)));
  await page.locator('[data-minutes="5"]').click();
  assert.match(await page.locator('#countdown').innerText(), /05:00/);
  assert.match(await page.locator('#feedback-text').innerText(), /重新计时/);
  await page.locator('button[data-mode=gentle]').click();
  assert((await pool()).every(w => w.messages.some(m => m.type === 'update' && m.duty === .12)));
  checks.push('运行中三档切换与 3→5 分钟重新计时');
  await page.locator('#stop').click(); await off(); checks.push('停止按钮终止全部真实 Worker');
  await page.locator('#power').click(); await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  await page.locator('#demo').check(); await off();
  const before = (await pool()).length;
  await page.locator('#power').click(); await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  assert.equal((await pool()).length, before); checks.push('切换演示先释放负载，演示启动不创建 Worker');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  }); await off();
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await on(), 'false'); checks.push('页面隐藏事件停止，恢复可见不自动重启');
  await page.locator('#demo').uncheck();
  await page.locator('#power').click(); await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await off(); checks.push('离开页面事件终止 Worker');
  await page.locator('#power').click(); await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await off(); checks.push('窗口失去焦点事件终止 Worker');
  // Fast-forward only the window clock; real Workers remain bounded and are terminated by the controller.
  await page.clock.install();
  await page.locator('[data-minutes="1"]').click();
  await page.locator('#power').click(); await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  await page.clock.fastForward(61000); await off();
  assert.equal(await page.locator('#countdown').innerText(), '00:00'); checks.push('真实计算模式计时结束释放 Worker（窗口时钟加速）');
  await page.locator('#demo').check(); await page.locator('#power').click();
  await page.clock.fastForward(61000); await off(); checks.push('炉火演示到点关闭');
  await page.clock.resume();
  // Test the Worker itself without app lifecycle assistance.
  const independentContext = await browser.newContext();
  const independentPage = await independentContext.newPage();
  await independentPage.goto(base);
  const independent = await independentPage.evaluate(async workerPath => {
    async function run(duration, heartbeat) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath); let beat;
        const timeout = setTimeout(() => { worker.terminate(); clearInterval(beat); reject(new Error('worker did not self-stop')); }, 5000);
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            worker.postMessage({ type: 'start', duty: .12, endAt: performance.timeOrigin + performance.now() + duration });
            if (heartbeat) beat = setInterval(() => worker.postMessage({ type: 'heartbeat' }), 100);
          }
          if (data.type === 'stopped') { clearTimeout(timeout); clearInterval(beat); worker.terminate(); resolve(data.reason); }
        };
      });
    }
    return [await run(250, true), await run(5000, false)];
  }, workerPath);
  await independentContext.close();
  assert.deepEqual(independent, ['deadline', 'heartbeat']); checks.push('Worker 独立到期自停与心跳丢失自停（真实时钟）');
  await page.goto(base);
  await page.locator('#open-manual').click(); assert(await page.locator('#manual').isVisible());
  await page.keyboard.press('Escape'); assert(!(await page.locator('#manual').isVisible())); checks.push('使用手册与 Escape 关闭');
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const h = document.querySelector('.heater').getBoundingClientRect();
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, left: h.left, right: h.right };
    });
    assert(geometry.scroll <= width, `horizontal overflow at ${width}: ${JSON.stringify(geometry)}`);
    assert(geometry.left >= 0 && geometry.right <= width);
  }
  checks.push('320 / 375 / 390 / 768 / 1024 / 1440 / 1920 px 布局无横向溢出');
  await page.locator('#demo').check();
  await page.locator('#power').click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `lit-state overflow at ${width}`);
  }
  await page.locator('#stop').click();
  checks.push('开机光晕在五种视口宽度内不产生横向滚动');

  const errorContext = await browser.newContext();
  errorContext.setDefaultTimeout(10000);
  await errorContext.addInitScript(instrumentWorkers);
  const failure = await errorContext.newPage();
  await failure.route('**/load-worker*.js', route => route.abort());
  await failure.goto(base); await failure.locator('#power').click();
  await failure.waitForFunction(() => document.querySelector('#feedback-text').textContent.includes('无法启动') || document.querySelector('#feedback-text').textContent.includes('未能运行'));
  assert.equal(await failure.locator('#heater').getAttribute('data-on'), 'false');
  assert((await failure.evaluate(() => window.__pool)).every(w => w.terminated)); await failure.close();
  checks.push('Worker 加载失败关闭并给出演示模式提示');
  const race = await errorContext.newPage();
  await race.route('**/load-worker*.js', async route => { await new Promise(resolve => setTimeout(resolve, 250)); await route.continue().catch(() => {}); });
  await race.goto(base);
  await race.locator('#power').click(); await race.locator('#power').click();
  await race.waitForTimeout(500);
  assert.equal(await race.locator('#heater').getAttribute('data-on'), 'false');
  assert((await race.evaluate(() => window.__pool)).every(w => w.terminated)); await race.close();
  checks.push('启动期间取消不会因迟到的 Worker 就绪而重启');
  assert.deepEqual(errors, []); checks.push('正常流程无页面 JavaScript 异常');
  console.log(JSON.stringify({ engine: 'Chromium', passed: checks.length, checks }, null, 2));
} finally { await browser.close(); }
try {
  const wb = await webkit.launch({ headless: true });
  const wp = await wb.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await wp.goto(base); await wp.locator('#power').click();
  await wp.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true');
  await wp.locator('#power').click();
  assert.equal(await wp.locator('#heater').getAttribute('data-on'), 'false');
  await wb.close(); console.log('WebKit: 实际 Worker 启停通过（模拟手机视口，非真实手机）');
} catch (error) {
  if (/Executable doesn't exist/.test(error.message)) console.log('WebKit: 未安装，未验证');
  else throw error;
}
