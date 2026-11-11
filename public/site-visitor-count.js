/* 自建累计访客脚注：独立站点身份，不读取游戏存档或发送页面内容。 */
(() => {
  'use strict';
  // 与自建服务的公开站点登记一致；本地与预览页不创建或发送身份。
const GH='https://gongfpp.github.io', DAY=86400000;
const gh=path=>[{origin:GH,path,prefix:true}];
const SITE_REGISTRY=Object.freeze({
 'cyber-handwarmer':[{origin:'https://warm.gongfpp.icu',path:'/',prefix:false}],
 itsme:[{origin:'https://gongfpp.icu',path:'/',prefix:false},{origin:GH,path:'/',prefix:false}],
 novelfish:gh('/NovelFish/'),
 'monkey-shakespeare':gh('/monkey-shakespeare-web/'),
 'hr-monster':gh('/hr-monster-web/'),
 'rps-mind-arena':gh('/rps-mind-arena-web/'),
 'monster-service-center':gh('/monster-service-center-web/'),
 'flappy-bird':gh('/flappy-bird-godot/'),
 cinderweave:gh('/cinderweave-godot/'),
 'hyouka-campus':gh('/hyouka-campus-3d/'),
 'leek-spire':[...gh('/leek-spire-pages/'),{origin:'https://leek-spire.gongfpp.chatgpt.site',path:'/',prefix:false},{origin:'https://leek-spire.gongfpp.chatgpt.site',path:'/fx.html',prefix:false}],
 'one-bar-left':gh('/one-bar-left/'),
 'kurumi-rewrite':gh('/kurumi-fx-rewrite/'),
 'poor-map':gh('/poor-map/'),
 'stock-workbench':[{origin:'https://stock.gongfpp.icu',path:'/',prefix:true}],
 'one-life':[{origin:'https://one-life.gongfpp.icu',path:'/',prefix:true}],
});
for(const entries of Object.values(SITE_REGISTRY)){for(const entry of entries)Object.freeze(entry);Object.freeze(entries);}
function registeredPath(site,origin,path){
 if(typeof path!=='string'||path.length>512||!path.startsWith('/')||/[?#\\\u0000-\u0020]/.test(path)||/%(?:2e|2f|5c|00)/i.test(path)||path.split('/').some(x=>x==='.'||x==='..'))return false;
 return Object.hasOwn(SITE_REGISTRY,site)&&SITE_REGISTRY[site].some(r=>r.origin===origin&&(r.prefix?path.startsWith(r.path):path===r.path));
}

  const lifetime = 90 * 24 * 60 * 60 * 1000;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  async function mount(element, site, isDisabled = () => false) {
    element.textContent = '网站累计访问人数：—';
    if (!registeredPath(site, location.origin, location.pathname)) return;
    const url = 'https://stats.gongfpp.icu/api/journey/v1/site-counts/' + encodeURIComponent(site);
    let identity = null;
    try {
      if (navigator.doNotTrack !== '1' && window.doNotTrack !== '1' && navigator.globalPrivacyControl !== true && !isDisabled()) {
        const key = 'site-visitor-count:v1:' + site;
        const now = Date.now();
        try { identity = JSON.parse(localStorage.getItem(key)); } catch (_) { /* 损坏的记录可以更新；存储禁用时保持只读。 */ }
        if (!identity || !uuid.test(identity.visitorId) || !Number.isSafeInteger(identity.bornAt) || identity.bornAt > now || now - identity.bornAt >= lifetime) {
          identity = { visitorId: crypto.randomUUID(), bornAt: now };
          localStorage.setItem(key, JSON.stringify(identity));
        }
      }
    } catch (_) { identity = null; }
    let controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 8000);
    const options = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal };
    try {
      let response;
      if (identity) {
        try {
          response = await fetch(url, { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: identity.visitorId, bornAt: identity.bornAt, path: location.pathname }) });
        } catch (_) { /* 写入失败后仍可读取真实累计值。 */ }
      }
      if (!response || !response.ok) {
        clearTimeout(timeout);
        controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 8000);
        response = await fetch(url, { ...options, signal: controller.signal });
      }
      if (!response.ok) return;
      const result = await response.json();
      if (result.version === 1 && result.site === site && Number.isSafeInteger(result.total) && result.total >= 0) {
        element.textContent = '网站累计访问人数：' + result.total.toLocaleString('zh-CN');
      }
    } catch (_) { /* 无可靠结果时保留破折号，不伪造零。 */ }
    finally { clearTimeout(timeout); }
  }
  window.SiteVisitorCount = { mount };
  document.querySelectorAll('[data-site-count]').forEach(element => {
    mount(element, element.dataset.siteCount, () => typeof window.siteVisitorCountDisabled === 'function' && window.siteVisitorCountDisabled());
  });
})();
