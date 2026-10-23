/* ==================================================================
   AUTOPOLIS v2 — CONSOLE
   Injects the bottom command console:
   LOG · REVENUE · LIFE · GITHUB · DEVICES · CONFIG
   ================================================================== */
(function () {
  'use strict';
  const AP = window.AP, APU = window.APU;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('en-US');

  const app = document.querySelector('.app') || document.body;
  const node = document.createElement('section');
  node.className = 'ap-console';
  node.innerHTML =
    '<div class="apc-head">' +
      '<span class="apc-title">◈ COMMAND CONSOLE</span>' +
      '<nav class="apc-tabs">' +
        '<button class="apc-tab active" data-t="log">LOG</button>' +
        '<button class="apc-tab" data-t="revenue">REVENUE</button>' +
        '<button class="apc-tab" data-t="life">LIFE</button>' +
        '<button class="apc-tab" data-t="github">GITHUB</button>' +
        '<button class="apc-tab" data-t="devices">DEVICES</button>' +
        '<button class="apc-tab" data-t="inbox">INBOX<b id="apInboxN"></b></button>' +
        '<button class="apc-tab" data-t="config">CONFIG</button>' +
      '</nav>' +
      '<span class="apc-conn" id="apConn">PROBING…</span>' +
      '<button class="apc-collapse" id="apCollapse">▾</button>' +
    '</div>' +
    '<div class="apc-body" id="apBody"></div>';
  app.appendChild(node);

  const body = $('apBody');
  let tab = 'log';

  /* ---------------- LOG ---------------- */
  let catFilter = 'ALL', q = '', follow = true;
  function logView() {
    return '<div class="apc-tools">' +
      '<input id="apSearch" placeholder="search events, agents, details…" value="' + esc(q) + '" />' +
      '<label class="apc-check"><input type="checkbox" id="apFollow" ' + (follow ? 'checked' : '') + '> follow</label>' +
      '<button class="apc-btn" id="apExport">⬇ EXPORT JSONL</button>' +
      '<button class="apc-btn" id="apClear">clear view</button>' +
      '</div><div class="apc-chips" id="apChips"></div><div class="apc-log" id="apLogList"></div>';
  }
  function renderChips() {
    const counts = {};
    for (const e of APU.ring) counts[e.category] = (counts[e.category] || 0) + 1;
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    $('apChips').innerHTML = ['ALL'].concat(cats).map((c) =>
      '<button class="apc-chip ' + (c === catFilter ? 'on' : '') + '" data-c="' + c + '">' + c + ' <b>' + (c === 'ALL' ? APU.ring.length : counts[c]) + '</b></button>').join('');
  }
  const LEVEL_CLS = { info: '', warn: 'lv-warn', error: 'lv-err' };
  function renderLog() {
    const box = $('apLogList'); if (!box) return;
    const needle = q.toLowerCase();
    const rows = APU.ring.filter((e) => {
      if (catFilter !== 'ALL' && e.category !== catFilter) return false;
      if (!needle) return true;
      return (e.event + ' ' + e.detail + ' ' + (e.agent || '') + ' ' + e.category).toLowerCase().indexOf(needle) > -1;
    }).slice(-320);
    box.innerHTML = rows.map((e) =>
      '<div class="apc-row ' + (LEVEL_CLS[e.level] || '') + '">' +
        '<span class="lg-ts">D' + e.day + ' ' + esc(e.simTime) + '</span>' +
        '<span class="lg-cat" data-c="' + esc(e.category) + '">' + esc(e.category) + '</span>' +
        '<span class="lg-ev">' + esc(e.event) + '</span>' +
        '<span class="lg-dt">' + esc(e.detail) + '</span>' +
        (e.amount == null ? '' : '<span class="lg-amt ' + (e.amount < 0 ? 'neg' : 'pos') + '">' + (e.amount < 0 ? '' : '+') + num(e.amount) + '</span>') +
      '</div>').join('') || '<p class="dim">No events yet.</p>';
    if (follow) box.scrollTop = box.scrollHeight;
  }

  /* ---------------- REVENUE ---------------- */
  function revenueView() {
    const R = window.APRevenue || { sources: {}, history: [] };
    const s = R.sources, tot = s.TOWER + s.FREELANCE + s.TRADING + s.BUSINESS || 1;
    const pf = R.portfolioTotal ? R.portfolioTotal() : { value: 0, investors: 0 };
    const bar = (k, label, col) => {
      const v = Math.max(0, s[k] || 0), pct = ((v / tot) * 100).toFixed(1);
      return '<div class="rev-row"><span>' + label + '</span><div class="rev-track"><i style="width:' + pct + '%;background:' + col + '"></i></div><b>' + num(v) + '</b></div>';
    };
    const earners = AP.agents.slice().sort((a, b) => b.money - a.money).slice(0, 6);
    const brokers = R.brokerStatus ? R.brokerStatus() : Promise.resolve({ mode: 'local', liveArmed: false });
    return '<div class="apc-grid">' +
      '<div class="rev-panel"><h5>REVENUE BY SOURCE</h5>' +
        bar('TOWER', 'Tower salary', '#25e6ff') +
        bar('FREELANCE', 'Freelance / remote', '#3dffa0') +
        bar('TRADING', 'CSE trading P&L', '#ffb545') +
        bar('BUSINESS', 'Businesses', '#ff3df0') +
        '<p class="dim">Cumulative across the whole simulation. Every line item is in the LOG tab with an amount.</p>' +
      '</div>' +
      '<div class="rev-panel"><h5>MARKET</h5>' +
        '<div class="mini-grid">' +
          '<div class="mini"><span>MODE</span><b>' + esc(R.marketMode ? R.marketMode() : '—') + '</b></div>' +
          '<div class="mini"><span>INVESTORS</span><b>' + pf.investors + '</b></div>' +
          '<div class="mini"><span>PORTFOLIO VALUE</span><b>' + num(pf.value) + ' ¤</b></div>' +
          '<div class="mini"><span>TOTAL EARNED</span><b>' + num(R.total || 0) + ' ¤</b></div>' +
        '</div>' +
        '<div id="apBroker" class="dim">checking broker…</div>' +
      '</div>' +
      '<div class="rev-panel"><h5>WEALTHIEST</h5>' +
        earners.map((a) => '<div class="earner"><b>' + esc(a.name) + '</b><span>' + (a.job ? AP.TIERS[a.job.tier].name : (a.gig ? 'freelancer' : 'unemployed')) + '</span><em>' + num(a.money) + ' ¤</em></div>').join('') +
      '</div>' +
      '<div class="rev-panel"><h5>LEARNING</h5>' +
        '<p class="dim">Agents learn from their own results which skills and shares pay them best (ε-greedy on real history — not scripted).</p>' +
        learnSummary() +
      '</div>' +
      '<div class="rev-panel"><h5>REAL PAYOUTS (you)</h5>' +
        '<p class="dim">Log freelance/remote income you actually received. Every entry is audited in the LOG tab under FREELANCE.</p>' +
        '<div id="apIncome"><p class="dim">loading…</p></div>' +
        '<input id="apIncPlatform" placeholder="platform e.g. Upwork, Fiverr, direct client" />' +
        '<input id="apIncAmount" type="number" placeholder="amount received" />' +
        '<input id="apIncNote" placeholder="note (optional)" />' +
        '<div class="btn-row"><button class="apc-btn" id="apIncAdd">➕ RECORD PAYOUT</button></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- LIFE ---------------- */
  function lifeView() {
    const L = window.APLife;
    if (!L) return '<p class="dim">Life engine not loaded.</p>';
    const c = L.census();
    const mini = (k, v) => '<div class="mini"><span>' + k + '</span><b>' + v + '</b></div>';
    return '<div class="apc-grid">' +
      '<div class="rev-panel"><h5>CENSUS</h5><div class="mini-grid">' +
        mini('POPULATION', c.population) + mini('AVG AGE', c.avgAge) + mini('MARRIED', c.married) +
        mini('COUPLES', Math.round(c.couples)) + mini('PREGNANT', c.pregnant) + mini('CHILDREN <18', c.children) +
        mini('SENIORS 60+', c.seniors) + mini('AVG HEALTH', c.avgHealth + '%') +
        mini('VEHICLE OWNERS', c.vehicleOwners) + mini('LANDOWNERS', c.landowners) +
        mini('BUSINESSES', c.businesses) + mini('WEATHER', c.weather) +
      '</div></div>' +
      '<div class="rev-panel"><h5>PERSONAL ACTIONS</h5>' +
        '<p class="dim">Pick an agent in the city first, then act on their behalf.</p>' +
        '<div class="btn-row">' +
          '<button class="apc-btn" data-act="land">🗺 BUY LAND <i>' + L.cfg.landCost + '</i></button>' +
          '<button class="apc-btn" data-act="house">🏡 BUILD HOUSE <i>' + L.cfg.houseBuildCost + '</i></button>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="apc-btn" data-act="biz">🏪 OPEN BUSINESS <i>' + L.cfg.businessCost + '</i></button>' +
          '<button class="apc-btn" data-act="invest">📊 START INVESTING</button>' +
        '</div>' +
        '<h5>LIFE EVENT RATES</h5>' +
        '<label class="slabel">Marriage chance/day <b>' + (L.cfg.marryChance * 100).toFixed(1) + '%</b></label>' +
        '<input type="range" data-cfg="marryChance" min="0" max="30" value="' + (L.cfg.marryChance * 1000) + '" />' +
        '<label class="slabel">Birth chance/day <b>' + (L.cfg.birthChance * 100).toFixed(1) + '%</b></label>' +
        '<input type="range" data-cfg="birthChance" min="0" max="100" value="' + (L.cfg.birthChance * 1000) + '" />' +
        '<label class="slabel">Crime rate <b>' + (L.cfg.crimeRate * 100).toFixed(1) + '%</b></label>' +
        '<input type="range" data-cfg="crimeRate" min="0" max="200" value="' + (L.cfg.crimeRate * 1000) + '" />' +
        '<label class="slabel">Security spend <b>' + Math.round(L.cfg.securitySpend * 100) + '%</b></label>' +
        '<input type="range" data-cfg="securitySpend" min="0" max="100" value="' + (L.cfg.securitySpend * 100) + '" />' +
        '<label class="slabel">1 year per N sim days <b>' + L.cfg.ageDaysPerYear + '</b></label>' +
        '<input type="range" data-cfg="ageDaysPerYear" min="2" max="120" value="' + L.cfg.ageDaysPerYear + '" />' +
      '</div>' +
    '</div>';
  }

  /* ---------------- GITHUB ---------------- */
  function githubView() {
    const g = (window.APWorld || {}).github;
    if (!g) return '<p class="dim">Loading GitHub…</p>';
    if (g.error) return '<p class="dim">' + esc(g.error) + '</p>';
    if (!g.profile) return '<p class="dim">Fetching profile…</p>';
    const p = g.profile;
    return '<div class="apc-grid">' +
      '<div class="rev-panel gh-card">' +
        '<img class="gh-av" src="' + esc(p.avatar_url) + '" alt="">' +
        '<div><h5>' + esc(p.name || p.login) + '</h5>' +
        '<p class="dim">@' + esc(p.login) + (p.hireable ? ' · <b class="hire">AVAILABLE FOR HIRE</b>' : '') + '</p>' +
        '<div class="mini-grid">' +
          '<div class="mini"><span>PUBLIC REPOS</span><b>' + p.public_repos + '</b></div>' +
          '<div class="mini"><span>FOLLOWERS</span><b>' + p.followers + '</b></div>' +
          '<div class="mini"><span>SINCE</span><b>' + esc(String(p.created_at || '').slice(0, 4)) + '</b></div>' +
          '<div class="mini"><span>EVENTS</span><b>' + p.public_gists + '</b></div>' +
        '</div>' +
        '<a class="apc-btn" href="' + esc(p.html_url) + '" target="_blank" rel="noopener">OPEN GITHUB ↗</a>' +
        '</div>' +
      '</div>' +
      '<div class="rev-panel"><h5>RECENTLY UPDATED REPOS</h5>' +
        (window.APWorld.topRepos(8).map((r) =>
          '<div class="earner"><b><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></b>' +
          '<span>' + esc(r.language || '—') + ' · ★' + r.stargazers_count + '</span>' +
          '<em>' + esc(String(r.pushed_at || '').slice(0, 10)) + '</em></div>').join('') || '<p class="dim">No repos.</p>') +
      '</div>' +
    '</div>';
  }

  /* ---------------- DEVICES ---------------- */
  function devicesView() {
    const W = window.APWorld, D = W ? W.devices : { cameras: [] };
    const nets = D.scan && D.scan.ok ? D.scan.nets : [];
    const cams = D.cameras || [];
    return '<div class="apc-grid">' +
      '<div class="rev-panel"><h5>LOCAL NETWORK</h5>' +
        '<p class="dim">Reads the ARP table your own PC already knows. No scanning, no login bypass.</p>' +
        '<div class="btn-row"><button class="apc-btn" id="apScan">🔍 SCAN LAN</button>' +
        (D.scan && D.scan.ok ? '<span class="apc-conn">host ' + esc(D.scan.host) + '</span>' : '') + '</div>' +
        (D.error ? '<p class="dim lv-err">' + esc(D.error) + '</p>' : '') +
        nets.map((n) => '<h6>Interface ' + esc(n.interface) + '</h6>' + n.devices.slice(0, 40).map((d) =>
          '<div class="earner"><b>' + esc(d.ip) + '</b><span>' + esc(d.mac) + '</span><em>' + esc(d.type) + '</em></div>').join('')).join('') +
      '</div>' +
      '<div class="rev-panel"><h5>CCTV / DOORBELL</h5>' +
        '<p class="dim">Add a camera by its snapshot URL (most IP cams expose <code>/snapshot.jpg</code> or <code>/cgi-bin/snapshot.cgi</code>). <b>V380 Pro:</b> enable RTSP in the app (Camera → Network → RTSP/ONVIF), then use <code>rtsp://user:pass@ip:554/live</code> — RTSP snapshots need ffmpeg on this PC. Login stays yours — I never touch or bypass a device password.</p>' +
        '<div id="apCaps" class="dim">checking capabilities…</div>' +
        '<input id="apCamName" placeholder="name e.g. Front Door" />' +
        '<input id="apCamUrl" placeholder="http://192.168.8.x/snapshot.jpg" />' +
        '<div class="btn-row"><button class="apc-btn" id="apAddCam">➕ ADD CAMERA</button></div>' +
        '<div class="cam-grid">' + (cams.map((c) =>
          '<figure class="cam"><img src="' + esc(W.snapshotURL(c.id) || '') + '" onerror="this.style.opacity=.25" alt=""><figcaption>' + esc(c.name) + '</figcaption></figure>').join('') ||
          '<p class="dim">No cameras configured yet.</p>') + '</div>' +
      '</div>' +
      '<div class="rev-panel"><h5>ACCOUNTS</h5>' +
        '<div class="earner"><b>Gmail / Drive</b><span id="apGoogleSt">…</span><em><button class="apc-btn" id="apGoogleBtn">CONNECT</button></em></div>' +
        '<p class="dim">Google sign-in uses your own OAuth client from Google Cloud Console. The consent screen and the password are Google\'s — this service only holds the token on your disk.</p>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- CONFIG ---------------- */
  function configView() {
    const cfg = { life: (window.APLife || {}).cfg, revenue: (window.APRevenue || {}).cfg };
    return '<div class="apc-grid">' +
      '<div class="rev-panel"><h5>DEMO vs REAL</h5>' +
        '<p class="dim">Every subsystem, live status. DEMO = simulated inside the city. REAL = wired to the outside world.</p>' +
        '<div id="apModes" class="dim">loading…</div>' +
      '</div>' +
      '<div class="rev-panel"><h5>SIMULATION</h5>' +
        '<label class="slabel">Speed <b id="apSpdLabel">' + speedLabel() + '</b></label>' +
        '<input type="range" id="apSpeed" min="0" max="4" step="1" value="' + speedIndex() + '" />' +
        '<p class="dim">1× = REAL time: one city minute per real minute, a full day takes 24 hours. Keys 1–5 jump between presets.</p>' +
        '<div class="btn-row">' +
          '<label class="apc-check"><input type="checkbox" id="chkAutoSave" checked> autosave every 30s</label>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="apc-btn" id="apSave">💾 SAVE STATE</button>' +
          '<button class="apc-btn" id="apLoad">📂 LOAD STATE</button>' +
          '<button class="apc-btn danger" id="apReset">↻ NEW CITY</button>' +
        '</div>' +
      '</div>' +
      '<div class="rev-panel"><h5>EDIT EVERYTHING</h5>' +
        '<p class="dim">This JSON is the live config. Edit it and hit Apply — no restart needed.</p>' +
        '<textarea id="apCfg" spellcheck="false">' + esc(JSON.stringify(cfg, null, 2)) + '</textarea>' +
        '<div class="btn-row"><button class="apc-btn" id="apApply">✔ APPLY</button>' +
        '<button class="apc-btn" id="apRevert">↺ revert</button></div>' +
      '</div>' +
      '<div class="rev-panel"><h5>BROKER</h5>' +
        '<p class="dim">Agents trade a paper portfolio by default. Switching to LIVE only takes effect if you also arm it in <code>data/config.json</code> with your own broker endpoint and key — then real orders go to YOUR broker.</p>' +
        '<div id="apBroker2" class="dim">checking…</div>' +
        '<label class="slabel">Paper cash <b>' + num(100000) + '</b></label>' +
        '<div class="btn-row"><button class="apc-btn" id="apBrokerRefresh">↻ refresh</button></div>' +
        '<h5>SERVICE LOGS ON DISK</h5>' +
        '<div id="apLogDir" class="dim">…</div>' +
        '<div class="btn-row"><button class="apc-btn" id="apLogInfo">ℹ WHERE ARE MY LOGS?</button></div>' +
      '</div>' +
      '<div class="rev-panel"><h5>NOTIFICATIONS & DIGEST</h5>' +
        '<p class="dim">Telegram bot pushes alerts and approval requests to your phone for free. WhatsApp goes through the free CallMeBot bridge (save your number, then send the one-time activation message it replies with). A generic webhook works with n8n/IFTTT too.</p>' +
        '<input id="ntTgToken" placeholder="telegram bot token (from @BotFather)" />' +
        '<input id="ntTgChat" placeholder="telegram chat id (from @userinfobot)" />' +
        '<input id="ntWaPhone" placeholder="whatsapp phone (+countrycode) via CallMeBot" />' +
        '<input id="ntHook" placeholder="webhook url (optional, e.g. n8n/IFTTT)" />' +
        '<label class="apc-check"><input type="checkbox" id="ntDigest"> nightly email digest</label>' +
        '<input id="ntDigestTo" placeholder="digest recipient email" />' +
        '<label class="slabel">Digest time (your local clock)</label>' +
        '<input id="ntHour" type="number" min="0" max="23" style="width:60px" /> : <input id="ntMin" type="number" min="0" max="59" style="width:60px" />' +
        '<div class="btn-row">' +
          '<button class="apc-btn" id="ntSave">💾 SAVE</button>' +
          '<button class="apc-btn" id="ntTest">🔔 TEST ALERT</button>' +
          '<button class="apc-btn" id="ntDigestTest">✉ TEST DIGEST</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  const SPEEDS = [1, 60, 600, 3600, 20000];
  function speedLabel() {
    const s = AP.speed;
    return s === 1 ? '1× REAL TIME' : s >= 20000 ? '20000×' : s + '×';
  }
  function speedIndex() { const i = SPEEDS.indexOf(AP.speed); return i < 0 ? 0 : i; }

  /* ---------------- render + wire ---------------- */
  function render() {
    body.innerHTML = tab === 'log' ? logView() : tab === 'revenue' ? revenueView() : tab === 'life' ? lifeView()
      : tab === 'github' ? githubView() : tab === 'devices' ? devicesView() : tab === 'inbox' ? inboxView() : configView();
    wire();
    if (tab === 'log') { renderChips(); renderLog(); }
    if (tab === 'revenue') { showBroker(); loadIncome(); }
    if (tab === 'devices') { refreshGoogle(); loadCaps(); }
    if (tab === 'inbox') loadInbox();
    if (tab === 'config') { showBroker2(); loadNotifyCfg(); loadModes(); }
  }

  function showBroker() {
    const box = $('apBroker'); if (!box || !window.APRevenue) return;
    APRenue.brokerStatus().then((b) => {
      box.innerHTML = 'Broker: <b>' + esc(b.mode) + '</b> · live armed: <b class="' + (b.liveArmed ? 'lv-err' : '') + '">' + (b.liveArmed ? 'YES — real orders' : 'no') + '</b>';
    });
  }
  function showBroker2() {
    const box = $('apBroker2');
    if (box && window.APRevenue) APRenue.brokerStatus().then((b) => { box.innerHTML = 'mode <b>' + esc(b.mode) + '</b> · live <b>' + (b.liveArmed ? 'ARMED' : 'off') + '</b>'; });
    const dir = $('apLogDir');
    if (dir && APU.health) dir.innerHTML = '<code>' + esc(APU.health.logs || 'n/a') + '</code>';
  }
  function refreshGoogle() {
    const box = $('apGoogleSt'); if (!box || !window.APWorld) return;
    const map = { connected: 'CONNECTED ✓', ready: 'configured — authorise', 'not-configured': 'needs your OAuth client id', 'service-offline': 'service offline', unknown: '…' };
    box.textContent = APU.online ? (map[APWorld.google.status] || '…') : 'service offline';
  }

  /* ---------------- real payouts ---------------- */
  function learnSummary() {
    const skills = {}, syms = {};
    for (const a of AP.agents) {
      if (a.skillBook) for (const k in a.skillBook) { const s = a.skillBook[k]; skills[k] = skills[k] || { n: 0, t: 0 }; skills[k].n += s.count; skills[k].t += s.total; }
      if (a.symBook) for (const k in a.symBook) { const s = a.symBook[k]; syms[k] = syms[k] || { n: 0, pnl: 0 }; syms[k].n += s.n; syms[k].pnl += s.pnl; }
    }
    const topSkills = Object.entries(skills).filter(([, v]) => v.n).sort((a, b) => (b[1].t / b[1].n) - (a[1].t / a[1].n)).slice(0, 5);
    const topSyms = Object.entries(syms).filter(([, v]) => v.n).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 5);
    return (topSkills.map((e) => '<div class="earner"><b>' + esc(e[0]) + '</b><span>' + e[1].n + ' gigs</span><em>avg ' + Math.round(e[1].t / e[1].n) + ' ¤</em></div>').join('') || '<p class="dim">No gig history yet.</p>') +
      (topSyms.length ? '<h5>SHARES THAT PAID</h5>' + topSyms.map((e) => '<div class="earner"><b>' + esc(e[0]) + '</b><span>' + e[1].n + ' trades</span><em class="' + (e[1].pnl >= 0 ? '' : 'lv-err') + '">' + (e[1].pnl >= 0 ? '+' : '') + Math.round(e[1].pnl) + ' ¤</em></div>').join('') : '');
  }

  function loadIncome() {
    const box = $('apIncome'); if (!box) return;
    if (!APU.online) { box.innerHTML = '<p class="dim">Service offline — payouts are recorded when the local service runs.</p>'; return; }
    APU.api('/api/income').then((list) => {
      const total = list.reduce((s, e) => s + e.amount, 0);
      box.innerHTML = (list.slice(-8).reverse().map((e) =>
        '<div class="earner"><b>' + esc(e.platform) + '</b><span>' + esc(e.date) + (e.note ? ' · ' + esc(e.note) : '') + '</span>' +
        '<em>' + num(e.amount) + ' ' + esc(e.currency) + ' <button class="apc-btn" data-inc="' + e.id + '">🗑</button></em></div>').join('') || '<p class="dim">Nothing recorded yet.</p>') +
        '<p class="dim">Total recorded: <b>' + num(total) + '</b> across ' + list.length + ' payouts</p>';
      box.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => {
        APU.api('/api/income/' + b.dataset.inc, { method: 'DELETE' }).then(() => loadIncome()).catch(() => APU.emit('toast', '⚠ service offline'));
      }));
    }).catch(() => { box.innerHTML = '<p class="dim">Cannot reach the local service.</p>'; });
  }

  /* ---------------- approval inbox ---------------- */
  function inboxView() {
    return '<div class="apc-grid"><div class="rev-panel"><h5>APPROVAL INBOX</h5>' +
      '<p class="dim">Anything the AI wants to do that touches the outside world (send email, place a live order) lands here first. You approve or reject — every decision is logged and pushed to your phone if Telegram is configured.</p>' +
      '<div class="btn-row"><button class="apc-btn" id="apInboxRefresh">↻ refresh</button></div>' +
      '<div id="apInboxList"><p class="dim">loading…</p></div></div></div>';
  }
  function loadInbox() {
    const box = $('apInboxList'); if (!box) return;
    if (!APU.online) { box.innerHTML = '<p class="dim">Service offline — approvals need the local service.</p>'; return; }
    APU.api('/api/approvals').then((list) => {
      const pend = list.filter((a) => a.status === 'pending');
      const done = list.filter((a) => a.status !== 'pending').slice(0, 20);
      box.innerHTML =
        (pend.map((a) => '<div class="earner"><b>#' + a.id + ' ' + esc(a.title) + '</b><span>' + esc(a.detail || a.kind) + '</span>' +
          '<em><button class="apc-btn" data-ap="' + a.id + '" data-apact="approve">✔ APPROVE</button> ' +
          '<button class="apc-btn danger" data-ap="' + a.id + '" data-apact="reject">✖ REJECT</button></em></div>').join('') || '<p class="dim">No pending approvals.</p>') +
        (done.length ? '<h5>DECIDED</h5>' + done.map((a) => '<div class="earner"><b>#' + a.id + ' ' + esc(a.title) + '</b><span>' + esc(a.status) + (a.error ? ' · ' + esc(a.error) : '') + '</span><em>' + esc(String(a.actedAt || '').slice(0, 16)) + '</em></div>').join('') : '');
      box.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', () => {
        APU.api('/api/approval/act', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: +b.dataset.ap, action: b.dataset.apact === 'approve' ? 'approve' : 'reject' }) })
          .then((r) => { APU.emit('toast', r.status ? '#' + r.id + ' → ' + r.status : 'done'); loadInbox(); })
          .catch(() => APU.emit('toast', '⚠ service offline'));
      }));
      const chip = $('apInboxN'); if (chip) chip.textContent = pend.length ? ' (' + pend.length + ')' : '';
    }).catch(() => { box.innerHTML = '<p class="dim">Cannot reach the local service.</p>'; });
  }

  /* ---------------- device capabilities ---------------- */
  function loadCaps() {
    const box = $('apCaps'); if (!box) return;
    if (!APU.online) { box.textContent = 'Service offline — capabilities unknown.'; return; }
    APU.api('/api/capabilities').then((c) => {
      box.innerHTML = 'ffmpeg (needed for RTSP / V380 snapshots): <b class="' + (c.ffmpeg ? '' : 'lv-err') + '">' + (c.ffmpeg ? 'FOUND ✓' : 'not installed') + '</b>' +
        (c.ffmpeg ? '' : ' — run <code>winget install ffmpeg</code> in a terminal, then restart the service');
    }).catch(() => { box.textContent = 'Cannot reach the local service.'; });
  }

  /* ---------------- DEMO vs REAL overview ---------------- */
  function loadModes() {
    const box = $('apModes'); if (!box) return;
    if (!APU.online) { box.textContent = 'Service offline — start with start.bat to see live wiring.'; return; }
    APU.api('/api/modes').then((m) => {
      const bad = (v) => ['DEMO · synthetic prices', 'DEMO · paper portfolio', 'not connected', 'off', 'none'].indexOf(String(v)) > -1;
      const row = (k, v) => '<div class="earner"><b>' + k + '</b><span class="' + (bad(v) ? 'lv-err' : '') + '">' + esc(String(v)) + '</span></div>';
      box.innerHTML = row('MARKET', m.market) + row('BROKER', m.broker) + row('GMAIL', m.gmail) + row('DIGEST', m.digest) +
        row('ALERTS', m.notify) + row('CAMERAS', m.cameras + ' configured') + row('RTSP / ffmpeg', m.ffmpeg ? 'ready' : 'not installed') +
        row('REAL PAYOUTS', m.realPayouts + ' logged');
    }).catch(() => { box.textContent = 'Cannot reach the local service.'; });
  }

  /* ---------------- notifications & digest ---------------- */
  function loadNotifyCfg() {
    if (!APU.online) return;
    APU.api('/api/config').then((c) => {
      const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
      set('ntTgToken', (c.notify || {}).telegramToken); set('ntTgChat', (c.notify || {}).telegramChatId); set('ntWaPhone', (c.notify || {}).whatsappPhone); set('ntHook', (c.notify || {}).webhookUrl);
      set('ntDigestTo', (c.digest || {}).to); set('ntHour', (c.digest || {}).hour == null ? 21 : c.digest.hour); set('ntMin', (c.digest || {}).minute == null ? 0 : c.digest.minute);
      const cb = $('ntDigest'); if (cb) cb.checked = !!(c.digest && c.digest.enabled);
    }).catch(() => {});
  }

  function wire() {
    if (tab === 'log') {
      $('apSearch').addEventListener('input', (e) => { q = e.target.value; renderLog(); });
      $('apFollow').addEventListener('change', (e) => { follow = e.target.checked; });
      $('apClear').addEventListener('click', () => { APU.ring.length = 0; renderChips(); renderLog(); });
      $('apExport').addEventListener('click', exportLogs);
      body.querySelectorAll('.apc-chip').forEach((c) => c.addEventListener('click', () => { catFilter = c.dataset.c; renderChips(); renderLog(); }));
      body.querySelectorAll('.lg-cat').forEach(() => {});
    }
    if (tab === 'life') {
      body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
      body.querySelectorAll('[data-cfg]').forEach((r) => r.addEventListener('input', () => {
        const k = r.dataset.cfg, v = +r.value;
        if (!window.APLife) return;
        APLife.cfg[k] = (k === 'ageDaysPerYear' || k === 'securitySpend') ? v : v / 1000;
        APU.log({ category: 'CONFIG', level: 'info', event: 'CFG_CHANGED', detail: 'APLife.cfg.' + k + ' = ' + APLife.cfg[k] });
      }));
    }
    if (tab === 'config') {
      $('apSpeed').addEventListener('input', (e) => setSpeed(SPEEDS[+e.target.value]));
      $('apSave').addEventListener('click', () => APU.save(false));
      $('apLoad').addEventListener('click', () => APU.load().then((s) => { if (s) { APU.restore(s); APU.emit('toast', '◈ state loaded'); } else APU.emit('toast', 'nothing saved yet'); }));
      $('apReset').addEventListener('click', () => { if (confirm('Start a fresh city? Current state is saved first.')) { APU.save(true); location.reload(); } });
      $('apApply').addEventListener('click', applyConfig);
      $('apRevert').addEventListener('click', render);
      $('apBrokerRefresh').addEventListener('click', showBroker2);
      $('apLogInfo').addEventListener('click', () => {
        APU.log({ category: 'SYSTEM', level: 'info', event: 'LOG_LOCATION', detail: APU.health ? APU.health.logs : 'service offline — logs in browser storage' });
        APU.emit('toast', APU.health ? 'Logs: ' + APU.health.logs : 'Service offline');
      });
    }
    if (tab === 'devices') {
      const sc = $('apScan'); if (sc) sc.addEventListener('click', () => window.APWorld && APWorld.scan());
      const add = $('apAddCam');
      if (add) add.addEventListener('click', () => {
        const name = $('apCamName').value.trim(), url = $('apCamUrl').value.trim();
        if (!name || !url) return APU.emit('toast', '⚠ name and snapshot URL required');
        window.APWorld.addCamera({ id: name.toLowerCase().replace(/\W+/g, '-'), name, type: 'camera', snapshot: url });
        render();
      });
      const gb = $('apGoogleBtn'); if (gb) gb.addEventListener('click', () => window.APWorld && APWorld.googleConnect());
    }
    if (tab === 'inbox') { const rb = $('apInboxRefresh'); if (rb) rb.addEventListener('click', loadInbox); }
    if (tab === 'revenue') {
      const add = $('apIncAdd');
      if (add) add.addEventListener('click', () => {
        const platform = $('apIncPlatform').value.trim(), amount = $('apIncAmount').value, note = $('apIncNote').value.trim();
        if (!platform || !amount) return APU.emit('toast', '⚠ platform and amount required');
        APU.api('/api/income', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, amount, note }) })
          .then(() => { APU.emit('toast', '◈ payout recorded'); loadIncome(); }).catch(() => APU.emit('toast', '⚠ service offline'));
      });
    }
    if (tab === 'config') {
      const sv = $('ntSave');
      if (sv) sv.addEventListener('click', () => {
        const payload = { notify: { telegramChatId: $('ntTgChat').value.trim(), whatsappPhone: $('ntWaPhone').value.trim(), webhookUrl: $('ntHook').value.trim() },
          digest: { enabled: $('ntDigest').checked, to: $('ntDigestTo').value.trim(), hour: +$('ntHour').value || 0, minute: +$('ntMin').value || 0 } };
        const tok = $('ntTgToken').value.trim(); if (tok) payload.notify.telegramToken = tok;
        APU.api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(() => { APU.log({ category: 'CONFIG', level: 'warn', event: 'CONFIG_UPDATED', detail: 'notify/digest settings' }); APU.emit('toast', '✔ alerts & digest saved'); })
          .catch(() => APU.emit('toast', '⚠ service offline'));
      });
      const t1 = $('ntTest');
      if (t1) t1.addEventListener('click', () => {
        APU.api('/api/notify/test', { method: 'POST' }).then((r) => APU.emit('toast', r.ok ? '◈ test alert sent' : '⚠ ' + r.error))
          .catch(() => APU.emit('toast', '⚠ service offline'));
      });
      const t2 = $('ntDigestTest');
      if (t2) t2.addEventListener('click', () => {
        APU.api('/api/digest/test', { method: 'POST' }).then((r) => APU.emit('toast', r.ok ? '◈ test digest sent' : '⚠ ' + r.error))
          .catch(() => APU.emit('toast', '⚠ service offline'));
      });
    }
  }

  function act(kind) {
    const sel = AP.selected;
    const a = (sel && sel.kind === 'agent') ? sel.ref : null;
    if (kind === 'invest') {
      if (!a) return APU.emit('toast', '⚠ select an agent first');
      if (!a.portfolio) {
        a.portfolio = { cash: Math.round(Math.max(0, a.money * 0.4)), holdings: {}, trades: 0, pnl: 0 };
        a.money -= a.portfolio.cash;
        APU.logEvent('TRADING', 'info', a, 'ACCOUNT_OPENED', 'manual portfolio open', a.portfolio.cash);
        APU.emit('toast', '◈ ' + a.name + ' now investing');
      } else APU.emit('toast', a.name + ' already has a portfolio');
      return;
    }
    if (!a) return APU.emit('toast', '⚠ select an agent first');
    if (!window.APLife) return;
    if (kind === 'land') APLife.buyLand(a);
    if (kind === 'house') APLife.buildHouse(a);
    if (kind === 'biz') APLife.openBusiness(a);
  }

  function applyConfig() {
    try {
      const o = JSON.parse($('apCfg').value);
      if (o.life && window.APLife) Object.assign(APLife.cfg, o.life);
      if (o.revenue && window.APRevenue) Object.assign(APRevenue.cfg, o.revenue);
      APU.log({ category: 'CONFIG', level: 'warn', event: 'CONFIG_APPLIED', detail: 'live config replaced from editor' });
      APU.emit('toast', '✔ config applied live');
      render();
    } catch (e) { APU.emit('toast', '⚠ invalid JSON: ' + e.message); }
  }

  function exportLogs() {
    const txt = APU.ring.map((e) => JSON.stringify(e)).join('\n') || '{}';
    const blob = new Blob([txt], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'autopolis-log-day' + AP.simDay + '.jsonl';
    a.click();
    APU.emit('toast', '⬇ exported ' + APU.ring.length + ' events');
  }

  function setSpeed(v) {
    AP.speed = v;
    document.querySelectorAll('.ctl-btn.spd').forEach((b) => b.classList.toggle('active', +b.dataset.spd === v));
    APU.log({ category: 'SYSTEM', level: 'info', event: 'SPEED_CHANGED', detail: 'speed → ' + (v === 1 ? '1× REAL TIME' : v + '×') });
  }

  /* ---------------- console wiring ---------------- */
  node.querySelectorAll('.apc-tab').forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.t;
    node.querySelectorAll('.apc-tab').forEach((x) => x.classList.toggle('active', x === t));
    render();
  }));
  $('apCollapse').addEventListener('click', () => {
    const open = node.classList.toggle('closed');
    $('apCollapse').textContent = open ? '▴' : '▾';
  });

  APU.on('log', () => { if (tab === 'log') { renderChips(); renderLog(); } });
  APU.on('toast', (msg) => AP.pushFeed(String(msg), 'f-amber'));
  APU.on('online', (h) => {
    const c = $('apConn');
    c.textContent = h ? '◈ SERVICE ONLINE' : '◌ OFFLINE — file mode';
    c.classList.toggle('on', !!h);
  });
  APU.on('ready', () => { render(); setTimeout(render, 600); });

  /* keep the INBOX badge honest even when you are on another tab */
  setInterval(() => {
    if (!APU.online) return;
    APU.api('/api/approvals?status=pending').then((l) => { const c = $('apInboxN'); if (c) c.textContent = l.length ? ' (' + l.length + ')' : ''; }).catch(() => {});
  }, 30000);
  APU.on('github', () => { if (tab === 'github') render(); });
  APU.on('devices', () => { if (tab === 'devices') render(); });
  APU.on('revenue', () => { if (tab === 'revenue') render(); });
  APU.on('lifepass', () => { if (tab === 'life') render(); });

  /* status chip in the top bar */
  const conn = document.createElement('span');
  conn.className = 'ts conn-chip'; conn.id = 'connChip';
  conn.innerHTML = '<span>LINK</span><b id="connVal">…</b>';
  (document.getElementById('topstats') || document.body).appendChild(conn);
  APU.on('online', (h) => { $('connVal').textContent = h ? 'LIVE' : 'FILE'; $('connVal').className = h ? 'hot' : 'bad'; });

  render();
})();
