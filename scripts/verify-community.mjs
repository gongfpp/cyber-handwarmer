import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { aggregateRuns, handleStats } from '../edge-functions/api/warmth.js';
const visitor = randomUUID(), second = randomUUID(), run = randomUUID(), another = randomUUID();
const key = (v,r,t) => ({key:`runs/${v}/${r}/${t}`});
assert.deepEqual(aggregateRuns([key(visitor,run,0),key(visitor,run,8000),key(visitor,run,3000),key(visitor,run,8000),key(visitor,another,2000),key(second,run,1000),{key:'invalid'},key(second,another,86400001)]), {visitors:2,sessions:3,litMs:11000});
const entries = new Map();
const factory = () => ({set:async k=>entries.set(k,''),list:async()=>({blobs:[...entries.keys()].map(key=>({key}))})});
const origin='https://warmth-test.example';
const post = (data,from=origin) => handleStats(new Request(`${origin}/api/warmth`,{method:'POST',headers:{origin:from},body:JSON.stringify(data)}),factory);
const body = litMs=>({visitorId:visitor,runId:run,litMs});
await Promise.all([post(body(1000)),post(body(5000)),post(body(3000)),post(body(5000))]);
assert.deepEqual(await (await post(body(2000))).json(),{visitors:1,sessions:1,litMs:5000,scope:'preview'});
assert.equal((await post(body(6000),'https://other.example')).status,403);
for(const data of [{...body(1),visitorId:'bad'},body(-1),body(1.5),body(86400001)])assert.equal((await post(data)).status,400);
assert.equal(entries.size,4);
assert.equal((await handleStats(new Request(`${origin}/api/warmth`,{method:'DELETE'}),factory)).status,405);
assert.equal((await handleStats(new Request(`${origin}/api/warmth`),()=>{throw Error('offline')})).status,503);
console.log('PASS: concurrent, repeated and out-of-order checkpoints count each run once; invalid/cross-origin data rejected; storage outage never invents totals.');

if(process.env.TEST_URL){
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true});
  const base=process.env.TEST_URL.replace(/\/$/,'');const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const payloads=[];
    page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/warmth'))payloads.push(r.postDataJSON());});
    await page.goto(`${base}/?stats_test=1`);
    await page.locator('#community').waitFor({state:'visible'});
    assert.match(await page.locator('#community').innerText(),/已累计温暖 .* 位访客，累计照亮 .* 分钟的黑暗/);
    assert.equal(payloads.length,0);assert.equal(await page.evaluate(()=>localStorage.getItem('little-warmth-visitor')),null);
    const read=page=>page.evaluate(async()=>{const r=await fetch('/api/warmth',{cache:'no-store'});if(!r.ok)throw Error(`stats ${r.status}`);return r.json();});
    const before=await read(page);assert.equal(before.scope,'preview');
    await page.locator('#cpu').uncheck();await page.locator('#gpu').uncheck();
    await page.locator('#power').tap();await page.waitForFunction(()=>document.querySelector('#heater').dataset.on==='true');
    await page.waitForTimeout(6500);await page.locator('#power').tap();await page.waitForTimeout(1200);
    assert(payloads.length>=2);assert(payloads.at(-1).litMs>=6000);
    assert.deepEqual(Object.keys(payloads[0]).sort(),['litMs','runId','visitorId']);
    const first=await read(page);assert.equal(first.visitors,before.visitors+1);assert(first.litMs>=before.litMs+6000);
    await page.reload();await page.locator('#community').waitFor({state:'visible'});
    await page.locator('#power').tap();await page.waitForFunction(()=>document.querySelector('#heater').dataset.on==='true');
    await page.waitForTimeout(500);
    await page.evaluate(()=>document.dispatchEvent(new Event('freeze')));await page.waitForTimeout(1000);
    const next=await read(page);assert.equal(next.visitors,first.visitors);assert(next.litMs>first.litMs);
    for(const [width,height]of[[320,568],[390,844],[768,1024],[667,375],[1440,1000]]){
      await page.setViewportSize({width,height});
      for(const skin of ['nordic','retro']){
        await page.locator(`button[data-skin=${skin}]`).click();
        const rect=await page.locator('#community').boundingBox();
        assert(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=height+1,`footer outside ${width}x${height}: ${JSON.stringify(rect)}`);
      }
    }
    const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto(`${base}/?stats_test=1`);await otherPage.locator('#community').waitFor({state:'visible'});
    await otherPage.locator('#cpu').uncheck();await otherPage.locator('#power').click();await otherPage.waitForTimeout(500);await otherPage.locator('#power').click();await otherPage.waitForTimeout(500);
    assert.equal((await read(otherPage)).visitors,next.visitors+1);await other.close();
    await page.route('**/api/warmth',route=>route.fulfill({status:503,body:'{"available":false}'}));await page.reload();
    assert(await page.locator('#community').isHidden());
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS: real browser start/stop/freeze, anonymous repeat visitor, second browser, actual lit duration, no tracking before start, outage hiding, two skins / five responsive layouts.');
  }finally{await browser.close();}
}
