import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.TEST_URL || 'http://127.0.0.1:4173').replace(/\/?$/, '/');
const browser = await chromium.launch({ headless: true, args: process.env.TEST_GPU_BACKEND === 'metal' ? ['--use-angle=metal'] : [] });
const checks = [], errors = [];
async function instrument() {
  window.__contexts = []; window.__workers = [];
  const Audio = window.AudioContext;
  if (Audio) window.AudioContext = new Proxy(Audio, { construct(target, args) {
    const c = Reflect.construct(target, args); const meter = c.createAnalyser(); meter.fftSize = 2048;
    const createGain = c.createGain.bind(c);
    c.createGain = () => {
      const node = createGain(), connect = node.connect.bind(node);
      node.connect = (destination, ...rest) => {
        if (destination === c.destination) { connect(meter); meter.connect(destination); return destination; }
        return connect(destination, ...rest);
      }; return node;
    };
    c.__meter = meter; window.__contexts.push(c); return c;
  } });
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args); const record = { url: String(args[0]), sent: [], received: [], terminated: false };
      window.__workers.push(record); this.record = record;
      this.addEventListener('message', event => {
        record.received.push(event.data);
        if (window.__dropStats && event.data.type === 'stats') event.stopImmediatePropagation();
      });
    }
    postMessage(data) { this.record.sent.push(data); return super.postMessage(data); }
    terminate() { this.record.terminated = true; return super.terminate(); }
  };
  window.__amplitude = () => {
    let peak = 0;
    for (const c of window.__contexts) {
      const samples = new Float32Array(c.__meter.fftSize); c.__meter.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    } return peak;
  };
}
async function setup() {
  const c = await browser.newContext({ viewport: { width:390,height:844 },isMobile:true,hasTouch:true });
  c.setDefaultTimeout(15000); await c.addInitScript(instrument);
  const p = await c.newPage(); p.on('pageerror',error=>errors.push(error.message)); await p.goto(base);
  return { c,p };
}
async function status(p,source,value) { await p.waitForFunction(({source,value})=>document.querySelector(`#${source}-readout`).dataset.status===value,{source,value}); }
async function off(p) {
  await p.waitForFunction(()=>document.querySelector('#heater').dataset.on==='false'); await p.waitForTimeout(300);
  assert(await p.evaluate(()=>window.__workers.every(w=>w.terminated)));
  assert(await p.evaluate(()=>window.__contexts.every(c=>c.state==='suspended')));
}
try {
  const { c,p } = await setup();
  assert.equal(await p.evaluate(()=>window.__contexts.length),0);
  assert.equal(await p.evaluate(()=>window.__workers.length),0);
  assert.equal(await p.locator('#load-cap').innerText(),'目标工作比例 85%');
  assert.equal(await p.locator('#cpu-status').innerText(),'已停止'); assert.equal(await p.locator('#gpu-status').innerText(),'已关闭');
  assert.equal(await p.locator('button[aria-label*=声音],button[aria-label*=音效],button[aria-label*=静音],input[type=range]').count(),0);
  checks.push('初次打开无音频上下文、无计算任务；无声音开关或音量控件，85% 明确为目标工作比例');
  await p.locator('#power').tap();
  await status(p,'cpu','running'); assert.match(await p.locator('#cpu-value').innerText(),/\d+ 线程/);
  assert.match(await p.locator('#cpu-metric').innerText(),/次\/秒/);
  await p.waitForFunction(()=>window.__contexts.some(c=>c.state==='running') && window.__amplitude()>.0005);
  checks.push('电源手势直接启动实际音频输出，CPU 状态由计算回报确认，显示线程及实测吞吐量');
  const revision = Number(await p.locator('#cpu-readout').getAttribute('data-revision'));
  await p.locator('button[data-mode=cozy]').tap(); await status(p,'cpu','running');
  assert(Number(await p.locator('#cpu-readout').getAttribute('data-revision'))>revision);
  assert(await p.evaluate(()=>window.__workers.some(w=>w.received.some(m=>m.type==='stats'&&m.mode==='cozy'&&m.iterations>0))));
  checks.push('运行中切换 CPU 档位，收到新版本的实际计算数据后确认生效');
  await p.evaluate(()=>{window.__dropStats=true;});
  await status(p,'cpu','waiting'); assert.equal(await p.locator('#cpu-value').innerText(),'—'); assert.equal(await p.locator('#cpu-metric').innerText(),'');
  await p.evaluate(()=>{window.__dropStats=false;}); await status(p,'cpu','running');
  checks.push('CPU 数据过期会清空并显示等待，收到新数据恢复，不用旧数字伪装实时状态');
  await p.locator('#cpu').uncheck(); await status(p,'cpu','disabled');
  assert.equal(await p.locator('#cpu-value').innerText(),'—');
  await p.locator('#gpu').check(); await status(p,'gpu','running');
  assert.match(await p.locator('#gpu-value').innerText(),/批\/秒/);
  assert(await p.evaluate(()=>window.__workers.some(w=>/gpu-worker/.test(w.url)&&w.received.some(m=>m.type==='stats'&&m.frames>0&&m.batchesPerSecond>0))));
  checks.push('CPU 关闭立即撤下数据，GPU 实际完成工作后独立显示批次速率');
  const gpuRevision=Number(await p.locator('#gpu-readout').getAttribute('data-revision'));
  await p.locator('button[data-mode=gentle]').tap(); await status(p,'gpu','running');
  assert(Number(await p.locator('#gpu-readout').getAttribute('data-revision'))>gpuRevision);
  assert(await p.evaluate(()=>window.__workers.some(w=>/gpu-worker/.test(w.url)&&w.received.some(m=>m.type==='stats'&&m.mode==='gentle'&&m.revision>0))));
  checks.push('GPU 切档按实际完成批次确认版本，保留硬件耗时而不显示使用率');
  await p.evaluate(()=>{window.__dropStats=true;}); await status(p,'gpu','waiting');
  assert.equal(await p.locator('#gpu-value').innerText(),'—'); await p.evaluate(()=>{window.__dropStats=false;}); await status(p,'gpu','running');
  checks.push('GPU 过期数据同样撤下，新回报才恢复运行状态');
  await p.locator('#power').tap(); await off(p); await status(p,'gpu','stopped');
  checks.push('停止后计算线程退出、状态清空、音频淡出并挂起');
  await p.locator('#cpu').check(); await p.locator('#gpu').uncheck(); await p.locator('#power').tap(); await status(p,'cpu','running');
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await off(p); await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await p.waitForTimeout(300); assert(await p.evaluate(()=>window.__contexts.every(c=>c.state==='suspended')));
  checks.push('隐藏页面立即停声和停止计算，返回不自动恢复');
  for(let i=0;i<3;i++) { await p.locator('#power').tap(); await p.locator('#power').tap(); }
  await off(p); assert.equal(await p.evaluate(()=>window.__contexts.length),1);
  checks.push('快速启停复用音频上下文，不残留发声节点或迟到的计算启动');
  await c.close();
  const silent=await browser.newContext(); await silent.addInitScript(()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});
  const sp=await silent.newPage();sp.on('pageerror',e=>errors.push(e.message));await sp.goto(base);await sp.locator('#power').click();await status(sp,'cpu','running');await sp.locator('#power').click();await silent.close();
  checks.push('音频 API 不可用时计算和界面仍正常，无新增说明');
  assert.deepEqual(errors,[]);checks.push('所有状态、切档、音频和故障流程无脚本异常');
} finally { await browser.close(); }
const wb=await webkit.launch({headless:true});
try {
 const c=await wb.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await c.addInitScript(()=>{window.__contexts=[];const Native=window.AudioContext;window.AudioContext=new Proxy(Native,{construct(t,args){const c=Reflect.construct(t,args);window.__contexts.push(c);return c;}});});
 const p=await c.newPage();await p.goto(base);await p.locator('#power').tap();await status(p,'cpu','running');
 assert(await p.evaluate(()=>window.__contexts.some(c=>c.state==='running')));
 await p.locator('#power').tap();await p.waitForTimeout(350);assert(await p.evaluate(()=>window.__contexts.every(c=>c.state==='suspended')));
 checks.push('WebKit 手机触控可解锁声音，CPU 真实状态与停声通过（非手机真机）');
 await c.close();
} finally{await wb.close();}
console.log(JSON.stringify({suite:'live-status-and-sound',passed:checks.length,checks},null,2));
