/* ================================================================
   AUTOPOLIS — AI Cyber City :: emergent multi-agent simulation
   Vanilla JS. No frameworks, no build step.
   ----------------------------------------------------------------
   · Agents hold jobs in the MAIN TOWER, study + graduate at THE
     INSTITUTE, eat at the NEON CAFE, rest at home, relax in the park.
   · Money flows: work -> wages -> tax -> treasury -> education.
   · Nothing is scripted: employment, prices, migration and crises
     all EMERGE from the rules + your policy sliders.
   ================================================================ */
(function () {
'use strict';

/* ----------------------------------------------------------------
   0. HELPERS
---------------------------------------------------------------- */
const el = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = (n) => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('en-US');

/* ----------------------------------------------------------------
   1. CONFIG
---------------------------------------------------------------- */
const GRID = 18;
const BASE_TW = 64, BASE_TH = 32;

let MIN_PER_TICK = 1;        // v2: city-minutes per tick
let TICK_MS = 60000;         // v2: at 1x → 1 sim minute == 1 REAL minute
const DAY_MIN = 1440;

const WORK_START = 6.5, WORK_END = 20, NIGHT = 21, DAWN = 6;

const EDU_NAMES = ['No Formal', 'School · A/L', 'Diploma / Cert', 'Degree · HND', 'Postgraduate'];
const EDU_NEED = [80, 100, 130, 170];   // xp to advance from level i -> i+1

const TIERS = [
  { name: 'Intern',    req: 0, pay: 55,  slots: 4, color: '#8ad7ff' },
  { name: 'Staff',     req: 1, pay: 80,  slots: 4, color: '#25e6ff' },
  { name: 'Analyst',   req: 2, pay: 120, slots: 3, color: '#3dffa0' },
  { name: 'Manager',   req: 3, pay: 175, slots: 3, color: '#ffb545' },
  { name: 'Executive', req: 4, pay: 270, slots: 1, color: '#ff3df0' }
];
const TOTAL_SLOTS = TIERS.reduce((s, t) => s + t.slots, 0);

const WORK_SESSION  = 300;   // 5h shift
const STUDY_SESSION = 200;   // ~3.3h lecture
const SLEEP_SESSION = 420;   // 7h
const PARK_SESSION  = [50, 150];
const EAT_SESSION   = 45;

const MEAL_COST = 10, MEAL_GAIN = 78, RENT = 6, TUITION = 20;
const STUDY_XP = 58;
const WAGE_SHARE = 0.7, TAX_BASE = 0.12, CORP_TAX = 0.35;
const UPKEEP_PER_BUILDING = 2.5;

const HOME_CAP = 3;
const FESTIVAL_COST = 220, HOME_COST = 260;
const INSTITUTE_SEATS = 6;
const START_POP = 12;
const MAX_POP = 46;
const MOVE_SPEED = 0.095;    // tiles per city-minute

/* ----------------------------------------------------------------
   2. WORLD / BUILDINGS
---------------------------------------------------------------- */
let buildings = [];
let homes = [];
let tower, institute, cafe, park;

const BUILD_SPOTS = [
  { x: 4, y: 14, w: 2, h: 2 }, { x: 13, y: 3, w: 2, h: 2 },
  { x: 15, y: 6, w: 2, h: 2 }, { x: 1, y: 4, w: 2, h: 2 },
  { x: 10, y: 3, w: 2, h: 2 }, { x: 2, y: 7, w: 1, h: 2 }
];
let buildSpotIdx = 0, homeSeq = 0;

function mkBuilding(def) {
  const b = Object.assign({
    id: 'B' + (buildings.length + 1), walkable: false, residents: 0, door: null
  }, def);
  buildings.push(b);
  return b;
}

function setupWorld() {
  buildings = []; homes = []; buildSpotIdx = 0; homeSeq = 0;

  tower     = mkBuilding({ type: 'TOWER',     name: 'MAIN TOWER',   x: 7,  y: 6,  w: 4, h: 4, hh: 172, color: '#25e6ff' });
  institute = mkBuilding({ type: 'INSTITUTE', name: 'THE INSTITUTE',x: 2,  y: 6,  w: 3, h: 3, hh: 120, color: '#ff3df0' });
  cafe      = mkBuilding({ type: 'CAFE',      name: 'NEON CAFE',    x: 13, y: 7,  w: 2, h: 2, hh: 58,  color: '#ffb545' });
  park      = mkBuilding({ type: 'PARK',      name: 'CIRCUIT PARK', x: 6,  y: 13, w: 5, h: 3, hh: 0,   color: '#3dffa0', walkable: true });

  const homesDef = [
    [1, 1], [4, 1], [11, 1], [14, 1], [1, 10], [13, 12]
  ];
  for (const [x, y] of homesDef) {
    const h = mkBuilding({ type: 'HOME', name: 'HAB-' + String(++homeSeq).padStart(2, '0'), x, y, w: 2, h: 2, hh: 46, color: '#8b7dff' });
    homes.push(h);
  }
}

/* -------- walkability grid -------- */
let blocked = new Uint8Array(GRID * GRID);
const inB = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;
const walk = (x, y) => inB(x, y) && blocked[y * GRID + x] === 0;

function rebuildBlocked() {
  blocked = new Uint8Array(GRID * GRID);
  for (const b of buildings) {
    if (b.walkable) continue;
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++)
        if (inB(x, y)) blocked[y * GRID + x] = 1;
  }
  for (const b of buildings) { b.door = computeDoor(b); b.spots = null; }
}

/* gathering tiles around a building so residents fan out instead of stacking */
function buildingSpots(b) {
  if (b.spots) return b.spots;
  const s = [];
  const south = b.y + b.h;
  for (let x = b.x - 1; x <= b.x + b.w; x++) if (walk(x, south)) s.push({ x, y: south });
  const south2 = b.y + b.h + 1;
  for (let x = b.x; x < b.x + b.w; x++) if (walk(x, south2)) s.push({ x, y: south2 });
  for (let y = b.y; y < b.y + b.h; y++) {
    if (walk(b.x - 1, y)) s.push({ x: b.x - 1, y });
    if (walk(b.x + b.w, y)) s.push({ x: b.x + b.w, y });
  }
  b.spots = s.length ? s : (b.door ? [b.door] : []);
  return b.spots;
}

function chooseSpot(b, a) {
  const spots = buildingSpots(b);
  if (!spots.length) return b.door;
  let best = spots[0], bestN = Infinity;
  const bias = a.id % spots.length;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    let n = 0;
    for (const o of agents) {
      if (o === a) continue;
      if (o.state === 'MOVE' && o.path && o.path.length) {
        const d = o.path[o.path.length - 1];
        if (d.x === s.x && d.y === s.y) n++;
      } else if (o.state !== 'MOVE' && Math.round(o.x) === s.x && Math.round(o.y) === s.y) {
        n++;
      }
    }
    if (i === bias) n -= 0.5;
    if (n < bestN) { bestN = n; best = s; }
  }
  return best;
}

function computeDoor(b) {
  if (b.walkable) return null;
  const cx = b.x + Math.floor(b.w / 2);
  const cy = b.y + b.h;
  const cands = [[cx, cy], [cx, cy + 1], [b.x - 1, b.y + Math.floor(b.h / 2)], [b.x + b.w, b.y + Math.floor(b.h / 2)], [cx, b.y - 1]];
  for (const [x, y] of cands) if (walk(x, y)) return { x, y };
  for (let r = 1; r < 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (walk(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
  return { x: clamp(cx, 0, GRID - 1), y: clamp(cy, 0, GRID - 1) };
}

/* -------- A* pathfinding (8-dir, no corner cutting) -------- */
function findPath(sx, sy, gx, gy) {
  sx = Math.round(sx); sy = Math.round(sy);
  gx = Math.round(gx); gy = Math.round(gy);
  if (sx === gx && sy === gy) return [];
  if (!walk(gx, gy)) return null;
  const idx = (x, y) => y * GRID + x;
  const start = idx(sx, sy), goal = idx(gx, gy);
  const open = [{ x: sx, y: sy, g: 0, f: 0 }];
  const came = new Map(), gScore = new Map([[start, 0]]);
  const closed = new Set();
  const H = (x, y) => Math.hypot(x - gx, y - gy);

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ci = idx(cur.x, cur.y);
    if (ci === goal) {
      const seq = [];
      let c = goal;
      while (c !== start) { seq.push({ x: c % GRID, y: (c / GRID) | 0 }); c = came.get(c); if (c === undefined) return null; }
      seq.push({ x: sx, y: sy });
      seq.reverse();
      return seq.slice(1);
    }
    if (closed.has(ci)) continue;
    closed.add(ci);

    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!walk(nx, ny)) continue;
      if (dx && dy && (!walk(cur.x + dx, cur.y) || !walk(cur.x, cur.y + dy))) continue;
      const ni = idx(nx, ny);
      if (closed.has(ni)) continue;
      const ng = cur.g + (dx && dy ? 1.4142 : 1);
      if (ng < (gScore.has(ni) ? gScore.get(ni) : Infinity)) {
        gScore.set(ni, ng); came.set(ni, ci);
        const f = ng + H(nx, ny);
        const ex = open.find(o => o.x === nx && o.y === ny);
        if (ex) { ex.g = ng; ex.f = f; } else open.push({ x: nx, y: ny, g: ng, f });
      }
    }
  }
  return null;
}

/* ----------------------------------------------------------------
   3. AGENTS
---------------------------------------------------------------- */
const FIRST = ['Nimal','Chamika','Amaya','Ravi','Tharushi','Faisal','Ishara','Dilan','Nuwan','Zara','Kasun','Maya','Sahan','Riya','Anura','Yuki','Farhan','Sasha','Praveen','Inuka','Hashan','Tara','Rehan','Dewmi','Arjun','Nadia','Chanakya','Sadeera','Milan','Ayesha'];
const LASTNAMES = ['Perera','Silva','Fernando','Mohamed','Rahman','Kumara','Jayasuriya','Bandara','Nimal','Ocha','Tanaka','Chen','Ranasinghe','Iqbal','Hassan','De Silva','Wickrama','Fathima','Gunawardena','Senanayake'];

const STATE_COLOR = {
  MOVE: '#25e6ff', WORK: '#ffb545', STUDY: '#ff3df0',
  EAT: '#ffd166', PARK: '#3dffa0', SLEEP: '#8b7dff', IDLE: '#9db0cc'
};
const STATE_BADGE = {
  MOVE: ['badge-move', 'TRAVELLING'], WORK: ['badge-work', 'WORKING'],
  STUDY: ['badge-study', 'IN CLASS'], EAT: ['badge-fun', 'EATING'],
  PARK: ['badge-fun', 'AT THE PARK'], SLEEP: ['badge-rest', 'SLEEPING'], IDLE: ['badge-idle', 'IDLE']
};

let agents = [];
let nextId = 1;

function makeAgent(home) {
  const r = Math.random();
  let edu = r < 0.5 ? 0 : r < 0.8 ? 1 : r < 0.95 ? 2 : 3;
  const spawn = home ? { x: home.door.x, y: home.door.y } : randomWalkable();
  return {
    id: nextId++,
    name: pick(FIRST) + ' ' + pick(LASTNAMES),
    x: spawn.x, y: spawn.y, dx: spawn.x, dy: spawn.y,
    path: null, pathI: 0, goal: null,
    state: 'IDLE', activityMin: 0, waitMin: rand(0, 60),
    money: randi(30, 95), energy: rand(80, 100), hunger: rand(70, 100),
    happiness: rand(52, 76), edu, eduXp: randi(0, 40),
    job: null, underemployed: false, perf: 0.5,
    workedToday: false, studiedToday: false, sponsored: false,
    home, homeless: !home, sx: 0, sy: 0, born: simDay,
    /* rendering spread so co-located agents don't stack into one dot */
    spdF: 0.86 + Math.random() * 0.28,
    stagA: Math.random() * 6.2832,
    stagR: 3 + Math.random() * 5
  };
}

function randomWalkable() {
  for (let i = 0; i < 200; i++) {
    const x = randi(0, GRID - 1), y = randi(0, GRID - 1);
    if (walk(x, y)) return { x, y };
  }
  return { x: 1, y: 0 };
}

function homeOccupancy(h) { let n = 0; for (const a of agents) if (a.home === h) n++; return n; }
function housingCap() { return homes.length * HOME_CAP; }

function assignHome(a) {
  for (const h of homes) if (homeOccupancy(h) < HOME_CAP) { a.home = h; a.homeless = false; return true; }
  a.home = null; a.homeless = true; return false;
}

function spawnAgents(n, kind) {
  let added = 0;
  for (let i = 0; i < n; i++) {
    if (agents.length >= MAX_POP) break;
    const home = homes.length ? pickHomesWithSpace() : null;
    if (!home && kind === 'migrant') continue;   // migrants need housing
    const a = makeAgent(home);
    if (!home) a.happiness = clamp(a.happiness - 12, 0, 100);
    agents.push(a);
    added++;
  }
  if (added) { hireAll(); }
  return added;
}
function pickHomesWithSpace() {
  const free = homes.filter(h => homeOccupancy(h) < HOME_CAP);
  return free.length ? pick(free) : null;
}

/* -------- jobs -------- */
function tryJob(a) {
  if (a.job) return false;
  for (let t = TIERS.length - 1; t >= 0; t--) {
    if (a.edu >= TIERS[t].req && tower.slots[t] > 0) {
      tower.slots[t]--; a.job = { tier: t }; a.underemployed = false;
      return true;
    }
  }
  return false;
}
function tryUpgrade(a) {
  if (!a.job) return tryJob(a);
  for (let t = TIERS.length - 1; t > a.job.tier; t--) {
    if (a.edu >= TIERS[t].req && tower.slots[t] > 0) {
      tower.slots[a.job.tier]++; tower.slots[t]--; a.job = { tier: t };
      a.underemployed = false;
      return true;
    }
  }
  return false;
}
function refreshUnderemployed(a) {
  a.underemployed = !!a.job && a.edu > TIERS[a.job.tier].req;
}
function hireAll() {
  const jobless = shuffle(agents.filter(a => !a.job));
  let got = 0;
  for (const a of jobless) if (tryJob(a)) got++;
  if (got) pushFeed('Morning hiring: <b>' + got + '</b> resident(s) placed at the Main Tower', 'f-green');
}
function promotePass() {
  for (let t = TIERS.length - 1; t >= 1; t--) {
    let guard = 0;
    while (tower.slots[t] > 0 && guard++ < 50) {
      let best = null;
      for (const a of agents) {
        if (a.job && a.job.tier < t && a.edu >= TIERS[t].req) {
          if (!best || a.edu > best.edu || (a.edu === best.edu && a.perf > best.perf)) best = a;
        }
      }
      if (!best) break;
      tower.slots[best.job.tier]++; tower.slots[t]--;
      best.job = { tier: t };
      pushFeed('⬆ ' + best.name + ' promoted to <b>' + TIERS[t].name + '</b>', 'f-green');
    }
  }
}
function freeJob(a) { if (a.job) { tower.slots[a.job.tier]++; a.job = null; } }

/* ----------------------------------------------------------------
   4. STATE
---------------------------------------------------------------- */
let simMin = DAWN * 60;      // start at 06:00
let simDay = 1;
let running = true, speed = 1;
let taxRate = TAX_BASE, eduBudget = 0.30;
let treasury = 850, gdp = 0, dayOutput = 0, graduatesTotal = 0, sponsorQuota = 0;
let happinessAvg = 60;
let selected = null;         // {kind:'agent'|'building', ref}
let festivalMin = 0;

const hour = () => (simMin % DAY_MIN) / 60;
const dayNo = () => Math.floor(simMin / DAY_MIN) + 1;

/* ----------------------------------------------------------------
   5. FEED / LOG
---------------------------------------------------------------- */
const feedEl = el('feed');
let feedCount = 0;
function pushFeed(html, cls) {
  if (!feedEl) return;
  const li = document.createElement('li');
  if (cls) li.className = cls;
  const t = Math.floor(hour());
  const stamp = String(t).padStart(2, '0') + ':' + String(Math.floor((simMin % 60))).padStart(2, '0');
  li.innerHTML = '<em>' + stamp + '</em> · ' + html;
  feedEl.prepend(li);
  feedCount++;
  while (feedEl.children.length > 45) feedEl.removeChild(feedEl.lastChild);
  if (window.AP && AP.onFeed) { try { AP.onFeed(li.textContent, cls); } catch (e) {} }
}

/* ----------------------------------------------------------------
   6. NEEDS / DAILY ECONOMY
---------------------------------------------------------------- */
function studyingNow() {
  let n = 0;
  for (const a of agents) if (a.state === 'STUDY' || (a.state === 'MOVE' && a.goal && a.goal.act === 'STUDY')) n++;
  return n;
}
function canStudy(a) {
  if (a.edu >= 4 || a.studiedToday) return false;
  if (studyingNow() >= INSTITUTE_SEATS) return false;
  return a.sponsored || a.money >= TUITION;
}
function wantsStudy(a) {
  if (a.edu >= 4) return false;
  if (!a.job) return true;
  return a.underemployed || chance(0.35);
}

function assignSponsors() {
  for (const a of agents) a.sponsored = false;
  const cand = agents
    .filter(a => a.edu < 4 && (!a.job || a.underemployed))
    .sort((x, y) => (x.job ? 1 : 0) - (y.job ? 1 : 0) || x.money - y.money);
  let n = sponsorQuota;
  for (const a of cand) { if (n <= 0) break; a.sponsored = true; n--; }
}

function dailyEconomy() {
  /* rent -> treasury, housing stress */
  let housed = 0;
  for (const a of agents) {
    if (a.home) {
      treasury += RENT;
      if (a.money >= RENT) a.money -= RENT;
      else { a.money = 0; a.happiness = clamp(a.happiness - 9, 0, 100); }
      housed++;
    } else {
      a.happiness = clamp(a.happiness - 16, 0, 100);
    }
  }

  /* upkeep */
  treasury -= buildings.length * UPKEEP_PER_BUILDING;

  /* education budget drains treasury and funds scholarships */
  const eduSpend = Math.max(0, treasury) * eduBudget;
  treasury -= eduSpend;
  sponsorQuota = Math.floor(eduSpend / TUITION);
  assignSponsors();

  /* macro indicators */
  gdp = dayOutput; dayOutput = 0;

  /* happiness average */
  happinessAvg = agents.length ? agents.reduce((s, a) => s + a.happiness, 0) / agents.length : 0;

  /* summary log */
  pushFeed('Day ' + (simDay - 1) + ' closed — GDP <b>' + fmt(gdp) + '</b> · treasury <b>' + fmt(treasury) + '</b> · happiness <b>' + Math.round(happinessAvg) + '%</b>',
    treasury < 0 ? 'f-bad' : 'f-mag');

  migration(housed);
}

function migration(housed) {
  const cap = housingCap();
  const vacancy = cap - agents.length;
  const jobless = agents.filter(a => !a.job).length;
  const unemp = agents.length ? jobless / agents.length : 0;

  /* crisis emigration */
  if (agents.length > 6 && (happinessAvg < 26 || treasury < -250)) {
    if (chance(0.5)) {
      const worst = agents.slice().sort((a, b) => a.happiness - b.happiness)[0];
      evict(worst, 'left Autopolis — morale collapsed');
    }
    return;
  }

  /* prosperity immigration */
  if (vacancy > 0 && happinessAvg > 50 && unemp < 0.22 && treasury > 0 && agents.length < MAX_POP) {
    const p = 0.55 * (happinessAvg / 100) * (1 - unemp) * clamp(treasury / 300, 0, 1);
    if (chance(p)) {
      const added = spawnAgents(randi(1, 2), 'migrant');
      if (added) pushFeed('➕ ' + added + ' new resident(s) moved into Autopolis', 'f-green');
      return;
    }
  }
  if (vacancy <= 0 && chance(0.34)) pushFeed('⚠ Housing crisis — no free homes, growth stalled', 'f-bad');
}

function evict(a, reason) {
  freeJob(a);
  agents = agents.filter(x => x !== a);
  if (selected && selected.kind === 'agent' && selected.ref === a) selected = null;
  pushFeed('⌂ ' + a.name + ' ' + reason, 'f-bad');
}

/* ----------------------------------------------------------------
   7. AGENT BEHAVIOUR
---------------------------------------------------------------- */
function idle(a, mins) { a.state = 'IDLE'; a.goal = null; a.path = null; a.waitMin = mins; }

function goTo(a, bld, act, tile) {
  const dest = tile || (bld.walkable ? { x: randi(bld.x, bld.x + bld.w - 1), y: randi(bld.y, bld.y + bld.h - 1) } : chooseSpot(bld, a));
  a.goal = { act, bld };
  const p = findPath(a.x, a.y, dest.x, dest.y);
  if (p === null) { a.goal = null; idle(a, 60); return false; }
  if (p.length === 0) { arrive(a); return true; }
  a.path = p; a.pathI = 0; a.state = 'MOVE';
  return true;
}

function sleepInPlace(a, mins) {
  a.state = 'SLEEP'; a.goal = null; a.path = null; a.activityMin = mins;
}

function decide(a) {
  const h = hour();

  /* --- night: everyone sleeps --- */
  if (h >= NIGHT || h < DAWN) {
    if (a.home) goTo(a, a.home, 'SLEEP');
    else sleepInPlace(a, 360);
    a.waitMin = 90;
    return;
  }

  /* --- exhausted --- */
  if (a.energy < 18) {
    if (a.home) goTo(a, a.home, 'SLEEP');
    else sleepInPlace(a, 300);
    a.waitMin = 90;
    return;
  }

  /* --- hungry --- */
  if (a.hunger < 38) {
    if (a.money >= MEAL_COST) { goTo(a, cafe, 'EAT'); a.waitMin = 90; return; }
    a.happiness = clamp(a.happiness - 0.6, 0, 100);
    idle(a, 120);
    return;
  }

  /* --- structured daytime --- */
  if (h >= WORK_START && h < WORK_END) {
    if (a.job && !a.workedToday) { goTo(a, tower, 'WORK'); a.waitMin = 90; return; }
    if (!a.job && !a.studiedToday && wantsStudy(a) && canStudy(a)) { goTo(a, institute, 'STUDY'); a.waitMin = 90; return; }
    if (a.job && a.underemployed && !a.studiedToday && canStudy(a)) { goTo(a, institute, 'STUDY'); a.waitMin = 90; return; }
  }

  /* --- free time --- */
  if (a.happiness < 62) { goTo(a, park, 'PARK'); a.waitMin = 90; return; }

  if (a.home && chance(0.6)) goTo(a, a.home, 'IDLE');
  else goTo(a, park, 'PARK');
  a.waitMin = 90;
}

function arrive(a) {
  const g = a.goal;
  a.path = null;
  if (!g) { idle(a, 30); return; }
  switch (g.act) {
    case 'WORK':  a.state = 'WORK';  a.activityMin = WORK_SESSION; break;
    case 'STUDY':
      if (!a.sponsored) a.money = Math.max(0, a.money - TUITION);
      a.state = 'STUDY'; a.activityMin = STUDY_SESSION; break;
    case 'EAT':
      a.money = Math.max(0, a.money - MEAL_COST);
      a.state = 'EAT'; a.activityMin = EAT_SESSION; break;
    case 'SLEEP': a.state = 'SLEEP'; a.activityMin = SLEEP_SESSION; break;
    case 'PARK':  a.state = 'PARK';  a.activityMin = randi(PARK_SESSION[0], PARK_SESSION[1]); break;
    default:      a.state = 'IDLE';  a.waitMin = 40; break;
  }
  if (g.act !== 'IDLE') a.goal = g; else a.goal = null;
}

function finishWork(a) {
  const tier = TIERS[a.job.tier];
  const outF = (0.6 + 0.4 * (a.energy / 100)) * (0.65 + 0.35 * (a.happiness / 100));
  const output = tier.pay * outF;
  const wage = output * WAGE_SHARE;
  const incomeTax = wage * taxRate;
  a.money += wage - incomeTax;
  treasury += incomeTax + (output - wage) * CORP_TAX;
  dayOutput += output;
  a.perf = a.perf * 0.7 + outF * 0.3;
  a.workedToday = true;
  if (window.AP && AP.log) AP.log({ day: simDay, category: 'WORK', level: 'info', agentId: a.id, agent: a.name,
    event: 'SHIFT_COMPLETE', detail: TIERS[a.job.tier].name + ' · output ' + Math.round(output), amount: +wage.toFixed(2) });
  idle(a, 0);
}

function finishStudy(a) {
  a.studiedToday = true;
  a.eduXp += STUDY_XP;
  if (a.edu < 4 && a.eduXp >= EDU_NEED[a.edu]) {
    a.eduXp = 0; a.edu++; graduatesTotal++;
    a.happiness = clamp(a.happiness + 10, 0, 100);
    pushFeed('🎓 ' + a.name + ' graduated from The Institute → <b>' + EDU_NAMES[a.edu] + '</b>', 'f-mag');
    if (window.AP && AP.log) AP.log({ day: simDay, category: 'EDUCATION', level: 'info', agentId: a.id, agent: a.name,
      event: 'GRADUATED', detail: EDU_NAMES[a.edu] });
    if (tryUpgrade(a)) pushFeed('↳ ' + a.name + ' hired as <b>' + TIERS[a.job.tier].name + '</b>', 'f-green');
  }
  idle(a, 0);
}

function tickAgent(a) {
  const m = MIN_PER_TICK;

  /* continuous needs */
  const awake = a.state !== 'SLEEP';
  a.hunger = clamp(a.hunger - (awake ? 0.11 : 0.03) * m, 0, 100);

  let eDrain = 0.10;
  if (a.state === 'WORK' || a.state === 'MOVE') eDrain = 0.18;
  if (a.state === 'SLEEP') a.energy = clamp(a.energy + 0.45 * m, 0, 100);
  else a.energy = clamp(a.energy - eDrain * m, 0, 100);

  /* happiness drift */
  let dh = 0;
  if (a.hunger < 30) dh -= 0.02;
  if (a.energy < 25) dh -= 0.02;
  if (!a.job) dh -= 0.015; else dh += 0.008;
  if (a.underemployed) dh -= 0.012;
  if (a.homeless) dh -= 0.05;
  if (a.state === 'PARK') dh += 0.05;
  if (a.state === 'EAT') dh += 0.03;
  if (a.state === 'SLEEP') dh += 0.02;
  dh -= (taxRate - 0.15) * 0.02;
  if (festivalMin > 0) dh += 0.06;
  a.happiness = clamp(a.happiness + dh * m, 0, 100);

  /* crash if fully exhausted */
  if (a.energy <= 0.5 && a.state !== 'SLEEP') { sleepInPlace(a, 300); a.happiness = clamp(a.happiness - 6, 0, 100); return; }

  /* state machine */
  switch (a.state) {
    case 'MOVE': {
      const t = a.path[a.pathI];
      if (!t) { arrive(a); break; }
      const dx = t.x - a.x, dy = t.y - a.y;
      const dist = Math.hypot(dx, dy);
      const step = MOVE_SPEED * (a.spdF || 1) * m;
      if (dist <= step) {
        a.x = t.x; a.y = t.y; a.pathI++;
        if (a.pathI >= a.path.length) arrive(a);
      } else { a.x += (dx / dist) * step; a.y += (dy / dist) * step; }
      break;
    }
    case 'WORK':
      a.activityMin -= m;
      if (a.activityMin <= 0) finishWork(a);
      break;
    case 'STUDY':
      a.activityMin -= m;
      if (a.activityMin <= 0) finishStudy(a);
      break;
    case 'EAT':
      a.activityMin -= m;
      if (a.activityMin <= 0) { a.hunger = clamp(a.hunger + MEAL_GAIN, 0, 100); a.happiness = clamp(a.happiness + 6, 0, 100); idle(a, 30); }
      break;
    case 'PARK':
      a.activityMin -= m;
      if (a.activityMin <= 0) idle(a, 30);
      break;
    case 'SLEEP':
      a.activityMin -= m;
      if (a.activityMin <= 0) { a.happiness = clamp(a.happiness + 8, 0, 100); idle(a, 0); }
      break;
    case 'IDLE':
      a.waitMin -= m;
      if (a.waitMin <= 0) decide(a);
      break;
  }
}

/* ----------------------------------------------------------------
   8. DAY BOUNDARY
---------------------------------------------------------------- */
function onNewDay() {
  for (const a of agents) { a.workedToday = false; a.studiedToday = false; refreshUnderemployed(a); }
  promotePass();
  hireAll();
  dailyEconomy();
  if (window.AP && AP.onDay) { try { AP.onDay(); } catch (e) { console.error('[AP day]', e); } }
}

function tick() {
  simMin += MIN_PER_TICK;
  if (festivalMin > 0) festivalMin -= MIN_PER_TICK;
  if (Math.floor(simMin / DAY_MIN) + 1 > simDay) { simDay = Math.floor(simMin / DAY_MIN) + 1; onNewDay(); }
  for (const a of agents) tickAgent(a);
  if (window.AP && AP.onTick) { try { AP.onTick(); } catch (e) { console.error('[AP tick]', e); } }
}

/* ----------------------------------------------------------------
   9. RENDERER (isometric)
---------------------------------------------------------------- */
const canvas = el('city'), ctx = canvas.getContext('2d');
const stage = el('stage');
let W = 0, H = 0, TW = BASE_TW, TH = BASE_TH, ORX = 0, ORY = 0, S = 1, dpr = 1;
let stars = [];

function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(320, r.width); H = Math.max(280, r.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sx = W / (GRID * BASE_TW + 110);
  const sy = H / (GRID * BASE_TH + 330);
  S = clamp(Math.min(sx, sy), 0.35, 1.7);
  TW = BASE_TW * S; TH = BASE_TH * S;
  ORX = W / 2;
  ORY = (H - GRID * TH) / 2 + 56 * S;

  stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.7, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.28 }));
}
const iso = (tx, ty) => ({ x: ORX + (tx - ty) * (TW / 2), y: ORY + (tx + ty) * (TH / 2) });

function skyT() {
  const h = hour();
  if (h < 5) return 0;
  if (h < 7) return (h - 5) / 2;
  if (h < 17) return 1;
  if (h < 21) return 1 - (h - 17) / 4;
  return 0;
}
function mix(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',') + ')';
}

function poly(pts, fill, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}

function drawSky(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix('#03050c', '#0a2043', t));
  g.addColorStop(1, mix('#060a16', '#123a63', t));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  if (t < 0.45) {
    const alpha = (0.45 - t) / 0.45;
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(perfNow / 700 + s.p);
      ctx.globalAlpha = alpha * tw * 0.9;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }
}

function drawGround() {
  for (let ty = 0; ty < GRID; ty++) {
    for (let tx = 0; tx < GRID; tx++) {
      const a = iso(tx, ty), b = iso(tx + 1, ty), c = iso(tx + 1, ty + 1), d = iso(tx, ty + 1);
      const isPark = tx >= park.x && tx < park.x + park.w && ty >= park.y && ty < park.y + park.h;
      const lit = skyT();
      const base = isPark
        ? mix('#04160f', '#0a3d2a', lit)
        : ((tx + ty) % 2 === 0 ? mix('#070c18', '#0d1a30', lit) : mix('#080e1c', '#0f1e37', lit));
      poly([a, b, c, d], base, isPark ? 'rgba(61,255,160,.28)' : 'rgba(37,230,255,.10)', 1);
    }
  }
}

function buildingDepth(b) { return (b.x + b.w / 2) + (b.y + b.h / 2); }

function drawBuilding(b) {
  const Hh = (b.hh || 0) * S;
  const A = iso(b.x, b.y), B = iso(b.x + b.w, b.y), C = iso(b.x + b.w, b.y + b.h), D = iso(b.x, b.y + b.h);
  const lit = skyT();

  if (b.walkable) {
    /* park: glowing pad + trees */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = b.color; ctx.lineWidth = 1.4;
    ctx.shadowColor = b.color; ctx.shadowBlur = 12 * S;
    poly([A, B, C, D], null, b.color, 1.4);
    ctx.restore();
    /* little data-trees */
    for (let i = 0; i < 5; i++) {
      const fx = b.x + 0.6 + (i % 3) * 1.4, fy = b.y + 0.7 + Math.floor(i / 3) * 1.2;
      const p = iso(fx, fy);
      ctx.fillStyle = 'rgba(61,255,160,.85)';
      ctx.shadowColor = '#3dffa0'; ctx.shadowBlur = 8 * S;
      ctx.beginPath(); ctx.arc(p.x, p.y - 7 * S, 3.2 * S, 0, 6.283); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(61,255,160,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 7 * S); ctx.stroke();
    }
    return;
  }

  const top = [{ x: A.x, y: A.y - Hh }, { x: B.x, y: B.y - Hh }, { x: C.x, y: C.y - Hh }, { x: D.x, y: D.y - Hh }];
  const leftWall  = [D, C, { x: C.x, y: C.y - Hh }, { x: D.x, y: D.y - Hh }];
  const rightWall = [C, B, { x: B.x, y: B.y - Hh }, { x: C.x, y: C.y - Hh }];

  /* ground shadow */
  ctx.save();
  ctx.globalAlpha = 0.35;
  poly([{ x: A.x + 6 * S, y: A.y + 4 * S }, { x: B.x + 6 * S, y: B.y + 4 * S },
        { x: C.x + 6 * S, y: C.y + 4 * S }, { x: D.x + 6 * S, y: D.y + 4 * S }], 'rgba(0,0,0,.55)');
  ctx.restore();

  const dim = 0.5 + 0.5 * lit;
  const wallL = mix('#05070f', shade(b.color, -0.62), dim);
  const wallR = mix('#05070f', shade(b.color, -0.4), dim);
  const roof  = mix('#05070f', shade(b.color, -0.15), dim);

  ctx.save();
  ctx.shadowColor = b.color; ctx.shadowBlur = 16 * S;
  poly(leftWall, wallL, shade(b.color, 0.1), 1.1);
  poly(rightWall, wallR, shade(b.color, 0.1), 1.1);
  poly(top, roof, b.color, 1.4);
  ctx.restore();

  /* window / floor stripes */
  const floors = Math.max(1, Math.floor(Hh / (15 * S)));
  ctx.save();
  ctx.globalAlpha = 0.75;
  for (let f = 1; f <= floors; f++) {
    const yy = (Hh / (floors + 1)) * f;
    const isLit = ((f + b.x + b.y) % 3 !== 0);
    ctx.strokeStyle = isLit ? shade(b.color, 0.35) : 'rgba(120,160,210,.2)';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = b.color; ctx.shadowBlur = isLit ? 6 * S : 0;
    ctx.beginPath();
    ctx.moveTo(D.x, D.y - yy); ctx.lineTo(C.x, C.y - yy); ctx.lineTo(B.x, B.y - yy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(D.x, D.y - yy); ctx.lineTo(C.x, C.y - yy);
    ctx.stroke();
  }
  ctx.restore();

  /* beacon on the tower */
  if (b.type === 'TOWER') {
    const pulse = 0.5 + 0.5 * Math.sin(perfNow / 420);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * pulse;
    const grad = ctx.createLinearGradient(top[0].x, top[0].y, top[0].x, 0);
    grad.addColorStop(0, b.color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    const bw = 3 * S;
    ctx.fillRect(top[0].x - bw / 2 + (TW / 2), top[0].y - 40 * S, bw, top[0].y);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#eaffff'; ctx.shadowColor = b.color; ctx.shadowBlur = 22 * S;
    ctx.beginPath(); ctx.arc(top[0].x + (TW / 2), top[0].y, 3.4 * S, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  /* label */
  if (['TOWER', 'INSTITUTE', 'CAFE', 'PARK'].includes(b.type)) drawLabel(b, top, Hh);
}

function drawLabel(b, top, Hh) {
  const cx = (top[0].x + top[2].x) / 2;
  const cy = Math.min(top[0].y, top[1].y) - 16 * S;
  ctx.save();
  ctx.font = '600 ' + Math.round(10.5 * clamp(S, 0.7, 1.3)) + 'px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  const w = ctx.measureText(b.name).width + 16;
  ctx.fillStyle = 'rgba(4,8,16,.82)';
  ctx.strokeStyle = b.color; ctx.lineWidth = 1;
  roundRect(cx - w / 2, cy - 11, w, 17, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = b.color;
  ctx.shadowColor = b.color; ctx.shadowBlur = 8;
  ctx.fillText(b.name, cx, cy + 2);
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function shade(hex, amt) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const f = (v) => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
  return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
}

function drawAgent(a) {
  /* smooth display position */
  a.dx += (a.x - a.dx) * Math.min(1, 0.22 + speed * 0.03);
  a.dy += (a.y - a.dy) * Math.min(1, 0.22 + speed * 0.03);
  const base = iso(a.dx, a.dy);
  let p = base;
  if (a.state !== 'MOVE') {
    p = { x: base.x + Math.cos(a.stagA) * a.stagR * S,
          y: base.y + Math.sin(a.stagA) * a.stagR * S * 0.55 };
  }
  a.sx = p.x; a.sy = p.y;

  const col = STATE_COLOR[a.state] || '#25e6ff';
  const isSel = selected && selected.kind === 'agent' && selected.ref === a;

  /* vertical light pip */
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 14 * S); ctx.stroke();
  ctx.restore();

  /* body */
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = (isSel ? 20 : 11) * S;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(p.x, p.y - 15 * S, (isSel ? 5.4 : 4.2) * S, 0, 6.283); ctx.fill();
  ctx.restore();

  /* selection / activity ring */
  if (isSel) {
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y - 15 * S, 9 * S, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11 * S, 0, 6.283); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = '600 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf6ff'; ctx.shadowColor = '#25e6ff'; ctx.shadowBlur = 8;
    ctx.fillText(a.name, p.x, p.y - 26 * S);
    ctx.restore();
  }
}

function render() {
  const t = skyT();
  drawSky(t);
  drawGround();

  /* depth-sorted objects */
  const objs = [];
  for (const b of buildings) objs.push({ d: buildingDepth(b), b });
  for (const a of agents) objs.push({ d: a.x + a.y, a });
  objs.sort((p, q) => p.d - q.d);
  for (const o of objs) { if (o.b) drawBuilding(o.b); else drawAgent(o.a); }

  /* night tint */
  if (t < 1) { ctx.fillStyle = 'rgba(4,7,20,' + ((1 - t) * 0.16) + ')'; ctx.fillRect(0, 0, W, H); }
}

/* ----------------------------------------------------------------
   10. UI — HUD, controls, inspector
---------------------------------------------------------------- */
let perfNow = 0, lastHud = 0;

function avgHappiness() {
  if (!agents.length) return 0;
  return agents.reduce((s, a) => s + a.happiness, 0) / agents.length;
}

function updateHud() {
  const h = hour();
  const hh = Math.floor(h), mm = Math.floor((simMin % 60));
  el('dayLabel').textContent = 'DAY ' + simDay;
  el('timeLabel').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  el('phaseLabel').textContent = h < 5 ? 'NIGHT' : h < 7 ? 'DAWN' : h < 17 ? 'DAYLIGHT' : h < 20 ? 'DUSK' : 'NIGHT';

  const emp = agents.filter(a => a.job).length;
  const unemp = agents.length - emp;
  const grads = agents.filter(a => a.edu >= 3).length;
  const hap = avgHappiness();

  set('sPop', agents.length);
  set('sEmp', emp);
  set('sUnemp', unemp, unemp > 0 ? 'warn' : '');
  set('sGrad', grads);
  set('sGdp', fmt(gdp));
  set('sTre', fmt(treasury), treasury < 0 ? 'bad' : treasury > 600 ? 'hot' : 'warn');
  set('sHap', Math.round(hap) + '%', hap < 35 ? 'bad' : hap > 60 ? 'hot' : 'warn');
  set('sHouse', agents.length + '/' + housingCap(), agents.length >= housingCap() ? 'bad' : '');

  renderJobBars();
  renderInstitute();
  if (selected) renderInspector();
}
function set(id, val, cls) {
  const n = el(id); if (!n) return;
  n.textContent = val;
  n.className = cls || '';
}

function renderJobBars() {
  const box = el('jobBars');
  let html = '';
  TIERS.forEach((t, i) => {
    const filled = t.slots - tower.slots[i];
    const pct = (filled / t.slots) * 100;
    html += '<div class="jobrow ' + (tower.slots[i] === 0 ? 'jrow-full' : '') + '">' +
      '<div class="jl"><span>' + t.name + '</span><b>' + filled + '/' + t.slots + '</b></div>' +
      '<div class="jtrack"><i style="width:' + pct + '%;background:' + t.color + ';color:' + t.color + '"></i></div></div>';
  });
  box.innerHTML = html;
}

function renderInstitute() {
  const studying = agents.filter(a => a.state === 'STUDY').length;
  const box = el('instStats');
  box.innerHTML =
    mini('SEATS', studying + '/' + INSTITUTE_SEATS) +
    mini('SCHOLARSHIPS', sponsorQuota) +
    mini('GRADUATED', graduatesTotal) +
    mini('TUITION', TUITION);
}
function mini(label, val) { return '<div class="mini"><span>' + label + '</span><b>' + val + '</b></div>'; }

function meter(label, v, cls) {
  return '<div class="stat-row"><span>' + label + '</span><b>' + Math.round(v) + '</b></div>' +
    '<div class="meter ' + cls + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></div>';
}

function renderInspector() {
  const box = el('inspector');
  if (!selected) { box.innerHTML = '<p class="dim">Click an agent or a building.</p>'; return; }

  if (selected.kind === 'agent') {
    const a = selected.ref;
    if (!agents.includes(a)) { selected = null; box.innerHTML = '<p class="dim">Click an agent or a building.</p>'; return; }
    const st = STATE_BADGE[a.state] || STATE_BADGE.IDLE;
    const job = a.job ? TIERS[a.job.tier].name : 'Unemployed';
    const role = a.job ? TIERS[a.job.tier].name + ' · Main Tower' : (a.homeless ? 'No fixed address' : 'Seeking opportunity');
    box.innerHTML =
      '<div class="ins-name">' + a.name + '</div>' +
      '<div class="ins-role">' + role + '</div>' +
      '<span class="ins-badge ' + st[0] + '">' + st[1] + '</span>' +
      row('Job', job) +
      row('Education', EDU_NAMES[a.edu]) +
      row('Money', fmt(a.money) + ' ¤') +
      row('Home', a.home ? a.home.name : 'HOMELESS') +
      row('Sponsored', a.sponsored ? 'Yes' : 'No') +
      meter('ENERGY', a.energy, 'energy') +
      meter('HUNGER', a.hunger, 'hunger') +
      meter('HAPPINESS', a.happiness, 'happy') +
      '<div class="stat-row"><span>Education XP</span><b>' + Math.round(a.eduXp) + '/' + (a.edu < 4 ? EDU_NEED[a.edu] : 'MAX') + '</b></div>' +
      '<div class="stat-row"><span>Performance</span><b>' + Math.round(a.perf * 100) + '%</b></div>';
  } else {
    const b = selected.ref;
    let extra = '';
    if (b.type === 'TOWER') {
      extra = TIERS.map((t, i) => row(t.name, (t.slots - tower.slots[i]) + '/' + t.slots + ' filled')).join('');
    } else if (b.type === 'INSTITUTE') {
      extra = row('Students now', agents.filter(a => a.state === 'STUDY').length + '/' + INSTITUTE_SEATS) +
              row('Scholarships/day', sponsorQuota) + row('Graduates', graduatesTotal);
    } else if (b.type === 'HOME') {
      extra = row('Residents', homeOccupancy(b) + '/' + HOME_CAP);
    } else if (b.type === 'PARK') {
      extra = row('Visitors now', agents.filter(a => a.state === 'PARK').length);
    } else if (b.type === 'CAFE') {
      extra = row('Meal price', MEAL_COST + ' ¤') + row('Customers now', agents.filter(a => a.state === 'EAT').length);
    }
    box.innerHTML =
      '<div class="ins-name">' + b.name + '</div>' +
      '<div class="ins-role">' + b.type + ' · footprint ' + b.w + '×' + b.h + '</div>' +
      extra;
  }
}
function row(k, v) { return '<div class="stat-row"><span>' + k + '</span><b>' + v + '</b></div>'; }

/* -------- input -------- */
let camOffX = 0, camOffY = 0, panX = 0, panY = 0;

function screenToWorldTile(cx, cy) {
  const dx = cx - ORX - camOffX;
  const dy = cy - ORY - camOffY;
  const tx = (dx / (TW / 2) + dy / (TH / 2)) / 2;
  const ty = (dy / (TH / 2) - dx / (TW / 2)) / 2;
  return { x: Math.floor(tx), y: Math.floor(ty) };
}

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;

  /* nearest agent within radius */
  let best = null, bd = 16;
  for (const a of agents) {
    const d = Math.hypot(a.sx - cx, (a.sy - 15 * S) - cy);
    if (d < bd) { bd = d; best = a; }
  }
  if (best) { selected = { kind: 'agent', ref: best }; renderInspector(); return; }

  const t = screenToWorldTile(cx, cy);
  const b = buildings.find(b => t.x >= b.x && t.x < b.x + b.w && t.y >= b.y && t.y < b.y + b.h);
  if (b) { selected = { kind: 'building', ref: b }; renderInspector(); }
  else { selected = null; renderInspector(); }
});

/* -------- control wiring -------- */
function wireControls() {
  const pauseBtn = el('btnPause');
  pauseBtn.addEventListener('click', () => {
    running = !running;
    pauseBtn.textContent = running ? '⏸ PAUSE' : '▶ RESUME';
    pauseBtn.classList.toggle('active', !running);
  });

  document.querySelectorAll('.ctl-btn.spd').forEach(btn => {
    btn.addEventListener('click', () => {
      speed = parseFloat(btn.dataset.spd);
      document.querySelectorAll('.ctl-btn.spd').forEach(b => b.classList.toggle('active', b === btn));
      if (!running) { running = !running; pauseBtn.textContent = '⏸ PAUSE'; pauseBtn.classList.remove('active'); }
    });
  });

  el('btnSpawn1').addEventListener('click', () => doSpawn(1));
  el('btnSpawn5').addEventListener('click', () => doSpawn(5));

  el('btnHome').addEventListener('click', () => {
    if (treasury < HOME_COST) return toast('⚠ Treasury too low to build (need ' + HOME_COST + ')');
    if (buildSpotIdx >= BUILD_SPOTS.length) return toast('⚠ No free land left to build on');
    treasury -= HOME_COST;
    const s = BUILD_SPOTS[buildSpotIdx++];
    const h = mkBuilding({ type: 'HOME', name: 'HAB-' + String(++homeSeq).padStart(2, '0'), x: s.x, y: s.y, w: s.w, h: s.h, hh: 46, color: '#8b7dff' });
    homes.push(h);
    rebuildBlocked();
    pushFeed('🏠 New home built (' + h.name + ') — housing capacity +' + HOME_CAP, 'f-green');
    renderInspector();
  });

  el('btnFest').addEventListener('click', () => {
    if (treasury < FESTIVAL_COST) return toast('⚠ Treasury too low for a festival (need ' + FESTIVAL_COST + ')');
    treasury -= FESTIVAL_COST;
    festivalMin = 600;
    for (const a of agents) a.happiness = clamp(a.happiness + 18, 0, 100);
    pushFeed('🎉 CITY FESTIVAL! Morale boosted across Autopolis', 'f-amber');
  });

  el('btnReset').addEventListener('click', () => { if (confirm('Reset Autopolis to a fresh city?')) location.reload(); });

  const tax = el('tax'), edub = el('edub');
  tax.addEventListener('input', () => { taxRate = tax.value / 100; el('taxVal').textContent = tax.value + '%'; });
  edub.addEventListener('input', () => { eduBudget = edub.value / 100; el('eduVal').textContent = edub.value + '%'; });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); pauseBtn.click(); }
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
      const s = [1, 60, 600, 3600, 20000][+e.code.slice(-1) - 1];
      document.querySelector('.ctl-btn.spd[data-spd="' + s + '"]').click();
    }
  });

  el('homeCost').textContent = HOME_COST;
  el('festCost').textContent = FESTIVAL_COST;
}

function doSpawn(n) {
  const free = housingCap() - agents.length;
  if (free <= 0) return toast('⚠ No housing space — build more homes first');
  const added = spawnAgents(Math.min(n, free), 'free');
  if (added) pushFeed('➕ ' + added + ' resident(s) added to the city', 'f-green');
}

let toastTimer = null;
function toast(msg) { pushFeed(msg, 'f-bad'); }

/* ----------------------------------------------------------------
   11. MAIN LOOP
---------------------------------------------------------------- */
let acc = 0, last = performance.now();

function frame(now) {
  perfNow = now;
  const dt = Math.min(200, now - last); last = now;

  if (running) {
    acc += dt * speed;
    let guard = 0;
    while (acc >= TICK_MS && guard++ < 60) { tick(); acc -= TICK_MS; }
  }

  render();
  if (now - lastHud > 160) { lastHud = now; updateHud(); }
  requestAnimationFrame(frame);
}

/* ----------------------------------------------------------------
   12. BOOT
---------------------------------------------------------------- */
function init() {
  setupWorld();
  rebuildBlocked();
  tower.slots = TIERS.map(t => t.slots);

  agents = [];
  const shuffled = shuffle(homes.slice());
  for (let i = 0; i < START_POP; i++) {
    const h = i < shuffled.length * HOME_CAP ? shuffled[i % shuffled.length] : null;
    agents.push(makeAgent(h && homeOccupancy(h) < HOME_CAP ? h : pickHomesWithSpace()));
  }
  agents.forEach(a => { if (!a.home) assignHome(a); });

  promotePass();
  hireAll();
  assignSponsors();

  resize();
  window.addEventListener('resize', () => { resize(); });
  wireControls();
  renderInspector();
  updateHud();

  pushFeed('◈ <b>AUTOPOLIS online.</b> ' + START_POP + ' residents · ' + homes.length + ' homes · Main Tower open', 'f-green');
  pushFeed('Press <b>Space</b> to pause · <b>1–4</b> for speed · drag sliders to steer the economy', '');

  const boot = el('boot');
  setTimeout(() => boot.classList.add('hide'), 500);

  requestAnimationFrame(frame);
}

/* ----------------------------------------------------------------
   13. v2 EXTENSION SURFACE
   life.js / revenue.js / devices.js / apui.js attach onto window.AP
---------------------------------------------------------------- */
window.AP = {
  version: 2,
  /* live refs */
  get agents() { return agents; },
  get buildings() { return buildings; },
  get homes() { return homes; },
  get tower() { return tower; },
  get institute() { return institute; },
  get cafe() { return cafe; },
  get park() { return park; },
  /* mutable economy */
  get treasury() { return treasury; },  set treasury(v) { treasury = v; },
  get gdp() { return gdp; },
  get dayOutput() { return dayOutput; }, set dayOutput(v) { dayOutput = v; },
  get happinessAvg() { return happinessAvg; },
  get graduatesTotal() { return graduatesTotal; },
  /* clock */
  get simMin() { return simMin; },  set simMin(v) { simMin = v; },
  get simDay() { return simDay; },
  get running() { return running; }, set running(v) { running = v; },
  get speed() { return speed; },     set speed(v) { speed = v; },
  get MIN_PER_TICK() { return MIN_PER_TICK; }, set MIN_PER_TICK(v) { MIN_PER_TICK = v; },
  get TICK_MS() { return TICK_MS; }, set TICK_MS(v) { TICK_MS = v; },
  /* policy */
  get taxRate() { return taxRate; },   set taxRate(v) { taxRate = v; },
  get eduBudget() { return eduBudget; }, set eduBudget(v) { eduBudget = v; },
  get festivalMin() { return festivalMin; }, set festivalMin(v) { festivalMin = v; },
  get selected() { return selected; }, set selected(v) { selected = v; },
  /* constants */
  TIERS, EDU_NAMES, EDU_NEED, DAY_MIN, GRID, HOME_COST, FESTIVAL_COST, HOME_CAP, INSTITUTE_SEATS, START_POP,
  BUILD_SPOTS, mkBuilding, rebuildBlocked, setupWorld,
  get buildSpotIdx() { return buildSpotIdx; }, set buildSpotIdx(v) { buildSpotIdx = v; },
  get homeSeq() { return homeSeq; }, set homeSeq(v) { homeSeq = v; },
  /* utils */
  fmt, clamp, rand, randi, pick, chance, shuffle, hour, dayNo,
  avgHappiness, housingCap, homeOccupancy, assignHome, spawnAgents, tryJob, tryUpgrade,
  promotePass, hireAll, assignSponsors, renderInspector, updateHud, pushFeed, toast,
  /* extension hooks — assigned by the v2 modules */
  onTick: null, onDay: null, onFeed: null, log: null, renderExtra: null
};

init();
})();
