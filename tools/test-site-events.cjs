const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(__dirname+'/../public/site-events.js','utf8');
const UUID=()=>crypto.randomUUID();
class Target {constructor(){this.listeners=new Map();}addEventListener(n,f){if(!this.listeners.has(n))this.listeners.set(n,new Set());this.listeners.get(n).add(f);}removeEventListener(n,f){this.listeners.get(n)?.delete(f);}emit(n,extra={}){for(const f of [...(this.listeners.get(n)||[])])f(extra);}count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}}
function setup({url='https://gongfpp.github.io/NovelFish/',site='novelfish',dnt,gpc=false,disabled=false,qaRunId,blocked=false,store=new Map(),response,hold=false}={}){
 let t=0,seq=0,writes=0,off=disabled;const base=Date.now(),timers=new Map(),requests=[],pending=[];
 const win=new Target(),doc=new Target();const location=new URL(url), nav={doNotTrack:dnt,globalPrivacyControl:gpc};
 doc.visibilityState='visible';doc.currentScript={dataset:{siteEvents:site}};
 win.siteEventsQaRunId=qaRunId;win.siteVisitorCountDisabled=()=>off;
 const timer=(fn,delay,repeat=0)=>{const id=++seq;timers.set(id,{fn,time:t+delay,repeat});return id;};
 const clear=id=>timers.delete(id);
 const history={pushState(_s,_title,url){if(url)location.href=new URL(url,location.href).href;return 7;},replaceState(_s,_title,url){if(url)location.href=new URL(url,location.href).href;return 8;}};
 const origPush=history.pushState;
 const context={window:win,document:doc,navigator:nav,location,history,performance:{now:()=>t},Date:{now:()=>base+t},crypto:crypto.webcrypto,Map,AbortController,localStorage:{getItem(k){if(blocked)throw Error('blocked');return store.get(k)||null;},setItem(k,v){if(blocked)throw Error('blocked');writes++;store.set(k,v);}},setTimeout:(f,d)=>timer(f,d),clearTimeout:clear,setInterval:(f,d)=>timer(f,d,d),clearInterval:clear,
 fetch:async(u,o)=>{const b=JSON.parse(o.body);requests.push({url:u,options:o,body:b});if(hold)return new Promise((resolve,reject)=>pending.push({resolve,reject,body:b}));return response?response(b):{ok:true,status:200,json:async()=>({ok:true,accepted:b.events.map(x=>x.id),sourceOrigin:location.origin,channel:'github-pages',qa:!!b.qaRunId})};}};
 vm.runInNewContext(source,context);
 async function micro(){for(let i=0;i<8;i++)await Promise.resolve();}
 async function advance(ms){const end=t+ms;for(let k=0;k<2000;k++){const due=[...timers].filter(([,v])=>v.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!due)break;const[id,v]=due;t=v.time;if(v.repeat)v.time+=v.repeat;else timers.delete(id);v.fn();await micro();}t=end;await micro();}
 const control=(tag='BUTTON',region='MAIN')=>({tagName:tag,getAttribute:()=>null,closest(sel){if(sel.startsWith('button'))return this;return region?{tagName:region,getAttribute:()=>null}:null;}});
 return {win,doc,nav,context,location,history,origPush,store,requests,pending,timers,advance,micro,control,get writes(){return writes;},setOff(x){off=x;win.emit('storage');},executeAgain(){vm.runInNewContext(source,context);}};
}
(async()=>{
 let checks=0;const check=(x,msg)=>{assert.ok(x,msg);checks++;};
 let a=setup();await a.advance(210);check(a.requests.length===1,'one initial batch');let b=a.requests[0].body;
 assert.deepEqual(Object.keys(b).sort(),['bornAt','events','sessionId','version','visitorId']);checks++;
 check(b.events[0].name==='page_view','page view');check(b.events[0].path==='/NovelFish/','canonical path');check(a.writes===1,'one identity');
 check(a.requests[0].options.credentials==='omit'&&a.requests[0].options.referrerPolicy==='no-referrer','no credentials/referrer');
 let again=setup({store:a.store});await again.advance(210);check(again.requests[0].body.visitorId===b.visitorId&&again.writes===0,'identity reused');
 for(const opts of [{dnt:'1'},{dnt:'yes'},{gpc:true},{disabled:true},{blocked:true}]){let x=setup(opts);await x.advance(60000);check(!x.requests.length&&!x.writes,'privacy/storage fail closed');}
 for(const url of ['http://localhost:3000/NovelFish/','https://preview.example/NovelFish/','https://gongfpp.github.io/other/','https://gongfpp.github.io/NovelFish/%2fprivate']){let x=setup({url});await x.advance(1000);check(!x.requests.length&&!x.writes&&!x.doc.count(),'unknown route no identity/listeners');}
 for(const url of ['https://gongfpp.icu/works/hyouka-campus-3d/','https://gongfpp.github.io/works/iscream-web/','https://gongfpp.icu/chaoshi/']){let x=setup({url,site:'itsme'});await x.advance(1000);check(!x.requests.length&&!x.writes,'ItsMe exact excluded scope');}
 let qa=setup({qaRunId:UUID()});await qa.advance(210);check(qa.requests[0].body.qaRunId&&!qa.writes,'QA ephemeral only');
 for(const opts of [{qaRunId:'broken'},{qaRunId:UUID(),gpc:true},{qaRunId:UUID(),disabled:true}]){let x=setup(opts);await x.advance(500);check(!x.requests.length&&!x.writes,'QA never bypasses privacy or invalid config');}
 a.doc.emit('click',{target:a.control()});await a.advance(220);let click=a.requests.at(-1).body.events.find(x=>x.name==='ui_click');assert.deepEqual(Object.keys(click).sort(),['at','control','id','name','path','region']);checks++;check(click.control==='button'&&click.region==='main','enum only click');
 a.doc.emit('click',{target:a.control('INPUT','DIALOG')});await a.advance(220);check(a.requests.at(-1).body.events[0].control==='input','input type only');
 const before=a.doc.count();a.executeAgain();check(a.doc.count()===before,'duplicate script no listener');
 a.win.SiteEvents.mount('novelfish');check(a.doc.count()===before,'duplicate mount no listener');
 await a.advance(1200);a.doc.visibilityState='hidden';a.doc.emit('visibilitychange');await a.micro();let hidden=a.requests.at(-1).body.events.find(x=>x.name==='page_engagement');check(hidden.durationMs>0,'visible time');const n=a.requests.length;await a.advance(60000);check(a.requests.length===n,'hidden time not counted');a.doc.visibilityState='visible';a.doc.emit('visibilitychange');
 const oldSession=a.requests[0].body.sessionId;a.win.emit('pagehide');a.win.emit('pageshow',{persisted:true});await a.advance(220);check(a.requests.at(-1).body.sessionId===oldSession,'BFCache retains document session');
 check(a.history.pushState({},'', '/NovelFish/private-id?secret=x')===7,'history return preserved');await a.advance(220);const route=a.requests.at(-1).body.events;check(route.some(x=>x.name==='page_view'),'SPA pathname view');check(route.every(x=>x.path==='/NovelFish/'),'dynamic path/query not sent');
 const beforeHash=a.requests.length;a.history.replaceState({},'', '#secret');await a.advance(220);check(a.requests.length===beforeHash,'hash/query no new view');
 const handle=a.win.SiteEvents.mount('novelfish');handle.destroy();check(a.doc.count()===0&&a.win.count()===0&&a.history.pushState===a.origPush,'cleanup owns listeners/history');
 let x=setup({hold:true});await x.advance(210);const stale=x.pending[0].body.events[0].id;x.setOff(true);x.setOff(false);x.doc.emit('click',{target:x.control()});x.pending[0].reject(Error('late abort'));await x.micro();await x.advance(6000);check(x.requests.length>=2,'fresh events after resume');check(x.requests.slice(1).every(r=>r.body.events.every(e=>e.id!==stale)),'stale rejected batch never resurrected');
 let old=new Map([['site-visitor-count:v1:novelfish',JSON.stringify({visitorId:UUID(),bornAt:Date.now()-91*86400000,secret:'never'})]]);let expired=setup({store:old});await expired.advance(210);check(expired.writes===1&&!JSON.stringify(expired.requests).includes('never'),'expired identity rotate no extra fields');
 let failure=setup({response:async()=>({ok:false,status:503})});await failure.advance(6000);check(failure.requests.length===2,'bounded retry');check(failure.requests[0].body.events[0].id===failure.requests[1].body.events[0].id,'retry stable IDs');
 let bad=setup({response:async()=>({ok:false,status:400})});await bad.advance(7000);check(bad.requests.length===1,'permanent reject no retry');
 let burst=setup();for(let i=0;i<55;i++)burst.doc.emit('click',{target:burst.control()});await burst.advance(1000);check(burst.requests.every(r=>r.body.events.length<=20&&Buffer.byteLength(JSON.stringify(r.body))<=16384),'batch bounds');check(burst.requests.flatMap(r=>r.body.events).length===56,'bounded batches not duplicated');
 let cross=setup({url:'https://gongfpp.icu/resume/',site:'itsme'});await cross.advance(210);check(cross.requests[0].body.events[0].path==='/resume/','ItsMe exact public child page');
 console.log('PASS '+checks+' assertions: identity, privacy, QA, scope, lifecycle, BFCache, routes, stale requests, batching and retries.');
})().catch(e=>{console.error(e);process.exitCode=1});
