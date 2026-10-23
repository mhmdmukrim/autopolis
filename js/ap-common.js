/* ==================================================================
   AUTOPOLIS v2 — COMMON LAYER
   ------------------------------------------------------------------
   Structured logging, local-service bridge, event bus, persistence.
   Loads AFTER city.js. Full power over http://, degraded over file://.
   ================================================================== */
(function () {
  'use strict';
  const AP = window.AP;
  const APU = window.APU = {};

  APU.isFile = location.protocol === 'file:';
  APU.online = false;
  APU.github = null;

  /* ---------------- event bus ---------------- */
  const listeners = {};
  APU.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return function () { const i = listeners[ev].indexOf(fn); if (i > -1) listeners[ev].splice(i, 1); }; };
  APU.emit = function (ev, data) { const l = listeners[ev]; if (!l) return; for (const f of l.slice()) { try { f(data); } catch (e) { console.error('[bus ' + ev + ']', e); } } };

  /* extension hook registry — modules push, city.js calls */
  APU.hooks = { tick: [], day: [], hour: [] };
  AP.onTick = function () { for (const f of APU.hooks.tick.slice()) f(); };
  AP.onDay = function () { for (const f of APU.hooks.day.slice()) f(); };

  APU.fmtClock = function () {
    const h = Math.floor(AP.hour()), m = Math.floor(AP.simMin % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };

  /* ---------------- structured logging ---------------- */
  const ring = APU.ring = [];
  let lastBurst = 0, burst = 0;
  const CATS = APU.CATS = ['SYSTEM', 'WORK', 'EDUCATION', 'LIFE', 'FAMILY', 'HEALTH', 'MONEY', 'TRADING', 'FREELANCE', 'LEARN', 'PROPERTY', 'VEHICLE', 'CRIME', 'WEATHER', 'DEVICE', 'GOOGLE', 'GITHUB', 'CONFIG', 'CITY'];

  APU.log = function (e) {
    /* simple burst guard so a 3600x speed-up can't flood the disk */
    const t = Date.now();
    if (t - lastBurst < 1000) { burst++; if (burst > 120) return; } else { lastBurst = t; burst = 0; }

    const entry = Object.assign({
      ts: new Date().toISOString(), day: AP.simDay, simTime: APU.fmtClock(),
      category: 'GENERAL', level: 'info', agentId: null, agent: null, event: '', detail: '', amount: null
    }, e);
    ring.push(entry);
    if (ring.length > 6000) ring.shift();
    APU.emit('log', entry);

    if (APU.online) {
      fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(function () { APU.online = false; });
    } else {
      try {
        const k = 'ap_logs', arr = JSON.parse(localStorage.getItem(k) || '[]');
        arr.push(entry); while (arr.length > 1500) arr.shift();
        localStorage.setItem(k, JSON.stringify(arr));
      } catch (_) {}
    }
  };
  AP.log = APU.log;

  APU.logEvent = function (category, level, agent, event, detail, amount) {
    APU.log({ category: category, level: level, agentId: agent ? agent.id : null, agent: agent ? agent.name : null, event: event, detail: detail || '', amount: amount == null ? null : +(+amount).toFixed(2) });
  };

  /* bridge the city feed into the structured log (significant entries only) */
  AP.onFeed = function (text, cls) {
    if (cls === '') return;                       // skip the startup tips
    APU.log({ category: 'CITY', level: cls === 'f-bad' ? 'error' : cls === 'f-amber' ? 'warn' : 'info',
      event: 'FEED', detail: String(text).replace(/<[^>]+>/g, '') });
  };

  /* ---------------- service bridge ---------------- */
  APU.api = function (path, opts) {
    if (!APU.online) return Promise.reject(new Error('service offline'));
    return fetch(path, opts).then(function (r) { return r.json(); });
  };

  APU.probe = function () {
    return fetch('/api/health', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (h) { APU.online = !!h.ok; APU.health = h; APU.emit('online', h); return h; })
      .catch(function () { APU.online = false; APU.emit('online', null); return null; });
  };

  /* ---------------- persistence ---------------- */
  function serialiseAgent(a) {
    return {
      id: a.id, name: a.name, x: a.x, y: a.y, money: a.money, energy: a.energy, hunger: a.hunger,
      happiness: a.happiness, edu: a.edu, eduXp: a.eduXp, job: a.job, underemployed: a.underemployed,
      perf: a.perf, workedToday: a.workedToday, studiedToday: a.studiedToday, sponsored: a.sponsored,
      homeIdx: a.home ? AP.homes.indexOf(a.home) : -1, homeless: a.homeless,
      age: a.age, gender: a.gender, partnerId: a.partnerId, children: a.children, pregnancy: a.pregnancy,
      health: a.health, sick: a.sick, assets: a.assets, familyId: a.familyId, metPartner: a.metPartner,
      gig: a.gig, portfolio: a.portfolio, businessId: a.businessId, spdF: a.spdF,
      skillBook: a.skillBook, symBook: a.symBook
    };
  }

  APU.snapshot = function () {
    return {
      version: 2, savedAt: new Date().toISOString(),
      simMin: AP.simMin, simDay: AP.simDay, treasury: AP.treasury, gdp: AP.gdp,
      taxRate: AP.taxRate, eduBudget: AP.eduBudget, speed: AP.speed,
      buildSpotIdx: AP.buildSpotIdx, homeSeq: AP.homeSeq,
      homes: AP.homes.map(function (h) { return { name: h.name, x: h.x, y: h.y, w: h.w, h: h.h, hh: h.hh, color: h.color }; }),
      extraBuildings: extraBuildings(),
      agents: AP.agents.map(serialiseAgent),
      businesses: window.APLife ? APLife.businesses : [],
      land: window.APLife ? APLife.land : []
    };
  };

  function extraBuildings() {
    return AP.buildings.filter(function (b) { return ['TOWER', 'INSTITUTE', 'PARK', 'CAFE'].indexOf(b.type) < 0 && AP.homes.indexOf(b) < 0; })
      .map(function (b) { return { type: b.type, name: b.name, x: b.x, y: b.y, w: b.w, h: b.h, hh: b.hh, color: b.color }; });
  }

  APU.restore = function (s) {
    if (!s || !s.agents) return false;
    AP.simMin = s.simMin; AP.treasury = s.treasury; AP.taxRate = s.taxRate; AP.eduBudget = s.eduBudget;
    AP.speed = s.speed || 1; AP.buildSpotIdx = s.buildSpotIdx; AP.homeSeq = s.homeSeq;

    /* rebuild homes that were constructed after boot */
    while (AP.homes.length < s.homes.length) {
      const idx = AP.homes.length, hd = s.homes[idx];
      const h = AP.mkBuilding({ type: 'HOME', name: hd.name, x: hd.x, y: hd.y, w: hd.w, h: hd.h, hh: hd.hh, color: hd.color });
      AP.homes.push(h);
    }
    (s.extraBuildings || []).forEach(function (b) { AP.mkBuilding(b); });
    AP.rebuildBlocked();

    /* rehydrate agents onto the same indices */
    const src = s.agents, live = AP.agents;
    for (let i = 0; i < Math.min(src.length, live.length); i++) {
      const d = src[i], a = live[i];
      Object.assign(a, {
        money: d.money, energy: d.energy, hunger: d.hunger, happiness: d.happiness, edu: d.edu, eduXp: d.eduXp,
        job: d.job, underemployed: d.underemployed, perf: d.perf, workedToday: d.workedToday, studiedToday: d.studiedToday,
        sponsored: d.sponsored, homeless: d.homeless, age: d.age, gender: d.gender, partnerId: d.partnerId,
        children: d.children || [], pregnancy: d.pregnancy || null, health: d.health == null ? 100 : d.health,
        sick: d.sick || 0, assets: d.assets || emptyAssets(), familyId: d.familyId, metPartner: d.metPartner || false,
        gig: d.gig || null, portfolio: d.portfolio || null, businessId: d.businessId || null,
        skillBook: d.skillBook || null, symBook: d.symBook || null
      });
      a.home = d.homeIdx >= 0 && AP.homes[d.homeIdx] ? AP.homes[d.homeIdx] : null;
    }
    if (window.APLife) {
      APLife.businesses = s.businesses || [];
      APLife.land = s.land || [];
    }
    AP.renderInspector(); AP.updateHud();
    APU.log({ category: 'SYSTEM', level: 'info', event: 'STATE_LOADED', detail: 'restored day ' + s.simDay + ' · ' + src.length + ' residents' });
    return true;
  };

  function emptyAssets() { return { vehicles: [], land: [], cashInvested: 0 }; }

  APU.saveLocal = function () { try { localStorage.setItem('ap_state', JSON.stringify(APU.snapshot())); return true; } catch (_) { return false; } };
  APU.loadLocal = function () { try { const s = localStorage.getItem('ap_state'); return s ? JSON.parse(s) : null; } catch (_) { return null; } };

  APU.save = function (silent) {
    const snap = APU.snapshot();
    APU.saveLocal();
    if (!APU.online) { if (!silent) APU.log({ category: 'SYSTEM', level: 'warn', event: 'SAVE_LOCAL', detail: 'service offline — saved to browser storage' }); return Promise.resolve({ where: 'localStorage' }); }
    return APU.api('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) })
      .then(function (r) { if (!silent) APU.log({ category: 'SYSTEM', level: 'info', event: 'SAVE', detail: 'state → ' + (r.savedAt || 'disk') }); return r; })
      .catch(function () { return { where: 'localStorage' }; });
  };

  APU.load = function () {
    if (!APU.online) { const l = APU.loadLocal(); return l ? Promise.resolve(l) : Promise.resolve(null); }
    return APU.api('/api/state').then(function (s) { return s && s.agents ? s : APU.loadLocal(); }).catch(function () { return APU.loadLocal(); });
  };

  /* ---------------- boot ---------------- */
  APU.probe().then(function () {
    if (APU.online) {
      APU.log({ category: 'SYSTEM', level: 'info', event: 'SERVICE_LINKED', detail: 'companion service online — logging to disk' });
      /* SSE live feed straight from the service */
      try {
        const es = new EventSource('/api/stream');
        es.addEventListener('log', function (ev) { APU.emit('serverlog', JSON.parse(ev.data)); });
        es.onerror = function () { /* EventSource auto-reconnects */ };
        APU.es = es;
      } catch (_) {}
      /* autosave */
      setInterval(function () { if (document.querySelector('#chkAutoSave') ? document.querySelector('#chkAutoSave').checked : true) APU.save(true); }, 30000);
    } else {
      APU.log({ category: 'SYSTEM', level: 'warn', event: 'SERVICE_OFFLINE',
        detail: APU.isFile ? 'opened as a file — life/revenue run, but Gmail·Drive·CCTV·disk logs need start.bat' : 'companion service not reachable' });
    }
    APU.emit('ready', APU.online);
  });

})();
