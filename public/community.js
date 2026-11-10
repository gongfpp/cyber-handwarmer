// One anonymous browser ID, only created after the visitor switches the appliance on.
const identifier = () => {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } catch { return null; }
};
const publicHosts = new Set(['warm.gongfpp.icu','cyber-handwarmer-a0z0axp0.edgeone.dev']);
const format = new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0});
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
    const seconds=Math.floor(data.litMs/1000);
    this.node.textContent=`已累计温暖 ${format.format(data.visitors)} 位访客，累计照亮 ${format.format(seconds)} 秒黑暗`;
    this.node.hidden=false;
  }
  start() {
    this.stop();
    if(navigator.webdriver&&!new URLSearchParams(location.search).has('stats_test'))return;
    let visitorId;
    try { visitorId=localStorage.getItem('little-warmth-visitor');if(!visitorId){visitorId=identifier();localStorage.setItem('little-warmth-visitor',visitorId);} }
    catch { visitorId=identifier(); }
    const runId=identifier();if(!visitorId||!runId)return;
    const run=this.run={visitorId,runId,began:performance.now()};
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
