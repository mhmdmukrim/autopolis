/* ==================================================================
   AUTOPOLIS v2 — REVENUE ENGINE
   ------------------------------------------------------------------
   Agents earn outside the tower:
     · FREELANCE / REMOTE GIGS  (clients, milestones, payouts)
     · CSE PORTFOLIO            (buy/hold/sell — paper or LIVE broker)
     · BUSINESSES               (owned ventures, see ap-life.js)
   Every flow is logged with an amount so you can audit earnings.
   ================================================================== */
(function () {
  'use strict';
  const AP = window.AP, APU = window.APU, logE = APU.logEvent;
  const R = window.APRevenue = {};

  R.cfg = {
    gigChance: 0.10,           // per agent per day
    maxConcurrentGigs: 1,
    investChance: 0.10,        // per agent per day
    minInvestCash: 250,
    minHoldings: 1,
    tradeChance: 0.16,
    allowShort: false
  };

  R.sources = { TOWER: 0, FREELANCE: 0, TRADING: 0, BUSINESS: 0, OTHER: 0 };
  R.history = [];              // [{day, tower, freelance, trading, business}]
  R.total = 0;

  const GIGS = [
    { skill: 'data-entry', pay: [18, 42] }, { skill: 'web build', pay: [60, 180] },
    { skill: 'logo design', pay: [35, 95] }, { skill: 'bookkeeping', pay: [25, 70] },
    { skill: 'translation', pay: [22, 60] }, { skill: 'copywriting', pay: [18, 55] },
    { skill: 'bug fixing', pay: [45, 150] }, { skill: 'spreadsheet automation', pay: [40, 120] },
    { skill: 'video edit', pay: [55, 160] }, { skill: 'SEO audit', pay: [30, 90] }
  ];
  const CLIENTS = ['Kandy Retail', 'Colombo Fintech', 'Negombo Tours', 'Ceylon Tea Co', 'StartupLK',
    'Jaffna Logistics', 'Galle Media', 'SL Freight', 'Aurora Labs', 'Nuwara Agro'];

  const E = (a) => a.gig || (a.gig = null);

  /* ---------------- LEARNING ----------------
     Agents learn from their OWN results which skills and shares pay
     them best — ε-greedy over real history, not a scripted table. */
  function learnPickGig(a) {
    a.skillBook = a.skillBook || {};
    if (Math.random() < 0.25) return AP.pick(GIGS);              // explore
    let best = null, bestScore = -1;
    for (const g of GIGS) {
      const s = a.skillBook[g.skill];
      const score = s && s.count ? s.total / s.count : (g.pay[0] + g.pay[1]) / 2;  // optimistic prior
      if (score > bestScore) { bestScore = score; best = g; }
    }
    return best || AP.pick(GIGS);
  }
  function recordGigOutcome(a, skill, net) {
    a.skillBook = a.skillBook || {};
    const s = a.skillBook[skill] || (a.skillBook[skill] = { count: 0, total: 0 });
    s.count++; s.total += net;
    if (s.count === 8) {
      let top = skill, topV = s.total / s.count;
      for (const k in a.skillBook) { const v = a.skillBook[k].total / a.skillBook[k].count; if (v > topV) { topV = v; top = k; } }
      logE('LEARN', 'info', a, 'SKILL_MODEL', 'after ' + Object.keys(a.skillBook).reduce((n, k) => n + a.skillBook[k].count, 0) + ' gigs, best skill is "' + top + '" (avg ' + Math.round(topV) + ' ¤)');
    }
  }
  function learnPickSymbol(a, syms) {
    a.symBook = a.symBook || {};
    if (Math.random() < 0.25) return AP.pick(syms);              // explore
    let best = null, bs = -Infinity;
    for (const s of syms) { const b = a.symBook[s]; const v = b && b.n ? b.pnl / b.n : 0; if (v > bs) { bs = v; best = s; } }
    return best || AP.pick(syms);
  }

  /* ---------------- freelance / remote work ---------------- */
  function gigTick() {
    for (const a of AP.agents.slice()) {
      if (a.age < 16 || a.gig) continue;
      if (a.edu < 1) continue;                       // needs at least A/L
      if (a.state !== 'IDLE' && a.state !== 'MOVE') continue;
      if (Math.random() > R.cfg.gigChance / 7) continue;

      const g = learnPickGig(a), client = AP.pick(CLIENTS);
      const skillBonus = 1 + a.edu * 0.22 + a.perf * 0.3;
      const pay = Math.round(AP.rand(g.pay[0], g.pay[1]) * skillBonus);
      const days = 1 + Math.floor(Math.random() * 3);
      a.gig = { client, skill: g.skill, pay, start: AP.simDay, due: AP.simDay + days, hours: 0 };
      logE('FREELANCE', 'info', a, 'GIG_ACCEPTED', client + ' · ' + g.skill + ' · ' + pay + ' ¤ over ' + days + 'd', pay);
      APU.emit('feed', ['💼 <b>' + a.name + '</b> took a ' + g.skill + ' gig for <b>' + client + '</b>', 'f-green']);
    }
  }

  function gigWork() {
    for (const a of AP.agents.slice()) {
      const g = a.gig; if (!g) continue;
      /* gigs are worked in free time — no tower slot needed */
      g.hours += AP.MIN_PER_TICK * 0.6;
      if (AP.simDay <= g.due && g.hours < 60) continue;

      a.gig = null;
      const late = AP.simDay > g.due;
      const quality = AP.clamp(0.55 + a.perf * 0.4 + a.energy / 320 - (late ? 0.25 : 0), 0.15, 1);
      const net = Math.round(g.pay * quality);
      a.money += net; a.perf = AP.clamp(a.perf + 0.02, 0, 1);
      recordGigOutcome(a, g.skill, net);
      R.sources.FREELANCE += net; R.total += net;
      logE('FREELANCE', 'info', a, late ? 'GIG_LATE' : 'GIG_COMPLETED', g.client + ' · ' + g.skill + ' · quality ' + Math.round(quality * 100) + '%', net);
      if (late) a.happiness = AP.clamp(a.happiness - 3, 0, 100);
      APU.emit('feed', ['💰 <b>' + a.name + '</b> billed <b>' + net + ' ¤</b> — ' + g.client + (late ? ' (late!)' : ''), 'f-green']);
    }
  }

  /* ---------------- market ---------------- */
  let prices = {}, marketAt = 0, liveMode = false;

  function synthetic() {
    const out = {};
    const seed = ['COMB.N0000', 'SLTL.N0000', 'JKH.N0000', 'LOLC.N0000', 'CTCL.N0000', 'HAYL.N0000',
      'VONE.N0000', 'CARG.N0000', 'SAMP.N0000', 'Nestle.N0000', 'LFIN.N0000', 'TAFL.N0000'];
    for (const s of seed) {
      const p = prices[s] ? prices[s].price : 60 + Math.random() * 900;
      const drift = (Math.random() - 0.492) * 0.028;
      out[s] = { symbol: s, price: +Math.max(4, p * (1 + drift)).toFixed(2), prev: p, changePct: +(drift * 100).toFixed(2), source: 'synthetic' };
    }
    return out;
  }

  function refreshMarket() {
    if (Date.now() - marketAt < 15000 && Object.keys(prices).length) return Promise.resolve(prices);
    const done = (p, src) => { prices = p; marketAt = Date.now(); liveMode = src === 'live'; return prices; };
    if (!APU.online) return Promise.resolve(done(synthetic(), 'synthetic'));
    return APU.api('/api/market/prices').then((p) => done(p, (p[Object.keys(p)[0]] || {}).source)).catch(() => done(synthetic(), 'synthetic'));
  }
  R.prices = () => prices; R.marketMode = () => (liveMode ? 'LIVE' : 'PAPER · synthetic');

  /* ---------------- investing ---------------- */
  function investTick() {
    for (const a of AP.agents.slice()) {
      if (a.age < 18) continue;
      if (!a.portfolio) {
        if (a.money < R.cfg.minInvestCash) continue;
        if (Math.random() > R.cfg.investChance / 7) continue;
        a.portfolio = { cash: Math.round(a.money * 0.35), holdings: {}, trades: 0, pnl: 0 };
        a.money -= a.portfolio.cash;
        logE('TRADING', 'info', a, 'ACCOUNT_OPENED', 'opened a CSE portfolio with ' + a.portfolio.cash + ' ¤', a.portfolio.cash);
        APU.emit('feed', ['📊 <b>' + a.name + '</b> opened a CSE portfolio (' + a.portfolio.cash + ' ¤)', 'f-amber']);
        continue;
      }
      if (Math.random() > R.cfg.tradeChance / 7) continue;
      const pf = a.portfolio;
      const syms = Object.keys(prices);
      if (!syms.length) continue;

      const holding = Object.keys(pf.holdings);
      const wantSell = holding.length && (Math.random() < 0.45 || pf.cash < 40);
      if (wantSell) {
        const s = AP.pick(holding), px = prices[s].price;
        const qty = pf.holdings[s];
        pf.cash += px * qty;
        const cost = a._avgCost && a._avgCost[s] ? a._avgCost[s] : px;
        const pnl = (px - cost) * qty;
        pf.pnl += pnl;
        a.symBook = a.symBook || {};
        const sb = a.symBook[s] || (a.symBook[s] = { n: 0, pnl: 0 });
        sb.n++; sb.pnl += pnl;
        delete pf.holdings[s];
        pf.trades++;
        R.sources.TRADING += pnl; R.total += pnl;
        logE('TRADING', 'info', a, 'SELL', s + ' ' + qty + '@' + px.toFixed(2) + ' · P&L ' + pnl.toFixed(0), +pnl.toFixed(2));
        APU.emit('feed', ['📉 <b>' + a.name + '</b> sold ' + qty + '× ' + s + ' · ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(0) + ' ¤', pnl >= 0 ? 'f-green' : 'f-bad']);
      } else if (pf.cash > 60) {
        const s = learnPickSymbol(a, syms), px = prices[s].price;
        const qty = Math.max(1, Math.floor(Math.min(pf.cash * 0.5, 5000) / px));
        if (px * qty > pf.cash) continue;
        pf.cash -= px * qty;
        pf.holdings[s] = (pf.holdings[s] || 0) + qty;
        a._avgCost = a._avgCost || {}; a._avgCost[s] = px;
        pf.trades++;
        logE('TRADING', 'info', a, 'BUY', s + ' ' + qty + '@' + px.toFixed(2), -(px * qty));
      }
    }
  }

  function markToMarket() {
    for (const a of AP.agents) {
      const pf = a.portfolio; if (!pf) continue;
      let v = pf.cash;
      for (const s in pf.holdings) v += (prices[s] ? prices[s].price : 0) * pf.holdings[s];
      pf.value = Math.round(v);
    }
  }

  /* bridge to the local service broker (paper now, LIVE only if you arm it) */
  R.placeOrder = function (agentId, symbol, side, qty) {
    const a = AP.agents.find((x) => x.id === agentId); if (!a) return Promise.resolve({ ok: false });
    return APU.api('/api/broker/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: a.id, agent: a.name, symbol, side, qty }) })
      .then((r) => { logE('TRADING', r.ok ? 'info' : 'error', a, 'BROKER_ORDER', (r.mode || 'local') + ' ' + side + ' ' + qty + ' ' + symbol + (r.error ? ' · ' + r.error : '')); return r; })
      .catch(() => ({ ok: false, error: 'service offline' }));
  };
  R.brokerStatus = function () { return APU.api('/api/broker/status').catch(() => ({ mode: 'local-paper', liveArmed: false })); };

  /* ---------------- daily pass ---------------- */
  APU.hooks.day.push(function () {
    gigTick();
    refreshMarket().then(investTick);
  });
  APU.hooks.tick.push(function () { gigWork(); });

  APU.hooks.day.push(function () {
    const towerIncome = AP.agents.reduce((s, a) => {
      if (!a.job) return s;
      return s + AP.TIERS[a.job.tier].pay * 0.7;
    }, 0);
    R.sources.TOWER = Math.round(towerIncome);
    if (window.APLife) R.sources.BUSINESS = Math.round(APLife.businesses.reduce((s, b) => s + (b.income || 0), 0));
    R.history.push({ day: AP.simDay, ...R.sources, total: Math.round(R.total) });
    if (R.history.length > 90) R.history.shift();
    markToMarket();
    APU.emit('revenue', R.sources);
    logE('MONEY', 'info', null, 'REVENUE_DAY', 'tower ' + R.sources.TOWER + ' · freelance ' + R.sources.FREELANCE + ' · trading ' + Math.round(R.sources.TRADING) + ' · business ' + R.sources.BUSINESS);
  });

  R.portfolioTotal = function () {
    let v = 0, n = 0;
    for (const a of AP.agents) if (a.portfolio && a.portfolio.value) { v += a.portfolio.value; n++; }
    return { value: Math.round(v), investors: n };
  };

  logE('SYSTEM', 'info', null, 'REVENUE_ENGINE', 'revenue engine attached — freelance·remote gigs·CSE portfolio·business·learning agents');
})();
