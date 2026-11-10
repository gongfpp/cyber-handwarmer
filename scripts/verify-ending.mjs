import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.TEST_URL||'http://127.0.0.1:4173').replace(/\/?$/,'/');
const browser=await chromium.launch({headless:true,args:process.env.TEST_GPU_BACKEND==='metal'?['--use-angle=metal']:[]});
const checks=[],errors=[];
async function instrument(){
 Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});
 window.__workers=[];window.__audio=[];window.__stages=[];
 const Native=window.Worker;window.Worker=class extends Native{
  constructor(...args){super(...args);this.record={url:String(args[0]),terminated:false,received:[]};window.__workers.push(this.record);this.addEventListener('message',e=>this.record.received.push(e.data));}
  terminate(){this.record.terminated=true;return super.terminate();}
 };
 const Audio=window.AudioContext;if(Audio)window.AudioContext=new Proxy(Audio,{construct(t,args){const c=Reflect.construct(t,args);c.__oscillators=0;const create=c.createOscillator.bind(c);c.createOscillator=()=>{c.__oscillators++;return create();};window.__audio.push(c);return c;}});
}
async function setup(options={}){
 const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,...options});c.setDefaultTimeout(12000);await c.addInitScript(instrument);
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
 await p.evaluate(()=>{const h=document.querySelector('#heater');new MutationObserver(()=>{const phase=h.dataset.endingStage;if(phase&&window.__stages.at(-1)!==phase)window.__stages.push(phase);}).observe(h,{attributes:true,attributeFilter:['data-endingStage','data-ending-stage']});});
 return {c,p};
}
async function lit(p){await p.waitForFunction(()=>document.querySelector('#heater').dataset.on==='true');}
async function stage(p,value){await p.waitForFunction(value=>document.querySelector('#heater').dataset.endingStage===value,value);}
async function idle(p){await p.waitForFunction(()=>document.querySelector('#heater').dataset.on==='false'&&document.querySelector('#heater').dataset.ending!=='true');}
try{
 const {c,p}=await setup();
 assert.equal(await p.locator('#open-manual,#manual,dialog,#feedback').count(),0);assert(!(await p.locator('body').innerText()).includes('?'));
 checks.push('页面不含问号、说明面板或结束提示条');
 for(const [mode,cpu,gpu]of[['gentle',40,35],['cozy',82,75],['toasty',85,85]]){
  await p.locator(`button[data-mode=${mode}]`).tap();assert.equal(await p.locator('#cpu-target').innerText(),`目标 ${cpu}%`);assert.equal(await p.locator('#gpu-target').innerText(),`目标 ${gpu}%`);
 }
 checks.push('三档 CPU/GPU 目标分别为 40/35、82/75、85/85，切换即更新且最高档才同为 85%');
 await p.locator('button[data-mode=gentle]').tap();await p.locator('#gpu').check();await p.locator('#power').tap();await lit(p);
 await p.waitForFunction(()=>document.querySelector('#cpu-readout').dataset.status==='running'&&document.querySelector('#gpu-readout').dataset.status==='running');
 const start=Date.now();await p.locator('#power').tap();assert.equal(await p.locator('#heater').getAttribute('data-on'),'false');
 assert.equal(await p.locator('#cpu-status').innerText(),'已停止');assert.equal(await p.locator('#gpu-status').innerText(),'已停止');
 await p.waitForTimeout(200);assert(await p.evaluate(()=>window.__workers.every(w=>w.terminated)));
 assert.equal(await p.locator('#cpu-value').innerText(),'—');assert.equal(await p.locator('#gpu-value').innerText(),'—');
 checks.push('熄火动作开始即停止 CPU/GPU、撤下数据，200ms 内全部计算 Worker 退出');
 await stage(p,'pour');await p.waitForTimeout(140);assert.equal(await p.locator('.shutdown-atmosphere').getAttribute('data-water'),'true');
 await stage(p,'rebel');await p.waitForTimeout(160);assert.equal(await p.locator('.shutdown-atmosphere').getAttribute('data-flame'),'true');
 assert(await p.locator('.shutdown-atmosphere').evaluate(canvas=>{const r=canvas.width/330,a=canvas.getContext('2d').getImageData(145*r,270*r,40*r,70*r).data;let hot=0;for(let i=0;i<a.length;i+=4)if(a[i]>a[i+1]+15&&a[i+1]>a[i+2]+10&&a[i+3]>12)hot++;return hot>10;}));
 await stage(p,'last-drop');await p.waitForTimeout(170);assert.equal(await p.locator('.shutdown-atmosphere').getAttribute('data-drop'),'true');
 await idle(p);assert(Date.now()-start>=2500);
 assert.deepEqual(await p.evaluate(()=>window.__stages),['arrive','pour','rebel','last-drop','out']);
 assert.equal(await p.locator('.shutdown-scene').isVisible(),false);
 await p.waitForTimeout(150);assert(await p.evaluate(()=>window.__audio.every(a=>a.state==='suspended')));
 checks.push('真实时钟顺序完成浇水、火苗反弹、最后一滴与收尾，结束隐藏动画并停声，无字幕');
 // Re-ignition must interrupt the entire old timeline, including its delayed audio.
 await p.locator('#power').tap();await lit(p);await p.locator('#power').tap();await stage(p,'pour');await p.locator('#power').tap();await lit(p);
 assert.equal(await p.locator('.shutdown-scene').isVisible(),false);await p.waitForTimeout(2900);assert.equal(await p.locator('#heater').getAttribute('data-on'),'true');
 checks.push('熄火途中可直接重新点火，迟到的动画/音效回调不会关闭新一轮运行');
 await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await idle(p);await c.close();

 const retro=await setup();await retro.p.locator('button[data-skin=retro]').tap();await retro.p.locator('#cpu').uncheck();await retro.p.locator('#power').tap();await lit(retro.p);const retroTones=await retro.p.evaluate(()=>window.__audio.reduce((n,c)=>n+c.__oscillators,0));await retro.p.locator('#power').tap();await stage(retro.p,'relight');await retro.p.waitForTimeout(150);
 assert(Number(await retro.p.locator('.coils i').last().evaluate(n=>getComputedStyle(n,'::before').opacity))>.4);
 assert.equal(await retro.p.locator('.shutdown-atmosphere').isVisible(),false); assert.equal(await retro.p.locator('.shutdown-scene').isVisible(),false);
 assert(await retro.p.locator('.relay-knob').evaluate(n=>n.getAnimations().length>0));
 await idle(retro.p);assert.equal(await retro.p.evaluate(()=>window.__audio.reduce((n,c)=>n+c.__oscillators,0)),retroTones);await retro.c.close();checks.push('电暖炉独立断电、单根电热丝回亮与旋钮再次关断；不显示水壶、水滴或蒸汽');

 const hidden=await setup();await hidden.p.locator('#cpu').uncheck();await hidden.p.locator('#power').tap();await lit(hidden.p);await hidden.p.locator('#power').tap();await stage(hidden.p,'pour');
 await hidden.p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await idle(hidden.p);await hidden.p.waitForTimeout(120);
 assert(await hidden.p.evaluate(()=>window.__audio.every(a=>a.state==='suspended')));assert.equal(await hidden.p.locator('.shutdown-scene').isVisible(),false);
 await hidden.p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await hidden.p.waitForTimeout(2900);assert.equal(await hidden.p.locator('#heater').getAttribute('data-on'),'false');await hidden.c.close();
 checks.push('熄火过程中隐藏立即取消剩余动作与音效，返回不补播、不自启');

 const reduced=await setup({reducedMotion:'reduce'});await reduced.p.locator('#cpu').uncheck();await reduced.p.locator('#power').tap();await lit(reduced.p);await reduced.p.locator('#power').tap();await idle(reduced.p);
 assert.equal(await reduced.p.locator('.shutdown-scene').isVisible(),false);await reduced.c.close();checks.push('减少动态效果时直接熄火，不播放晃动、浇水和弹跳');

 const timed=await setup();await timed.p.locator('#cpu').uncheck();await timed.p.clock.install();await timed.p.locator('#power').tap();await lit(timed.p);await timed.p.clock.fastForward(61000);
 assert.equal(await timed.p.locator('#heater').getAttribute('data-ending'),'true');assert.equal(await timed.p.locator('#countdown').innerText(),'00:00');await timed.p.clock.runFor(2800);await idle(timed.p);assert.equal(await timed.p.locator('#countdown').innerText(),'00:00');await timed.c.close();
 checks.push('计时结束自动执行完整熄火动画，保持 00:00，不新增结束文字');
 assert.deepEqual(errors,[]);checks.push('全部熄火、取消与恢复流程无脚本异常');
}finally{await browser.close();}
const wb=await webkit.launch({headless:true});
try{
 const p=await wb.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await p.goto(base);await p.locator('#cpu').uncheck();await p.locator('#power').tap();await lit(p);await p.locator('#power').tap();await stage(p,'rebel');await p.waitForTimeout(150);
 assert.equal(await p.locator('.shutdown-atmosphere').getAttribute('data-flame'),'true');await idle(p);checks.push('WebKit 手机视口完成实际弹跳与最后一滴熄火（非真机）');
}finally{await wb.close();}
console.log(JSON.stringify({suite:'last-drop',passed:checks.length,checks},null,2));
