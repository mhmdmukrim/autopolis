#!/usr/bin/env node
/* ==================================================================
   AUTOPOLIS COMPANION SERVICE — zero dependencies
   ------------------------------------------------------------------
   Node built-ins only. No npm install. Run:  node server.js
   Then open http://127.0.0.1:8787/autopolis/index.html
   ------------------------------------------------------------------
   What this unlocks that a plain double-click page cannot:
     · real log files on YOUR disk (JSONL + CSV)
     · state persistence (city survives refresh / restart)
     · GitHub API proxy (your profile + 48 repos)
     · LAN device discovery (arp) + camera snapshot proxy
     · Gmail / Drive OAuth helper (you paste your own client id)
     · broker adapter (paper by default; live only if you supply it)
   ================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const LOGS = path.join(DATA, 'logs');
const PORT = Number(process.env.AP_PORT || 8787);
const HOST = '127.0.0.1';          // loopback only — never exposed to your LAN
const startedAt = Date.now();

for (const d of [DATA, LOGS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------
   0. tiny helpers
------------------------------------------------------------------ */
const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const readJSON = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

function mime(f) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' })[path.extname(f).toLowerCase()]
    || 'application/octet-stream';
}

function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length,
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(b);
}

function readBody(req, limit = 4e6) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/* ------------------------------------------------------------------
   1. CONFIG  (data/config.json) — everything editable at runtime
------------------------------------------------------------------ */
const CFG_PATH = path.join(DATA, 'config.json');
const DEFAULT_CFG = {
  city: { speed: 1, minPerTick: 1, tickMs: 1000, autoSave: true, saveEverySec: 30 },
  github: { username: 'mhmdmukrim', enabled: true },
  market: {
    source: 'auto',              // 'auto' (real CSE, synthetic fallback) | 'live' | 'synthetic'
    symbols: ['COMB.N0000', 'SLTL.N0000', 'NEST.N0000', 'LOLC.N0000', 'CTCL.N0000', 'HAYL.N0000',
      'VONE.N0000', 'CARG.N0000', 'SAMP.N0000', 'JKH.N0000', 'LFIN.N0000', 'TAFL.N0000']
  },
  digest: { enabled: false, hour: 21, minute: 0, to: '' },   // nightly email digest, your local time
  notify: {
    telegramToken: '', telegramChatId: '',   // free phone alerts + approval pings
    whatsappPhone: '',                        // unofficial free bridge via CallMeBot (one-time activation)
    webhookUrl: '',                           // generic webhook (n8n / IFTTT → WhatsApp bridges)
    minLevel: 'warn', cooldownSec: 5
  },
  broker: {
    mode: 'paper',                 // 'paper' | 'live'
    live: false,                   // MUST be explicitly true, plus endpoint+key
    endpoint: '',                  // your broker's order endpoint (you supply)
    apiKey: '',                    // your broker key (stored on YOUR disk only)
    accountId: '', paperCash: 100000
  },
  google: { clientId: '', clientSecret: '', redirectUri: 'http://127.0.0.1:8787/api/google/callback', scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly' },
  devices: {
    scan: true,
    cameras: [   // add your own — snapshot URLs an IP camera usually exposes
      // { id: 'front-door', name: 'Front Door Cam', type: 'camera', snapshot: 'http://192.168.1.20/snapshot.jpg' }
    ]
  },
  privacy: { logPersonalEvents: true, logDeviceEvents: true }
};
let cfg = Object.assign({}, DEFAULT_CFG, readJSON(CFG_PATH, {}));
cfg = { ...DEFAULT_CFG, ...cfg, city: { ...DEFAULT_CFG.city, ...cfg.city }, github: { ...DEFAULT_CFG.github, ...cfg.github },
  broker: { ...DEFAULT_CFG.broker, ...cfg.broker }, google: { ...DEFAULT_CFG.google, ...cfg.google },
  devices: { ...DEFAULT_CFG.devices, ...cfg.devices }, privacy: { ...DEFAULT_CFG.privacy, ...cfg.privacy },
  market: { ...DEFAULT_CFG.market, ...cfg.market }, digest: { ...DEFAULT_CFG.digest, ...cfg.digest },
  notify: { ...DEFAULT_CFG.notify, ...cfg.notify } };

/* ------------------------------------------------------------------
   2. PERSISTENCE  (data/state.json)
------------------------------------------------------------------ */
const STATE_PATH = path.join(DATA, 'state.json');

/* ------------------------------------------------------------------
   3. LOGGING — every event goes to disk, today's file, JSONL + CSV
------------------------------------------------------------------ */
const csvCols = ['ts', 'day', 'simTime', 'category', 'level', 'agentId', 'agent', 'event', 'detail', 'amount'];
let csvSeeded = new Set();

function logFilePath() { return path.join(LOGS, 'autopolis-' + today() + '.jsonl'); }
function csvFilePath() { return path.join(LOGS, 'autopolis-' + today() + '.csv'); }

function appendLog(entry) {
  const e = { ts: nowISO(), ...entry };
  try {
    fs.appendFileSync(logFilePath(), JSON.stringify(e) + '\n');
    const cf = csvFilePath();
    if (!csvSeeded.has(cf)) { fs.writeFileSync(cf, csvCols.join(',') + '\n'); csvSeeded.add(cf); }
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    fs.appendFileSync(cf, csvCols.map((c) => esc(e[c])).join(',') + '\n');
  } catch (err) { /* disk full etc — never crash the sim over a log line */ }
  broadcast('log', e);
  /* push important events to Telegram / webhook (cooldown prevents floods) */
  const minLvl = (cfg.notify && cfg.notify.minLevel) || 'warn';
  if (e.category !== 'CONFIG' && (e.level === 'error' || (e.level === 'warn' && minLvl === 'warn')))
    notifyOut('[' + e.category + '] ' + e.event + (e.detail ? ' — ' + String(e.detail).slice(0, 300) : ''));
}

/* fire-and-forget phone alerts: Telegram bot (free) and/or generic webhook */
let lastNotifyAt = 0;
function notifyOut(text) {
  const n = cfg.notify || {};
  const tg = n.telegramToken && n.telegramChatId, wa = !!n.whatsappPhone, hook = !!n.webhookUrl;
  if (!tg && !hook && !wa) return;
  if (Date.now() - lastNotifyAt < (n.cooldownSec || 5) * 1000) return;
  lastNotifyAt = Date.now();
  if (tg) fetchURL('https://api.telegram.org/bot' + n.telegramToken + '/sendMessage', { method: 'POST', timeout: 8000,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: n.telegramChatId, text: '◈ AUTOPOLIS\n' + text }) }).catch(() => {});
  /* WhatsApp via CallMeBot — free but unofficial; activate once by sending the bot a message */
  if (wa) fetchURL('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(n.whatsappPhone) + '&text=' + encodeURIComponent('◈ AUTOPOLIS\n' + text),
    { timeout: 8000 }).catch(() => {});
  if (hook) fetchURL(n.webhookUrl, { method: 'POST', timeout: 8000,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'autopolis', host: os.hostname(), ts: nowISO(), text }) }).catch(() => {});
}

/* ---- SSE live stream ---- */
const sseClients = new Set();
function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) { try { res.write(frame); } catch { sseClients.delete(res); } }
}
setInterval(() => { for (const res of sseClients) { try { res.write(': ping\n\n'); } catch { sseClients.delete(res); } } }, 20000);

/* ------------------------------------------------------------------
   4. HTTP FETCH helper (GitHub, cameras, broker)
------------------------------------------------------------------ */
function fetchURL(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let mod; try { mod = new URL(url).protocol === 'http:' ? require('http') : require('https'); } catch (e) { return reject(e); }
    const req = mod.request(url, { method: opts.method || 'GET', headers: opts.headers || {}, timeout: opts.timeout || 8000 }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ------------------------------------------------------------------
   5. GITHUB cache
------------------------------------------------------------------ */
let ghCache = { at: 0, profile: null, repos: null };
async function githubProfile() {
  if (ghCache.profile && Date.now() - ghCache.at < 300000) return ghCache.profile;
  const r = await fetchURL('https://api.github.com/users/' + encodeURIComponent(cfg.github.username),
    { headers: { 'User-Agent': 'autopolis-local', Accept: 'application/vnd.github+json' }, timeout: 12000 });
  ghCache.profile = JSON.parse(r.body.toString()); ghCache.at = Date.now();
  return ghCache.profile;
}
async function githubRepos() {
  if (ghCache.repos && Date.now() - ghCache.at < 300000) return ghCache.repos;
  const r = await fetchURL('https://api.github.com/users/' + encodeURIComponent(cfg.github.username) + '/repos?per_page=100&sort=updated',
    { headers: { 'User-Agent': 'autopolis-local', Accept: 'application/vnd.github+json' }, timeout: 12000 });
  ghCache.repos = JSON.parse(r.body.toString());
  return ghCache.repos;
}

/* ------------------------------------------------------------------
   6. LAN DISCOVERY — your own network, using the system ARP table.
      This only READS what Windows already knows about. No probing,
      no port scanning, no credential touching.
------------------------------------------------------------------ */
function arpScan() {
  return new Promise((resolve) => {
    execFile('arp', ['-a'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message), devices: [] });
      const nets = [];
      let cur = null;
      for (const line of String(stdout).split(/\r?\n/)) {
        const iface = line.match(/Interface:\s*(\d+\.\d+\.\d+\.\d+)/i);
        if (iface) { cur = { interface: iface[1], devices: [] }; nets.push(cur); continue; }
        const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}[-:][0-9a-f]{2}(?:[-:][0-9a-f]{2}){4})\s+(\w+)/i);
        if (m && cur) cur.devices.push({ ip: m[1], mac: m[2].toUpperCase(), type: m[3] });
      }
      resolve({ ok: true, host: os.hostname(), nets, scannedAt: nowISO() });
    });
  });
}

/* ------------------------------------------------------------------
   7. BROKER ADAPTER — paper by default, live only if you wire it.
------------------------------------------------------------------ */
const paper = { cash: cfg.broker.paperCash, positions: {}, trades: [] };
let marketCache = { at: 0, prices: {}, live: false, lastError: null };

/* real CSE feed (cse.lk public API — unofficial but live) with synthetic fallback */
function syntheticPrices(want) {
  const out = {};
  for (const s of want) {
    const prev = marketCache.prices[s] && marketCache.prices[s].price;
    const base = prev || 50 + Math.random() * 900;
    const price = Math.max(1, base * (1 + (Math.random() - 0.5) * 0.03));
    out[s] = { symbol: s, price: +price.toFixed(2), prev: +(base).toFixed(2), changePct: +(((price - base) / base) * 100).toFixed(2), source: 'synthetic' };
  }
  return out;
}
function watchlist() {
  return (cfg.market && cfg.market.symbols && cfg.market.symbols.length) ? cfg.market.symbols
    : ['COMB.N0000', 'SLTL.N0000', 'NEST.N0000', 'LOLC.N0000', 'CTCL.N0000', 'HAYL.N0000',
      'VONE.N0000', 'CARG.N0000', 'SAMP.N0000', 'JKH.N0000', 'LFIN.N0000', 'TAFL.N0000'];
}

async function marketPrices() {
  if (Date.now() - marketCache.at < 60000 && Object.keys(marketCache.prices).length) return marketCache.prices;
  const want = watchlist();
  const mode = (cfg.market && cfg.market.source) || 'auto';
  if (mode !== 'synthetic') {
    try {
      const r = await fetchURL('https://www.cse.lk/api/todaySharePrice', { method: 'POST', timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const rows = JSON.parse(r.body.toString());
      const bySym = {}; for (const row of rows) if (row && row.symbol) bySym[row.symbol] = row;
      /* when the market is closed the feed only lists stocks that traded
         today — fill the gaps from the per-symbol quote endpoint */
      const missing = want.filter((s) => !bySym[s] || !bySym[s].lastTradedPrice);
      await Promise.all(missing.map(async (s) => {
        try {
          const q = await fetchURL('https://www.cse.lk/api/companyInfoSummery', { method: 'POST', timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'symbol=' + encodeURIComponent(s) });
          const j = JSON.parse(q.body.toString());
          if (j && j.reqSymbolInfo && j.reqSymbolInfo.lastTradedPrice)
            bySym[s] = { symbol: s, lastTradedPrice: j.reqSymbolInfo.lastTradedPrice,
              change: j.reqSymbolInfo.change, changePercentage: j.reqSymbolInfo.changePercentage };
        } catch {}
      }));
      const out = {};
      for (const s of want) {
        const row = bySym[s]; if (!row || !row.lastTradedPrice) continue;
        out[s] = { symbol: s, price: +row.lastTradedPrice.toFixed(2),
          prev: +(row.lastTradedPrice - (row.change || 0)).toFixed(2),
          changePct: +(+row.changePercentage || 0).toFixed(2), source: 'live' };
      }
      if (!Object.keys(out).length) throw new Error('no watchlist symbols in feed');
      marketCache.prices = out; marketCache.at = Date.now(); marketCache.live = true; marketCache.lastError = null;
      return out;
    } catch (e) { marketCache.lastError = String(e.message || e); }
  }
  marketCache.live = false;
  marketCache.prices = syntheticPrices(want); marketCache.at = Date.now();
  return marketCache.prices;
}

async function placeOrder(o) {
  const live = cfg.broker.mode === 'live' && cfg.broker.live === true && cfg.broker.endpoint && cfg.broker.apiKey;
  if (!live) {
    const px = (await marketPrices())[o.symbol] || { price: 100 };
    const cost = px.price * o.qty;
    if (o.side === 'BUY') {
      if (paper.cash < cost) return { ok: false, mode: 'paper', error: 'Insufficient paper cash' };
      paper.cash -= cost; paper.positions[o.symbol] = (paper.positions[o.symbol] || 0) + o.qty;
    } else {
      const held = paper.positions[o.symbol] || 0;
      if (held < o.qty) return { ok: false, mode: 'paper', error: 'Not enough paper holdings' };
      paper.cash += cost; paper.positions[o.symbol] = held - o.qty;
    }
    const t = { ...o, price: px.price, at: nowISO(), mode: 'paper' };
    paper.trades.push(t);
    appendLog({ category: 'TRADING', level: 'info', event: 'ORDER_FILLED_PAPER', detail: `${o.side} ${o.qty} ${o.symbol} @ ${px.price}`, amount: cost, agentId: o.agentId, agent: o.agent });
    return { ok: true, mode: 'paper', fill: t, cash: paper.cash };
  }
  // LIVE — hits the endpoint YOU configured. Nothing else.
  try {
    const r = await fetchURL(cfg.broker.endpoint, { method: 'POST', timeout: 12000,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.broker.apiKey },
      body: JSON.stringify({ ...o, accountId: cfg.broker.accountId, ts: nowISO() }) });
    appendLog({ category: 'TRADING', level: 'warn', event: 'ORDER_SENT_LIVE', detail: `${o.side} ${o.qty} ${o.symbol} → HTTP ${r.status}`, agentId: o.agentId, agent: o.agent });
    return { ok: r.status < 400, mode: 'live', httpStatus: r.status, body: r.body.toString().slice(0, 800) };
  } catch (e) {
    appendLog({ category: 'TRADING', level: 'error', event: 'ORDER_FAILED', detail: String(e.message), agentId: o.agentId, agent: o.agent });
    return { ok: false, mode: 'live', error: String(e.message) };
  }
}

/* ------------------------------------------------------------------
   8. GOOGLE (Gmail / Drive) — OAuth helper.
      You paste your OWN Google Cloud client id+secret into config.
      This service never sees your password; Google does the login.
------------------------------------------------------------------ */
const oauthStates = new Set();
function googleAuthURL() {
  if (!cfg.google.clientId) return null;
  const st = crypto.randomBytes(16).toString('hex'); oauthStates.add(st);
  return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(cfg.google.clientId)
    + '&redirect_uri=' + encodeURIComponent(cfg.google.redirectUri)
    + '&response_type=code&access_type=offline&prompt=consent'
    + '&scope=' + encodeURIComponent(cfg.google.scope) + '&state=' + st;
}
async function googleExchange(code) {
  const body = new URLSearchParams({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret,
    redirect_uri: cfg.google.redirectUri, grant_type: 'authorization_code' }).toString();
  const r = await fetchURL('https://oauth2.googleapis.com/token', { method: 'POST', timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return JSON.parse(r.body.toString());
}
const tokenPath = path.join(DATA, 'google-tokens.json');   // on YOUR disk, gitignore it

/* refresh-aware access token + Gmail send (needs gmail.send scope granted) */
async function freshAccessToken() {
  const tok = readJSON(tokenPath, null);
  if (!tok) return null;
  if (!tok.expires_at || Date.now() < tok.expires_at - 60000) return tok.access_token;
  if (!tok.refresh_token || !cfg.google.clientId) return null;
  const body = new URLSearchParams({ refresh_token: tok.refresh_token, client_id: cfg.google.clientId,
    client_secret: cfg.google.clientSecret, grant_type: 'refresh_token' }).toString();
  try {
    const r = await fetchURL('https://oauth2.googleapis.com/token', { method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const t = JSON.parse(r.body.toString());
    if (!t.access_token) return null;
    tok.access_token = t.access_token; tok.expires_at = Date.now() + (t.expires_in || 3500) * 1000;
    writeJSON(tokenPath, tok);
    return tok.access_token;
  } catch { return null; }
}
async function gmailSend(to, subject, text) {
  const at = await freshAccessToken();
  if (!at) return { ok: false, error: 'Google not connected — connect it in the DEVICES tab first' };
  const msg = ['To: ' + to, 'Subject: ' + subject, 'Content-Type: text/plain; charset=utf-8', '', String(text || '')].join('\r\n');
  const raw = Buffer.from(msg, 'utf8').toString('base64url');
  try {
    const r = await fetchURL('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + at }, body: JSON.stringify({ raw }) });
    const out = JSON.parse(r.body.toString() || '{}');
    return r.status < 400 ? { ok: true, id: out.id } : { ok: false, error: 'HTTP ' + r.status + (out.error && out.error.message ? ' · ' + out.error.message : '') };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/* ------------------------------------------------------------------
   8b. REAL PAYOUTS · APPROVALS · DIGEST · V380/RTSP CAPABILITY
------------------------------------------------------------------ */
const INCOME_PATH = path.join(DATA, 'real-income.json');
const APPROVALS_PATH = path.join(DATA, 'approvals.json');
const DIGEST_STATE_PATH = path.join(DATA, 'digest.json');
let approvals = readJSON(APPROVALS_PATH, []);
let nextApprovalId = approvals.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1;
const saveApprovals = () => writeJSON(APPROVALS_PATH, approvals);

/* ffmpeg is optional — only needed for RTSP cameras (V380 Pro etc.) */
let ffmpegPath = null;
execFile(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { timeout: 5000, windowsHide: true },
  (e, so) => { if (!e && so) ffmpegPath = String(so).split(/\r?\n/)[0].trim() || null; });

/* nightly digest built from today's JSONL log */
function buildDigest() {
  const day = today(), rows = [];
  try {
    for (const line of fs.readFileSync(path.join(LOGS, 'autopolis-' + day + '.jsonl'), 'utf8').split('\n'))
      if (line) { try { rows.push(JSON.parse(line)); } catch {} }
  } catch {}
  const cat = {}; let earned = 0;
  const life = [], devices = [], errors = [];
  for (const e of rows) {
    cat[e.category] = (cat[e.category] || 0) + 1;
    if (typeof e.amount === 'number' && e.amount > 0 && ['FREELANCE', 'TRADING', 'MONEY', 'WORK'].indexOf(e.category) > -1) earned += e.amount;
    if (['MARRIED', 'PREGNANT', 'BIRTH', 'DIED'].indexOf(e.event) > -1) life.push((e.ts || '').slice(11, 16) + ' ' + e.event + ' — ' + (e.agent || '') + ' ' + (e.detail || ''));
    if (e.category === 'DEVICE') devices.push(e.event + ' — ' + (e.detail || ''));
    if (e.level === 'error') errors.push(e.event + ' — ' + (e.detail || ''));
  }
  const L = ['AUTOPOLIS DAILY DIGEST — ' + day, '',
    'Events logged: ' + rows.length + ' · money earned: ' + Math.round(earned) + ' (sim currency)', '',
    'By category: ' + Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ')];
  if (life.length) { L.push('', 'LIFE:'); life.slice(0, 15).forEach((x) => L.push(' · ' + x)); }
  if (devices.length) { L.push('', 'DEVICES:'); devices.slice(0, 10).forEach((x) => L.push(' · ' + x)); }
  if (errors.length) { L.push('', 'ERRORS:'); errors.slice(0, 10).forEach((x) => L.push(' · ' + x)); }
  return L.join('\n');
}
function digestTick() {
  const d = cfg.digest || {};
  if (!d.enabled) return;
  const now = new Date();
  if (now.getHours() !== +d.hour || now.getMinutes() !== +d.minute) return;
  const st = readJSON(DIGEST_STATE_PATH, {});
  if (st.last === today()) return;
  writeJSON(DIGEST_STATE_PATH, { last: today(), at: nowISO() });
  if (!d.to) return appendLog({ category: 'GOOGLE', level: 'warn', event: 'DIGEST_SKIPPED', detail: 'digest enabled but digest.to not set' });
  gmailSend(d.to, 'AUTOPOLIS digest ' + today(), buildDigest())
    .then((r) => appendLog({ category: 'GOOGLE', level: r.ok ? 'info' : 'error', event: r.ok ? 'DIGEST_SENT' : 'DIGEST_FAILED', detail: d.to + (r.error ? ' · ' + r.error : '') }))
    .catch((e) => appendLog({ category: 'GOOGLE', level: 'error', event: 'DIGEST_FAILED', detail: String(e.message || e) }));
}
setInterval(digestTick, 30000);

/* ------------------------------------------------------------------
   9. ROUTER
------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    return res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type' }).end();
  }

  try {
    /* ---- API ---- */
    if (p === '/api/health') return json(res, 200, { ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), host: os.hostname(), node: process.version, mode: cfg.broker.mode, logs: logFilePath() });

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('event: hello\ndata: {"ok":true}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (p === '/api/config' && req.method === 'GET') return json(res, 200, { ...cfg, broker: { ...cfg.broker, apiKey: cfg.broker.apiKey ? '••••' + cfg.broker.apiKey.slice(-4) : '', clientSecret: undefined, google: undefined },
      notify: { ...cfg.notify, telegramToken: cfg.notify.telegramToken ? '••••' + cfg.notify.telegramToken.slice(-4) : '' } });

    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (b.broker && b.broker.apiKey === '••••' + (cfg.broker.apiKey || '').slice(-4)) delete b.broker.apiKey;  // keep existing
      if (b.notify && b.notify.telegramToken === '••••' + (cfg.notify.telegramToken || '').slice(-4)) delete b.notify.telegramToken;
      const deep = (t, s) => { for (const k of Object.keys(s)) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) { t[k] = t[k] || {}; deep(t[k], s[k]); } else t[k] = s[k]; } };
      deep(cfg, b); writeJSON(CFG_PATH, cfg);
      appendLog({ category: 'CONFIG', level: 'warn', event: 'CONFIG_UPDATED', detail: Object.keys(b).join(', ') });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/state' && req.method === 'GET') return json(res, 200, readJSON(STATE_PATH, null));
    if (p === '/api/state' && req.method === 'PUT') { writeJSON(STATE_PATH, JSON.parse((await readBody(req)) || '{}')); return json(res, 200, { ok: true, savedAt: nowISO() }); }

    if (p === '/api/log' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      appendLog(b);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/logs/tail') return json(res, 200, tailLogs(Number(u.searchParams.get('n') || 200)));
    if (p === '/api/logs/download') return downloadLogs(res);

    if (p === '/api/github/profile') { try { return json(res, 200, await githubProfile()); } catch (e) { return json(res, 502, { error: String(e.message) }); } }
    if (p === '/api/github/repos') { try { return json(res, 200, await githubRepos()); } catch (e) { return json(res, 502, { error: String(e.message) }); } }

    if (p === '/api/devices/scan') { const s = await arpScan(); appendLog({ category: 'DEVICE', level: 'info', event: 'LAN_SCAN', detail: s.ok ? s.nets.reduce((n, x) => n + x.devices.length, 0) + ' devices known to ARP' : s.error }); return json(res, 200, s); }
    if (p === '/api/devices' && req.method === 'GET') return json(res, 200, readJSON(path.join(DATA, 'devices.json'), { cameras: cfg.devices.cameras || [] }));
    if (p === '/api/devices' && req.method === 'PUT') { const b = JSON.parse((await readBody(req)) || '{}'); writeJSON(path.join(DATA, 'devices.json'), b); return json(res, 200, { ok: true }); }
    if (p.startsWith('/api/devices/snapshot/')) {
      const id = decodeURIComponent(p.split('/').pop());
      const cam = (cfg.devices.cameras || []).find((c) => c.id === id);
      if (!cam) return json(res, 404, { error: 'camera not configured' });
      /* RTSP cameras (V380 Pro, Hikvision…) need ffmpeg to grab one frame */
      if (/^rtsp:\/\//i.test(cam.snapshot)) {
        if (!ffmpegPath) return json(res, 503, { error: 'RTSP camera needs ffmpeg on this PC (not found)',
          hint: 'Run "winget install ffmpeg", then in the V380 Pro app enable RTSP/ONVIF and use rtsp://user:pass@ip:554/live as the snapshot URL' });
        return execFile(ffmpegPath, ['-y', '-rtsp_transport', 'tcp', '-i', cam.snapshot, '-frames:v', '1',
          '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
          { timeout: 12000, windowsHide: true, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, buf) => {
            if (err) { appendLog({ category: 'DEVICE', level: 'error', event: 'CAM_SNAPSHOT_FAILED', detail: cam.id + ' · ' + err.message });
              return json(res, 502, { error: 'snapshot failed: ' + err.message }); }
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
            res.end(buf);
          });
      }
      try {
        const r = await fetchURL(cam.snapshot, { timeout: 6000 });
        res.writeHead(r.status, { 'Content-Type': r.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'no-store' });
        return res.end(r.body);
      } catch (e) { return json(res, 502, { error: 'unreachable: ' + e.message, hint: 'Most IP cams expose /snapshot.jpg or /cgi-bin/snapshot.cgi on your LAN. Camera login is yours — I do not bypass it.' }); }
    }

    /* generic LAN proxy for your own devices. Loopback-only server, and it
       refuses anything that is not a private-range http:// target. */
    if (p === '/api/proxy' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      let target = '';
      try { target = new URL(b.url); } catch { return json(res, 400, { error: 'bad url' }); }
      const okHost = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(target.hostname);
      if (target.protocol !== 'http:' || !okHost) return json(res, 403, { error: 'refused — private http targets only' });
      try {
        const r = await fetchURL(target.href, { method: req.method === 'POST' ? 'POST' : 'GET', timeout: 5000 });
        appendLog({ category: 'DEVICE', level: 'info', event: 'LAN_COMMAND', detail: target.hostname + target.pathname + ' → HTTP ' + r.status });
        return json(res, 200, { ok: r.status < 400, status: r.status, body: r.body.toString().slice(0, 400) });
      } catch (e) { return json(res, 502, { ok: false, error: String(e.message) }); }
    }

    if (p === '/api/market/prices') return json(res, 200, await marketPrices());
    if (p === '/api/market/status') {
      try {
        const r = await fetchURL('https://www.cse.lk/api/marketStatus', { method: 'POST', timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        return json(res, 200, { ...JSON.parse(r.body.toString()), source: 'cse.lk' });
      } catch (e) { return json(res, 200, { status: 'unknown', source: marketCache.live ? 'cse.lk (cached prices)' : 'offline — synthetic' }); }
    }
    if (p === '/api/broker/status') return json(res, 200, { mode: cfg.broker.mode, liveArmed: cfg.broker.mode === 'live' && cfg.broker.live && !!cfg.broker.endpoint && !!cfg.broker.apiKey, paper });
    if (p === '/api/broker/order' && req.method === 'POST') { const o = JSON.parse((await readBody(req)) || '{}'); if (!o.symbol || !o.side || !o.qty) return json(res, 400, { error: 'symbol, side, qty required' }); return json(res, 200, await placeOrder(o)); }

    if (p === '/api/google/status') return json(res, 200, { configured: !!cfg.google.clientId, tokens: fs.existsSync(tokenPath) });
    if (p === '/api/google/auth' && req.method === 'POST') { const url = googleAuthURL(); return url ? json(res, 200, { url }) : json(res, 400, { error: 'Set google.clientId + clientSecret in data/config.json first (Google Cloud Console → OAuth client, redirect URI ' + cfg.google.redirectUri + ')' }); }
    if (p === '/api/google/callback') {
      try {
        if (!oauthStates.has(u.searchParams.get('state'))) return json(res, 400, { error: 'bad state' });
        oauthStates.delete(u.searchParams.get('state'));
        const tok = await googleExchange(u.searchParams.get('code'));
        if (tok.expires_in) tok.expires_at = Date.now() + tok.expires_in * 1000;
        writeJSON(tokenPath, tok);
        appendLog({ category: 'GOOGLE', level: 'info', event: 'OAUTH_GRANTED', detail: 'Gmail/Drive token stored locally' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<meta charset=utf-8><body style="background:#04070f;color:#3dffa0;font:14px monospace;padding:40px">◈ Google connected. You can close this tab and return to AUTOPOLIS.</body>');
      } catch (e) { return json(res, 502, { error: String(e.message) }); }
    }

    if (p === '/api/google/send' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.to || !b.subject) return json(res, 400, { error: 'to and subject required' });
      const r = await gmailSend(b.to, b.subject, b.body || '');
      appendLog({ category: 'GOOGLE', level: r.ok ? 'info' : 'error', event: r.ok ? 'EMAIL_SENT' : 'EMAIL_FAILED', detail: b.to + ' · ' + b.subject + (r.error ? ' · ' + r.error : '') });
      return json(res, 200, r);
    }

    if (p === '/api/digest/test' && req.method === 'POST') {
      if (!cfg.digest.to) return json(res, 400, { error: 'set digest recipient email in CONFIG first' });
      const r = await gmailSend(cfg.digest.to, 'AUTOPOLIS digest (test)', buildDigest());
      appendLog({ category: 'GOOGLE', level: r.ok ? 'info' : 'error', event: r.ok ? 'DIGEST_SENT' : 'DIGEST_FAILED', detail: 'test · ' + cfg.digest.to + (r.error ? ' · ' + r.error : '') });
      return json(res, 200, r);
    }

    if (p === '/api/notify/test' && req.method === 'POST') {
      const n = cfg.notify || {};
      const tg = !!(n.telegramToken && n.telegramChatId), wa = !!n.whatsappPhone, hook = !!n.webhookUrl;
      if (!tg && !hook && !wa) return json(res, 400, { error: 'no channel configured — set Telegram, WhatsApp number or a webhook URL in CONFIG' });
      notifyOut('test alert — your AI city is wired to your phone ✓');
      return json(res, 200, { ok: true, telegram: tg, whatsapp: wa, webhook: hook });
    }

    if (p === '/api/modes') {
      await marketPrices().catch(() => null);
      return json(res, 200, {
        market: marketCache.live ? 'REAL · live CSE prices (cse.lk)' : 'DEMO · synthetic prices',
        broker: (cfg.broker.mode === 'live' && cfg.broker.live && cfg.broker.endpoint && cfg.broker.apiKey) ? 'LIVE — real orders to your broker' : 'DEMO · paper portfolio',
        gmail: fs.existsSync(tokenPath) ? 'CONNECTED' : 'not connected',
        digest: (cfg.digest && cfg.digest.enabled) ? ('ON · daily ' + String(cfg.digest.hour).padStart(2, '0') + ':' + String(cfg.digest.minute || 0).padStart(2, '0') + ' → ' + (cfg.digest.to || '(no recipient set)')) : 'off',
        notify: [(cfg.notify.telegramToken && cfg.notify.telegramChatId) ? 'telegram' : null, cfg.notify.whatsappPhone ? 'whatsapp' : null, cfg.notify.webhookUrl ? 'webhook' : null].filter(Boolean).join(' + ') || 'none',
        cameras: (cfg.devices.cameras || []).length,
        ffmpeg: !!ffmpegPath,
        realPayouts: readJSON(INCOME_PATH, []).length
      });
    }

    if (p === '/api/approvals' && req.method === 'GET') {
      const st = u.searchParams.get('status');
      return json(res, 200, st ? approvals.filter((a) => a.status === st) : approvals.slice(-50).reverse());
    }
    if (p === '/api/approvals' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const a = { id: nextApprovalId++, kind: b.kind || 'email', title: String(b.title || '(no title)').slice(0, 120),
        detail: String(b.detail || '').slice(0, 300), payload: b.payload || {}, status: 'pending', createdAt: nowISO() };
      approvals.push(a); saveApprovals();
      appendLog({ category: 'SYSTEM', level: 'warn', event: 'APPROVAL_REQUESTED', detail: a.kind + ' · ' + a.title });
      notifyOut('⏳ APPROVAL #' + a.id + ': ' + a.title + (a.detail ? '\n' + a.detail : ''));
      return json(res, 200, a);
    }
    if (p === '/api/approval/act' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const a = approvals.find((x) => x.id === +b.id);
      if (!a) return json(res, 404, { error: 'no such approval' });
      if (a.status !== 'pending') return json(res, 409, { error: 'already ' + a.status });
      a.actedAt = nowISO();
      if (b.action === 'approve') {
        appendLog({ category: 'SYSTEM', level: 'warn', event: 'APPROVAL_GRANTED', detail: a.kind + ' · ' + a.title });
        if (a.kind === 'email') {
          const r = await gmailSend(a.payload.to, a.payload.subject, a.payload.body || '');
          a.status = r.ok ? 'sent' : 'failed'; a.error = r.error;
          appendLog({ category: 'GOOGLE', level: r.ok ? 'info' : 'error', event: r.ok ? 'EMAIL_SENT' : 'EMAIL_FAILED', detail: (a.payload.to || '') + ' · ' + (a.payload.subject || '') + (r.error ? ' · ' + r.error : '') });
        } else a.status = 'approved';
      } else {
        a.status = 'rejected';
        appendLog({ category: 'SYSTEM', level: 'info', event: 'APPROVAL_REJECTED', detail: a.kind + ' · ' + a.title });
      }
      saveApprovals();
      return json(res, 200, a);
    }

    if (p === '/api/income' && req.method === 'GET') return json(res, 200, readJSON(INCOME_PATH, []));
    if (p === '/api/income' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const amt = +b.amount;
      if (!amt || !b.platform) return json(res, 400, { error: 'platform and amount required' });
      const list = readJSON(INCOME_PATH, []);
      const e = { id: Date.now(), platform: String(b.platform).slice(0, 40), amount: +amt.toFixed(2),
        currency: String(b.currency || 'LKR').slice(0, 8), note: String(b.note || '').slice(0, 140),
        date: b.date || today(), loggedAt: nowISO() };
      list.push(e); writeJSON(INCOME_PATH, list);
      appendLog({ category: 'FREELANCE', level: 'info', event: 'REAL_PAYOUT', detail: e.platform + ' · ' + e.currency + (e.note ? ' · ' + e.note : ''), amount: e.amount });
      return json(res, 200, e);
    }
    if (p.startsWith('/api/income/') && req.method === 'DELETE') {
      const id = +p.split('/').pop();
      writeJSON(INCOME_PATH, readJSON(INCOME_PATH, []).filter((x) => x.id !== id));
      appendLog({ category: 'FREELANCE', level: 'warn', event: 'REAL_PAYOUT_REMOVED', detail: 'entry #' + id });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/capabilities') return json(res, 200, { ffmpeg: !!ffmpegPath, ffmpegPath: ffmpegPath || null, node: process.version, platform: process.platform });

    /* ---- static ---- */
    let f = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }

    const raw = fs.readFileSync(f);
    if (/\.(js|css|html|json|svg)$/.test(f) && (req.headers['accept-encoding'] || '').includes('gzip')) {
      const g = zlib.gzipSync(raw);
      res.writeHead(200, { 'Content-Type': mime(f), 'Content-Length': g.length, 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' });
      return res.end(g);
    }
    res.writeHead(200, { 'Content-Type': mime(f), 'Content-Length': raw.length, 'Cache-Control': 'no-cache' });
    return res.end(raw);
  } catch (e) {
    appendLog({ category: 'SYSTEM', level: 'error', event: 'REQUEST_FAILED', detail: p + ' :: ' + e.message });
    return json(res, 500, { error: String(e.message) });
  }
});

/* ---- log tail + zip download ---- */
function tailLogs(n) {
  try {
    const txt = fs.readFileSync(logFilePath(), 'utf8').trim().split('\n');
    return txt.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function downloadLogs(res) {
  try {
    const files = fs.readdirSync(LOGS).filter((f) => f.endsWith('.jsonl') || f.endsWith('.csv'));
    const pack = files.map((f) => ({ file: f, kb: Math.round(fs.statSync(path.join(LOGS, f)).size / 1024) }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ dir: LOGS, files: pack }, null, 2));
  } catch (e) { return json(res, 500, { error: String(e.message) }); }
}

server.listen(PORT, HOST, () => {
  const line = `◈ AUTOPOLIS SERVICE online → http://${HOST}:${PORT}/autopolis/index.html`;
  console.log(line);
  console.log(`  logs   : ${LOGS}`);
  console.log(`  broker : ${cfg.broker.mode} (live armed: ${cfg.broker.mode === 'live' && cfg.broker.live})`);
  appendLog({ category: 'SYSTEM', level: 'info', event: 'SERVICE_START', detail: 'node ' + process.version + ' on ' + os.hostname() });
});
process.on('SIGINT', () => { appendLog({ category: 'SYSTEM', level: 'info', event: 'SERVICE_STOP', detail: 'graceful' }); process.exit(0); });
