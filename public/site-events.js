/* 自建页面事件：仅固定事件与控件枚举，不读取输入、正文、URL参数或来源页。 */
(() => {
  'use strict';
  if (window.SiteEvents?.version === 1) return;
  const REGISTRY = {"itsme":[{"origin":"https://gongfpp.icu","paths":["/2022/08/16/hello-world/","/2022/08/16/%E7%AC%AC%E4%B8%80%E7%AF%87%E6%B5%8B%E8%AF%95%E5%8D%9A%E5%AE%A2/","/2022/08/25/LeetCodeHot100/","/archives/2022/08/","/archives/2022/","/archives/","/categories/","/","/links/","/resume/","/tags/","/tags/test/","/works/agent-handoff/","/works/aki-agent-kit/","/works/binary-tree-with-qt/","/works/caculator-with-qt/","/works/chaoshi-2018/","/works/cinderweave-godot/","/works/config-reviewer/","/works/config-reviewer-builds/","/works/dsh-novel-fish/","/works/flappy-bird-godot/","/works/homebrew-tap/","/works/hr-monster-web/","/works/imagegen-skills/","/works/","/works/interface-atlas/","/works/interface-atlas-web/","/works/kurumi-fx-pages/","/works/kurumi-pixel-ui/","/works/lantern-godot/","/works/leek-spire-pages/","/works/mediagrab/","/works/monkey-shakespeare-web/","/works/monster-service-center-web/","/works/netball/","/works/notiguard/","/works/novelfish/","/works/one-bar-left/","/works/one-mute-mic/","/works/poor-map/","/works/process-killer/","/works/rps-mind-arena-web/","/works/simple-snake-game/","/works/sonfolio/","/works/sorts-with-qt/"]},{"origin":"https://gongfpp.github.io","paths":["/2022/08/16/hello-world/","/2022/08/16/%E7%AC%AC%E4%B8%80%E7%AF%87%E6%B5%8B%E8%AF%95%E5%8D%9A%E5%AE%A2/","/2022/08/25/LeetCodeHot100/","/archives/2022/08/","/archives/2022/","/archives/","/categories/","/","/links/","/resume/","/tags/","/tags/test/","/works/agent-handoff/","/works/aki-agent-kit/","/works/binary-tree-with-qt/","/works/caculator-with-qt/","/works/chaoshi-2018/","/works/cinderweave-godot/","/works/config-reviewer/","/works/config-reviewer-builds/","/works/dsh-novel-fish/","/works/flappy-bird-godot/","/works/homebrew-tap/","/works/hr-monster-web/","/works/imagegen-skills/","/works/","/works/interface-atlas/","/works/interface-atlas-web/","/works/kurumi-fx-pages/","/works/kurumi-pixel-ui/","/works/lantern-godot/","/works/leek-spire-pages/","/works/mediagrab/","/works/monkey-shakespeare-web/","/works/monster-service-center-web/","/works/netball/","/works/notiguard/","/works/novelfish/","/works/one-bar-left/","/works/one-mute-mic/","/works/poor-map/","/works/process-killer/","/works/rps-mind-arena-web/","/works/simple-snake-game/","/works/sonfolio/","/works/sorts-with-qt/"]}],"novelfish":[{"origin":"https://gongfpp.github.io","prefix":"/NovelFish/"}],"poor-map":[{"origin":"https://gongfpp.github.io","prefix":"/poor-map/"}],"stock-workbench":[{"origin":"https://stock.gongfpp.icu","prefix":"/"}],"one-life":[{"origin":"https://one-life.gongfpp.icu","prefix":"/"}],"cyber-handwarmer":[{"origin":"https://warm.gongfpp.icu","paths":["/"]}],"kurumi-rewrite":[{"origin":"https://gongfpp.github.io","prefix":"/kurumi-fx-rewrite/"}],"leek-spire":[{"origin":"https://gongfpp.github.io","prefix":"/leek-spire-pages/"},{"origin":"https://leek-spire.gongfpp.chatgpt.site","paths":["/","/fx","/fx.html"]}],"monkey-shakespeare":[{"origin":"https://gongfpp.github.io","prefix":"/monkey-shakespeare-web/"}],"hr-monster":[{"origin":"https://gongfpp.github.io","prefix":"/hr-monster-web/"}],"rps-mind-arena":[{"origin":"https://gongfpp.github.io","prefix":"/rps-mind-arena-web/"}],"monster-service-center":[{"origin":"https://gongfpp.github.io","prefix":"/monster-service-center-web/"}],"flappy-bird":[{"origin":"https://gongfpp.github.io","prefix":"/flappy-bird-godot/"}],"cinderweave":[{"origin":"https://gongfpp.github.io","prefix":"/cinderweave-godot/"}],"one-bar-left":[{"origin":"https://gongfpp.github.io","prefix":"/one-bar-left/"}]};
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const LIFETIME = 90 * 86400000;
  const instances = new Map();
  const currentScript = document.currentScript;
  function allowedPath(site) {
    const path = location.pathname;
    if (typeof path !== 'string' || path.length > 512 || !path.startsWith('/') || /[?#\\\u0000-\u0020]/.test(path) || /%(?:2e|2f|5c|00)/i.test(path) || path.split('/').some(x => x === '.' || x === '..')) return null;
    const entry = REGISTRY[site]?.find(r => r.origin === location.origin && (r.paths ? r.paths.includes(path) : path.startsWith(r.prefix)));
    return entry ? (entry.paths ? path : entry.prefix) : null;
  }
  function mount(site, options = {}) {
    if (instances.has(site)) return instances.get(site);
    if (!allowedPath(site)) return null;
    if (options.qaRunId !== undefined && !UUID.test(options.qaRunId)) return null;
    const qaRunId = options.qaRunId || null;
    const isDisabled = options.isDisabled || (() => typeof window.siteVisitorCountDisabled === 'function' && window.siteVisitorCountDisabled());
    const url = 'https://stats.gongfpp.icu/api/journey/v1/site-counts/' + encodeURIComponent(site) + '/events';
    let identity = null, sessionId = null, queue = [], pending = null, interval = null, inFlight = null;
    let started = false, destroyed = false, currentPath = null, currentRoute = null, mark = null, remainder = 0, generation = 0, failures = 0;
    const listeners = [];
    function on(target, name, fn) { target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn)); }
    function privacyAllowed() {
      try { return ![navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(x => x === '1' || x === 1 || x === 'yes') && navigator.globalPrivacyControl !== true && !isDisabled(); }
      catch (_) { return false; }
    }
    function stopPending() {
      generation += 1; queue = []; clearTimeout(pending); pending = null;
      if (inFlight) inFlight.abort();
      identity = null; sessionId = null; started = false; mark = null; remainder = 0;
    }
    function permitted() {
      if (destroyed || !allowedPath(site) || !privacyAllowed()) { stopPending(); return false; }
      if (identity && (Date.now() < identity.bornAt || Date.now() - identity.bornAt >= LIFETIME)) stopPending();
      return true;
    }
    function getIdentity() {
      if (identity) return identity;
      const now = Date.now();
      if (qaRunId) return identity = {visitorId: crypto.randomUUID(), bornAt: now};
      try {
        const key = 'site-visitor-count:v1:' + site;
        let value; try { value = JSON.parse(localStorage.getItem(key)); } catch (_) {}
        if (!value || !UUID.test(value.visitorId) || !Number.isSafeInteger(value.bornAt) || value.bornAt > now || now - value.bornAt >= LIFETIME) {
          value = {visitorId: crypto.randomUUID(), bornAt: now}; localStorage.setItem(key, JSON.stringify(value));
        }
        return identity = {visitorId: value.visitorId, bornAt: value.bornAt};
      } catch (_) { return null; }
    }
    function event(name, extra = {}) {
      if (!permitted() || !getIdentity()) return;
      const path = currentPath || allowedPath(site); if (!path) return;
      queue.push({id: crypto.randomUUID(), name, path, at: Date.now(), ...extra});
      if (queue.length > 80) queue.shift();
      if (!pending) pending = setTimeout(() => { pending = null; void flush(); }, 200);
    }
    function ensureStart() {
      if (!permitted() || !getIdentity()) return false;
      if (!started) {
        started = true; sessionId = crypto.randomUUID(); currentPath = allowedPath(site); currentRoute = location.pathname;
        mark = document.visibilityState === 'visible' ? performance.now() : null;
        event('page_view');
      }
      return true;
    }
    function settle() {
      if (!started || !permitted()) return;
      if (mark !== null) { remainder += Math.max(0, performance.now() - mark); mark = null; }
      const durationMs = Math.min(1800000, Math.floor(remainder));
      remainder = 0;
      if (durationMs > 0) event('page_engagement', {durationMs});
    }
    async function flush() {
      if (!permitted() || !started || !queue.length || inFlight) return;
      const batch = queue.splice(0,20), controller = new AbortController(), epoch = generation; inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      const body = {version:1, visitorId:identity.visitorId, bornAt:identity.bornAt, sessionId, events:batch, ...(qaRunId ? {qaRunId} : {})};
      let retry = false;
      try {
        const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',keepalive:true,signal:controller.signal,body:JSON.stringify(body)});
        if (response.ok) {
          const ack = await response.json();
          if (ack.ok !== true || !Array.isArray(ack.accepted) || ack.sourceOrigin !== location.origin || ack.qa !== Boolean(qaRunId) || !batch.every(x => ack.accepted.includes(x.id))) retry = true;
        } else retry = response.status >= 500 || response.status === 429;
      } catch (_) { retry = true; }
      finally {
        clearTimeout(timeout); if (inFlight === controller) inFlight = null;
        if (retry && epoch === generation && permitted() && started) queue = [...batch,...queue].slice(0,80);
        failures = retry ? Math.min(failures + 1,5) : 0;
        if (queue.length && permitted() && !pending) pending = setTimeout(() => { pending = null; void flush(); }, retry ? Math.min(60000,5000 * 2 ** (failures - 1)) : 200);
      }
    }
    function updateRoute() {
      if (!ensureStart()) return;
      const next = allowedPath(site);
      if (location.pathname !== currentRoute) { settle(); currentPath = next; currentRoute = location.pathname; event('page_view'); }
      if (document.visibilityState === 'visible' && mark === null) mark = performance.now();
    }
    function click(e) {
      if (!ensureStart()) return;
      const target = e.target?.closest?.('button,a,input,select,summary,[role="button"],[role="link"]');
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const control = ({a:'link',button:'button',input:'input',select:'select',summary:'summary'})[tag] || (target.getAttribute('role') === 'link' ? 'link' : 'button');
      const container = target.closest('dialog,[role="dialog"],header,main,footer');
      const region = container ? (container.tagName.toLowerCase() === 'dialog' || container.getAttribute('role') === 'dialog' ? 'dialog' : container.tagName.toLowerCase()) : 'other';
      event('ui_click',{control,region});
    }
    on(document,'click',click);
    on(document,'visibilitychange',() => {
      if (!permitted()) return;
      if (document.visibilityState === 'hidden') { settle(); void flush(); }
      else { updateRoute(); mark = performance.now(); }
    });
    on(window,'storage',() => { if (!privacyAllowed()) stopPending(); });
    on(window,'popstate',updateRoute);
    for (const method of ['pushState','replaceState']) {
      const previous = history[method];
      const wrapper = function (...args) { const result = previous.apply(this,args); updateRoute(); return result; };
      history[method] = wrapper; listeners.push(() => { if (history[method] === wrapper) history[method] = previous; });
    }
    on(window,'pagehide',() => { settle(); void flush(); mark = null; });
    on(window,'pageshow',e => { if (e.persisted && ensureStart()) { event('page_view'); if (document.visibilityState === 'visible') mark = performance.now(); } });
    interval = setInterval(() => { if (!ensureStart()) return; updateRoute(); settle(); if (document.visibilityState === 'visible') mark = performance.now(); void flush(); },30000);
    const handle = {destroy() { settle(); void flush(); destroyed = true; clearTimeout(pending); clearInterval(interval); for (const remove of listeners) remove(); instances.delete(site); }};
    instances.set(site,handle); ensureStart(); return handle;
  }
  window.SiteEvents = {version:1,mount};
  const site = currentScript?.dataset.siteEvents;
  if (site) mount(site,{qaRunId:window.siteEventsQaRunId});
})();
