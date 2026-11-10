// One anonymous browser ID, only created after the visitor switches the appliance on.
const identifier = () => crypto.randomUUID();
const publicHosts = new Set(['warm.gongfpp.icu','cyber-handwarmer-a0z0axp0.edgeone.dev']);
const format = new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1});
export class Community {
  run = null; timer = null; scope = null; totals = null;
  constructor(node) { this.node=node; this.ready=this.load(); }
  canTrack() { return !navigator.webdriver || (!publicHosts.has(location.hostname) && new URLSearchParams(location.search).has('stats_test') && this.scope==='preview'); }
  async load() {
    try { const response=await fetch('/api/warmth',{cache:'no-store'});if(!response.ok)throw Error();this.show(await response.json()); }
    catch { if(!this.totals)this.node.hidden=true; }
  }
  show(data) {
    if(!Number.isSafeInteger(data.visitors)||data.visitors<0||!Number.isFinite(data.litMs)||data.litMs<0)return;
    this.scope=data.scope;
    if(this.totals&&(data.visitors<this.totals.visitors||data.litMs<this.totals.litMs))return;
    this.totals=data;
    const minutes=Math.floor(data.litMs/6000)/10;
    this.node.textContent=`已累计温暖 ${format.format(data.visitors)} 位访客，累计照亮 ${format.format(minutes)} 分钟的黑暗`;
    this.node.hidden=false;
  }
  start() {
    this.stop();
    if(navigator.webdriver&&!new URLSearchParams(location.search).has('stats_test'))return;
    let visitorId;
    try { visitorId=localStorage.getItem('little-warmth-visitor');if(!visitorId){visitorId=identifier();localStorage.setItem('little-warmth-visitor',visitorId);} }
    catch { visitorId=identifier(); }
    const run=this.run={visitorId,runId:identifier(),began:performance.now()};
    this.ready.then(()=>{if(this.run===run&&this.canTrack())this.report(run);});
    this.timer=setInterval(()=>{if(this.run===run)this.report(run);},30000);
  }
  report(run,beacon=false,finalMs=null) {
    if(!this.canTrack())return;
    const payload=JSON.stringify({visitorId:run.visitorId,runId:run.runId,litMs:Math.min(86400000,Math.max(0,Math.floor(finalMs??performance.now()-run.began)))});
    if(beacon&&navigator.sendBeacon?.('/api/warmth',new Blob([payload],{type:'application/json'})))return;
    fetch('/api/warmth',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true})
      .then(async response=>{if(response.ok)this.show(await response.json());}).catch(()=>{});
  }
  stop(beacon=false) {
    clearInterval(this.timer);this.timer=null;
    const run=this.run;this.run=null;if(run)this.report(run,beacon,performance.now()-run.began);
  }
}
