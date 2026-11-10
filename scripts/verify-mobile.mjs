import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.TEST_URL || 'http://127.0.0.1:4173').replace(/\/?$/, '/');
const browser = await chromium.launch({ headless: true, args: process.env.TEST_GPU_BACKEND === 'metal' ? ['--use-angle=metal'] : [] });
const checks = [], errors = [];
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' };
async function setup(init, options = mobile) {
  const context = await browser.newContext(options); context.setDefaultTimeout(12000);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
    window.__workers = [];
    const NativeWorker = window.Worker;
    if (NativeWorker) window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); const record = { url: String(args[0]), sent: [], received: [], terminated: false };
        window.__workers.push(record); this.record = record;
        this.addEventListener('message', e => record.received.push(e.data));
      }
      postMessage(data) { this.record.sent.push(data); return super.postMessage(data); }
      terminate() { this.record.terminated = true; return super.terminate(); }
    };
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); return { page, context };
}
async function active(page) { await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'true'); }
async function gpuActive(page) { await page.waitForFunction(() => document.querySelector('#gpu').closest('.source').classList.contains('is-active')); }
async function stopped(page) {
  await page.waitForFunction(() => document.querySelector('#heater').dataset.on === 'false');
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__workers.every(w => w.terminated)));
  assert.equal(await page.locator('.gpu-surface').count(), 0);
}
try {
  const { page, context } = await setup();
  for (const [width, height] of [[320,568],[360,640],[390,844],[430,932],[768,1024],[844,390],[667,375]]) {
    await page.setViewportSize({ width, height });
    for (const skin of ['nordic','retro']) {
      await page.locator(`button[data-skin=${skin}]`).tap();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}x${height}`);
      for (const selector of ['#power','#cpu','#gpu','#open-manual','button[data-mode=gentle]','[data-minutes="1"]']) {
        const rect = await page.locator(selector === '#cpu' || selector === '#gpu' ? `${selector} + span` : selector).boundingBox();
        assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1, `${selector} outside ${width}x${height}: ${JSON.stringify(rect)}`);
        assert(rect.height >= 44, `${selector} touch height ${rect.height}`);
      }
    }
  }
  checks.push('两种皮肤七种手机/平板尺寸及横屏无溢出，主要触控区至少 44px 高且在屏内');
  await page.setViewportSize({ width:390, height:844 });
  assert.equal(await page.evaluate(() => window.__workers.length), 0);
  await page.locator('button[data-mode=toasty]').tap(); await page.locator('#power').tap(); await active(page);
  const first = await page.evaluate(() => window.__workers.filter(w => /load-worker/.test(w.url) && !w.terminated));
  assert(first.length <= 2); assert(first.some(w => w.sent.some(m => m.type === 'benchmark')));
  await page.waitForFunction(() => window.__workers.filter(w => /load-worker/.test(w.url) && !w.terminated).length >= 3);
  await page.locator('#power').tap(); await stopped(page);
  checks.push('手机从一至两个 CPU 线程校准起步，响应正常后升载，停止释放全部线程');
  await page.locator('#open-manual').tap(); assert(await page.locator('#manual').isVisible());
  assert(await page.locator('#close-manual').isVisible()); await page.locator('#close-manual').tap();
  await context.close();

  // Older iOS/WebViews can have WebGL2 on HTMLCanvasElement but not on OffscreenCanvas.
  const fallback = await setup(() => { window.OffscreenCanvas = undefined; });
  await fallback.page.locator('#cpu').uncheck(); await fallback.page.locator('#gpu').check(); await fallback.page.locator('#power').tap();
  await gpuActive(fallback.page); await active(fallback.page);
  await fallback.page.waitForFunction(() => /兼容模式/.test(document.querySelector('#gpu-detail').textContent));
  assert.equal(await fallback.page.evaluate(() => window.__workers.length), 0);
  await fallback.page.evaluate(() => document.dispatchEvent(new Event('freeze'))); await stopped(fallback.page);
  await fallback.context.close(); checks.push('缺少 OffscreenCanvas 时使用页面 WebGL2；冻结立即释放 GPU 上下文');

  const broken = await setup(); await broken.page.route('**/gpu-worker*.js', route => route.abort());
  await broken.page.locator('#gpu').check(); await broken.page.locator('#power').tap(); await active(broken.page); await gpuActive(broken.page);
  await broken.page.waitForFunction(() => /兼容模式/.test(document.querySelector('#gpu-detail').textContent));
  await broken.page.locator('#power').tap(); await stopped(broken.page); await broken.context.close();
  checks.push('GPU Worker / module 启动失败时自动切换页面 WebGL2，CPU 继续运行');

  const noGPU = await setup(() => {
    window.OffscreenCanvas = undefined;
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : native.call(this, type, ...args); };
  });
  await noGPU.page.locator('#cpu').uncheck(); await noGPU.page.locator('#gpu').check(); await noGPU.page.locator('#power').tap();
  await active(noGPU.page); assert(await noGPU.page.locator('#gpu').isDisabled()); assert(await noGPU.page.locator('#cpu').isChecked());
  assert(await noGPU.page.evaluate(() => window.__workers.some(w => /load-worker/.test(w.url) && !w.terminated)));
  assert.equal(await noGPU.page.locator('#feedback-text').innerText(), '');
  await noGPU.page.locator('#power').tap(); await stopped(noGPU.page); await noGPU.context.close();
  checks.push('GPU 不支持时自动选择 CPU、禁用 GPU，无新增提示文案');

  const noWorkers = await setup(() => { window.Worker = undefined; });
  assert(await noWorkers.page.locator('#cpu').isDisabled()); assert(!(await noWorkers.page.locator('#cpu').isChecked()));
  await noWorkers.page.locator('#gpu').check(); await noWorkers.page.locator('#power').tap(); await active(noWorkers.page); await gpuActive(noWorkers.page);
  await noWorkers.page.locator('#power').tap(); await stopped(noWorkers.page); await noWorkers.context.close();
  checks.push('缺少 Worker 时 CPU 自动禁用，GPU 仍可使用页面 WebGL2');

  const neither = await setup(() => {
    window.Worker = undefined; window.OffscreenCanvas = undefined;
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await neither.page.locator('#gpu').check(); await neither.page.locator('#power').tap(); await active(neither.page);
  assert(await neither.page.locator('#cpu').isDisabled()); assert(await neither.page.locator('#gpu').isDisabled());
  assert.equal(await neither.page.evaluate(() => window.__workers.length), 0);
  await neither.page.locator('#power').tap(); await stopped(neither.page); await neither.context.close();
  checks.push('CPU/GPU 均不可用时自动退为炉火展示，电源仍可启停');

  const cpuBroken = await setup(); await cpuBroken.page.route('**/load-worker*.js', route => route.abort());
  await cpuBroken.page.locator('#gpu').check(); await cpuBroken.page.locator('#power').tap(); await active(cpuBroken.page); await gpuActive(cpuBroken.page);
  assert(await cpuBroken.page.locator('#cpu').isDisabled());
  await cpuBroken.page.locator('#power').tap(); await stopped(cpuBroken.page); await cpuBroken.context.close();
  checks.push('CPU 线程失败不再连带停止可用的 GPU');

  const lost = await setup(() => { window.OffscreenCanvas = undefined; });
  await lost.page.locator('#cpu').uncheck(); await lost.page.locator('#gpu').check(); await lost.page.locator('#power').tap(); await active(lost.page); await gpuActive(lost.page);
  await lost.page.evaluate(() => document.querySelector('.gpu-surface').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await lost.page.waitForFunction(() => document.querySelector('#gpu').disabled && document.querySelector('#cpu').checked);
  assert.equal(await lost.page.locator('#heater').getAttribute('data-on'), 'true');
  await lost.page.locator('#power').tap(); await stopped(lost.page); await lost.context.close();
  checks.push('运行中 GPU 丢失自动回退 CPU，倒计时和炉火继续');

  const missing = await setup(() => {
    window.OffscreenCanvas = undefined;
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => undefined });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => undefined });
    const native = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function(name) { return name === 'EXT_disjoint_timer_query_webgl2' ? null : native.call(this, name); };
  });
  await missing.page.locator('#gpu').check(); await missing.page.locator('#power').tap(); await active(missing.page); await gpuActive(missing.page);
  assert((await missing.page.locator('#cpu-detail').innerText()).includes('2 个逻辑处理器'));
  await missing.page.waitForFunction(() => /完成等待/.test(document.querySelector('#gpu-detail').textContent));
  await missing.page.locator('#power').tap(); await stopped(missing.page); await missing.context.close();
  checks.push('核心数/内存/硬件计时扩展缺失时仍可运行，保守调度且不冒充 GPU 硬件计时');
  const quota = await setup(() => {
    const Native = window.Worker; let created = 0;
    window.Worker = class extends Native {
      constructor(...args) { if (++created > 1) throw new Error('Worker quota'); super(...args); }
    };
  });
  await quota.page.locator('button[data-mode=toasty]').tap(); await quota.page.locator('#power').tap(); await active(quota.page);
  await quota.page.waitForTimeout(2500);
  assert(!(await quota.page.locator('#cpu').isDisabled()));
  assert.equal(await quota.page.evaluate(() => window.__workers.filter(w => !w.terminated).length), 1);
  await quota.page.locator('#power').tap(); await stopped(quota.page); await quota.context.close();
  checks.push('浏览器限制线程数量时自动缩减 CPU 池，保留可用线程');

  assert.deepEqual(errors, []); checks.push('所有兼容与故障流程无页面脚本异常');
} finally { await browser.close(); }
const wb = await webkit.launch({ headless:true });
try {
  const p = await wb.newPage({ ...mobile, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  await p.goto(base); await p.locator('#power').tap(); await active(p);
  await p.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => document.querySelector('#heater').dataset.on === 'false');
  await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await p.locator('#heater').getAttribute('data-on'),'false');
  checks.push('WebKit 手机触控 CPU 启动、隐藏停止、返回不自启通过（非 iPhone 真机）');
  await p.locator('#gpu').check(); await p.locator('#power').tap(); await active(p);
  await p.waitForFunction(() => document.querySelector('#gpu').disabled || document.querySelector('#gpu').closest('.source').classList.contains('is-active'));
  if (await p.locator('#gpu').isDisabled()) checks.push('WebKit 手机视口 GPU 不可用时成功降级 CPU（非 iPhone 真机）');
  else {
    await p.waitForFunction(() => /自动.*×/.test(document.querySelector('#gpu-detail').textContent));
    checks.push('WebKit 手机视口 GPU 实际完成批次（非 iPhone 真机）');
  }
  await p.locator('#power').tap();

} finally { await wb.close(); }
console.log(JSON.stringify({ suite:'mobile-capabilities', passed:checks.length, checks, physicalDevices:false },null,2));
