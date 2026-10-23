/* ==================================================================
   AUTOPOLIS v2 — LIFE ENGINE
   ------------------------------------------------------------------
   Marriage, relationships, pregnancy, birth, children, aging, health,
   death + inheritance, vehicles, land purchase, home building,
   business ownership & expansion, weather, disasters, crime.
   Everything here is emergent and every event is written to the log.
   ================================================================== */
(function () {
  'use strict';
  const AP = window.AP, APU = window.APU, logE = APU.logEvent;
  const L = window.APLife = {};

  L.cfg = {
    ageDaysPerYear: 14,       // 1 simulated year every N simulated days (editable)
    gestationDays: 9,         // pregnancy length in sim days
    adultAge: 18,
    marryChance: 0.055,       // per eligible couple per day
    courtshipDays: 3,
    birthChance: 0.16,        // per fertile married couple per day
    maxChildren: 4,
    mortalityPerYear: 0.055,  // baseline chance of death per year of age past 55
    illnessChance: 0.02,      // per agent per day
    vehicleCost: 320,
    landCost: 180,
    houseBuildCost: 400,
    businessCost: 900,
    businessExpandCost: 700,
    crimeRate: 0.03,          // per agent per day, scaled by misery + joblessness
    securitySpend: 0,         // 0..1 policy dial that suppresses crime
    weatherEnabled: true
  };

  L.businesses = [];   // {id,name,ownerId,level,staff[],income,lastPayout}
  L.land = [];         // {id,ownerId,spotIdx,name,built}
  L.weather = 'CLEAR';
  let weatherMin = 0, nextBizId = 1, nextLandId = 1;

  const WEATHERS = {
    CLEAR: { speed: 1.00, hap: +0.01, dmg: 0 },
    OVERCAST: { speed: 0.97, hap: 0, dmg: 0 },
    RAIN: { speed: 0.82, hap: -0.01, dmg: 0.004 },
    STORM: { speed: 0.62, hap: -0.03, dmg: 0.05 },
    HEATWAVE: { speed: 0.88, hap: -0.02, dmg: 0.002 }
  };

  /* ---------------- per-agent lazy init ---------------- */
  function ensure(a) {
    if (a.age === undefined) {
      a.age = 16 + Math.floor(Math.random() * 34);
      a.gender = Math.random() < 0.5 ? 'F' : 'M';
      a.partnerId = null; a.children = []; a.pregnancy = null;
      a.health = 78 + Math.random() * 22; a.sick = 0;
      a.assets = { vehicles: [], land: [], cashInvested: 0 };
      a.familyId = null; a.metPartner = false; a.gig = null; a.portfolio = null; a.businessId = null;
      a._ageDay = Math.floor(Math.random() * L.cfg.ageDaysPerYear);
    }
    return a;
  }
  AP.agents.forEach(ensure);
  const live = () => { AP.agents.forEach(ensure); return AP.agents; };

  const byId = (id) => AP.agents.find((a) => a.id === id) || null;
  const money = (a, delta, cat, evt, why) => {
    a.money = Math.max(0, a.money + delta);
    if (why) logE(cat || 'MONEY', delta < 0 ? 'warn' : 'info', a, evt, why, delta);
  };

  /* ---------------- weather ---------------- */
  function rollWeather() {
    if (!L.cfg.weatherEnabled) return;
    const r = Math.random();
    const next = r < 0.52 ? 'CLEAR' : r < 0.74 ? 'OVERCAST' : r < 0.90 ? 'RAIN' : r < 0.975 ? 'STORM' : 'HEATWAVE';
    if (next === L.weather) return;
    const heavy = next === 'STORM';
    L.weather = next; weatherMin = heavy ? 720 : 1200;
    logE('WEATHER', heavy ? 'warn' : 'info', null, 'WEATHER_' + (heavy ? 'ALERT' : 'CHANGE'),
      next.replace('_', ' ').toLowerCase() + ' settling over Autopolis');
    APU.emit('weather', L.weather);
  }

  function weatherDamage() {
    const w = WEATHERS[L.weather]; if (!w || !w.dmg) return;
    if (Math.random() > w.dmg) return;
    const b = AP.buildings.filter((x) => x.type === 'HOME' || x.type === 'BUSINESS');
    if (!b.length) return;
    const hit = b[Math.floor(Math.random() * b.length)];
    const cost = Math.round(60 + Math.random() * 180);
    AP.treasury = Math.max(0, AP.treasury - cost);
    logE('WEATHER', 'error', null, 'PROPERTY_DAMAGE', L.weather + ' damaged ' + hit.name + ' — repair bill', -cost);
    APU.emit('feed', ['⛈ ' + L.weather + ' damaged <b>' + hit.name + '</b> · repair −' + cost + ' ¤', 'f-bad']);
  }

  /* ---------------- aging ---------------- */
  function ageTick(a) {
    a._ageDay++;
    if (a._ageDay < L.cfg.ageDaysPerYear) return;
    a._ageDay = 0; a.age++;
    logE('LIFE', 'info', a, 'BIRTHDAY', 'now ' + a.age + ' years old');
    if (a.age > 50) a.health = Math.max(4, a.health - (1.5 + (a.age - 50) * 0.12));
    /* mortality */
    const over = Math.max(0, a.age - 55);
    const risk = L.cfg.mortalityPerYear * (1 + over * 0.14) * (1 - a.health / 190);
    if (a.age > 52 && Math.random() < risk) return die(a, 'natural causes');
  }

  /* ---------------- health ---------------- */
  function healthTick(a) {
    if (a.sick > 0) {
      a.sick--;
      a.health = Math.max(0, a.health - 1.6);
      a.happiness = AP.clamp(a.happiness - 0.05, 0, 100);
      if (a.sick === 0) { a.health = AP.clamp(a.health + 14, 0, 100); logE('HEALTH', 'info', a, 'RECOVERED', 'back on their feet'); }
      return;
    }
    if (a.health < 34) return;
    if (Math.random() < L.cfg.illnessChance) {
      a.sick = 2 + Math.floor(Math.random() * 4);
      logE('HEALTH', 'warn', a, 'ILLNESS', 'fell ill — out of action for ' + a.sick + ' days');
      /* treatment */
      const bill = 40 + Math.floor(Math.random() * 90);
      if (a.money >= bill) { money(a, -bill, 'HEALTH', 'MEDICAL_BILL', 'paid for treatment'); a.health = AP.clamp(a.health + 10, 0, 100); }
      else { logE('HEALTH', 'error', a, 'UNABLE_TO_PAY', 'cannot afford treatment — health declining'); a.happiness = AP.clamp(a.happiness - 8, 0, 100); }
    }
  }

  /* ---------------- marriage / relationships ---------------- */
  function socialTick(a) {
    if (a.partnerId || a.age < L.cfg.adultAge) return;
    if (a.state !== 'PARK' && a.state !== 'EAT') return;
    const cands = live().filter((b) => !b.partnerId && b.id !== a.id && b.age >= L.cfg.adultAge && b.state === a.state);
    if (!cands.length) return;
    if (Math.random() > L.cfg.marryChance) return;
    const b = AP.pick(cands);
    a.partnerId = b.id; b.partnerId = a.id;
    a.metPartner = b.metPartner = true;
    a.familyId = b.familyId = a.familyId || (1000 + a.id);
    logE('FAMILY', 'info', a, 'RELATIONSHIP_STARTED', 'now seeing ' + b.name + ' (agent #' + b.id + ')');
    APU.emit('feed', ['💘 <b>' + a.name + '</b> and <b>' + b.name + '</b> are together', 'f-mag']);
    a._weddingIn = L.cfg.courtshipDays; b._weddingIn = L.cfg.courtshipDays;
  }

  function weddingTick(a) {
    if (a._weddingIn == null) return;
    a._weddingIn -= 1 / 7;
    if (a._weddingIn > 0) return;
    a._weddingIn = null;
    const sp = byId(a.partnerId); if (!sp) { a.partnerId = null; return; }
    sp._weddingIn = null;
    const cost = 120;
    if (a.money >= cost) money(a, -cost, 'FAMILY', 'WEDDING', 'wedding of ' + a.name + ' & ' + sp.name);
    else logE('FAMILY', 'warn', a, 'WEDDING_BUDGET', 'austerity wedding — ' + sp.name + ' moved in');
    a.married = sp.married = true;
    a.happiness = AP.clamp(a.happiness + 22, 0, 100);
    sp.happiness = AP.clamp(sp.happiness + 22, 0, 100);
    if (sp.home && a.home !== sp.home) { a.home = sp.home; a.homeless = false; }
    logE('FAMILY', 'info', a, 'MARRIED', 'married ' + sp.name + ' · household ' + (a.home ? a.home.name : 'street'));
    APU.emit('feed', ['💍 <b>' + a.name + '</b> married <b>' + sp.name + '</b>', 'f-mag']);
  }

  /* ---------------- pregnancy & birth ---------------- */
  function reproTick(a) {
    if (!a.married || a.gender !== 'F') return;
    if (a.age < 18 || a.age > 44) return;
    if (a.pregnancy || a.children.length >= L.cfg.maxChildren) return;
    if (Math.random() > L.cfg.birthChance / 7) return;
    a.pregnancy = { due: AP.simDay + L.cfg.gestationDays, father: a.partnerId };
    logE('FAMILY', 'info', a, 'PREGNANT', 'expecting · due day ' + a.pregnancy.due);
    APU.emit('feed', ['🤰 <b>' + a.name + '</b> is expecting — due day ' + a.pregnancy.due, 'f-mag']);
  }

  function birthTick(a) {
    if (!a.pregnancy) return;
    if (AP.simDay < a.pregnancy.due) return;
    const fatherId = a.pregnancy.father;
    a.pregnancy = null;
    const father = byId(fatherId);

    if (AP.agents.length >= 220) { logE('FAMILY', 'warn', a, 'BIRTH_DEFERRED', 'city at capacity — no room for a child'); return; }
    AP.spawnAgents(1, 'free');
    const kid = AP.agents[AP.agents.length - 1];
    if (!kid || kid === a) return;
    kid.age = 0; kid._ageDay = 0; kid.gender = Math.random() < 0.5 ? 'F' : 'M';
    kid.edu = 0; kid.eduXp = 0; kid.job = null; kid.money = 0;
    kid.happiness = 88; kid.health = 96; kid.familyId = a.familyId;
    kid.parentA = a.id; kid.parentB = father ? father.id : null;
    kid.name = (kid.gender === 'F' ? 'Nethmi' : 'Kavindu') + ' ' + (AP.pick(['Perera', 'Silva', 'Mohamed', 'Fernando', 'Ranasinghe']));
    if (a.home) { kid.home = a.home; kid.homeless = false; }
    a.children.push(kid.id); if (father) father.children.push(kid.id);
    a.happiness = AP.clamp(a.happiness + 16, 0, 100);
    logE('FAMILY', 'info', a, 'BIRTH', 'welcomed child ' + kid.name + ' (agent #' + kid.id + ')');
    APU.emit('feed', ['👶 <b>' + a.name + '</b> gave birth to <b>' + kid.name + '</b>', 'f-green']);
  }

  /* ---------------- death & inheritance ---------------- */
  function die(a, cause) {
    if (a._dead) return;
    a._dead = true;
    const spouse = byId(a.partnerId);
    const heirs = [spouse].concat(a.children.map(byId)).filter((x) => x && !x._dead);
    const estate = Math.round(a.money);
    if (heirs.length && estate > 0) {
      const share = estate / heirs.length;
      heirs.forEach((h) => { h.money += share; });
      logE('MONEY', 'info', null, 'INHERITANCE', a.name + ' estate ' + estate + ' ¤ split ' + heirs.length + ' ways', estate);
    }
    if (spouse) { spouse.partnerId = null; spouse.married = false; spouse.happiness = AP.clamp(spouse.happiness - 30, 0, 100); }
    if (a.job) AP.tower.slots[a.job.tier]++;          // free the tower slot
    if (a.businessId) {
      const biz = L.businesses.find((b) => b.id === a.businessId);
      if (biz) biz.ownerId = heirs[0] ? heirs[0].id : null;
    }
    const i = AP.agents.indexOf(a);
    if (i > -1) AP.agents.splice(i, 1);
    logE('LIFE', 'warn', a, 'DIED', a.name + ' died at ' + a.age + ' · ' + cause);
    APU.emit('feed', ['🕯 <b>' + a.name + '</b> (' + a.age + ') died — ' + cause, 'f-bad']);
  }

  /* ---------------- vehicles ---------------- */
  function vehicleTick(a) {
    if (a.assets.vehicles.length >= 2 || a.age < 18) return;
    if (a.money < L.cfg.vehicleCost * 1.4) return;
    if (Math.random() > 0.012 / 7) return;
    const model = AP.pick(['Nano EV', 'KDH Van', 'iMate', 'Axia', 'Leaf', 'Scooter']);
    money(a, -L.cfg.vehicleCost, 'VEHICLE', 'VEHICLE_PURCHASED', 'bought a ' + model, -L.cfg.vehicleCost);
    a.assets.vehicles.push({ model, bought: AP.simDay, value: L.cfg.vehicleCost });
    a.happiness = AP.clamp(a.happiness + 12, 0, 100);
    logE('VEHICLE', 'info', a, 'VEHICLE_OWNED', model + ' — commute time halved');
    APU.emit('feed', ['🚗 <b>' + a.name + '</b> bought a ' + model, 'f-green']);
  }
  /* a vehicle makes an agent walk faster */
  AP.hooks.tick.push(function () {
    for (const a of AP.agents) a.spdF = (a.assets && a.assets.vehicles.length ? 1.35 : 1) * (0.86 + ((a.id * 37) % 28) / 100);
  });

  /* ---------------- land & home building ---------------- */
  L.buyLand = function (a) {
    const used = new Set(L.land.map((l) => l.spotIdx));
    const free = AP.BUILD_SPOTS.map((_, i) => i).filter((i) => !used.has(i));
    if (!free.length) { logE('PROPERTY', 'warn', a, 'NO_LAND', 'no plots left in the city grid'); return false; }
    if (a.money < L.cfg.landCost) { logE('PROPERTY', 'warn', a, 'INSUFFICIENT_FUNDS', 'cannot afford a plot'); return false; }
    const idx = AP.pick(free);
    money(a, -L.cfg.landCost, 'PROPERTY', 'LAND_PURCHASED', 'plot #' + (idx + 1), -L.cfg.landCost);
    const land = { id: nextLandId++, ownerId: a.id, spotIdx: idx, name: 'PLOT-' + String(idx + 1).padStart(2, '0'), built: false };
    L.land.push(land);
    a.assets.land.push(land.id);
    logE('PROPERTY', 'info', a, 'LAND_OWNED', land.name + ' registered to ' + a.name, -L.cfg.landCost);
    APU.emit('feed', ['🗺 <b>' + a.name + '</b> bought ' + land.name, 'f-green']);
    return true;
  };

  L.buildHouse = function (a) {
    const land = L.land.find((l) => l.ownerId === a.id && !l.built);
    if (!land) { logE('PROPERTY', 'warn', a, 'NO_PLOT', 'own a plot before building'); return false; }
    if (a.money < L.cfg.houseBuildCost) { logE('PROPERTY', 'warn', a, 'INSUFFICIENT_FUNDS', 'cannot afford to build'); return false; }
    if (AP.buildSpotIdx !== land.spotIdx) { logE('PROPERTY', 'warn', a, 'PLOT_UNAVAILABLE', 'that plot is not yet released by the city'); return false; }
    money(a, -L.cfg.houseBuildCost, 'PROPERTY', 'HOUSE_BUILT', land.name + ' → new home', -L.cfg.houseBuildCost);
    land.built = true;
    const s = AP.BUILD_SPOTS[AP.buildSpotIdx++];
    const h = AP.mkBuilding({ type: 'HOME', name: 'HOM-' + String(++AP.homeSeq).padStart(2, '0'), x: s.x, y: s.y, w: s.w, h: s.h, hh: 46, color: '#ff9de2' });
    AP.homes.push(h);
    AP.rebuildBlocked();
    a.happiness = AP.clamp(a.happiness + 18, 0, 100);
    logE('PROPERTY', 'info', a, 'HOME_ESTABLISHED', a.name + ' built ' + h.name);
    APU.emit('feed', ['🏡 <b>' + a.name + '</b> built <b>' + h.name + '</b>', 'f-green']);
    return true;
  };

  /* ---------------- businesses ---------------- */
  const BIZ_KINDS = ['Freelance Studio', 'Delivery Hub', 'Cyber Café', 'Data Shop', 'Repair Bay', 'Media Lab'];
  L.openBusiness = function (a) {
    if (a.businessId) { logE('MONEY', 'warn', a, 'ALREADY_OWNER', 'you already run a business'); return false; }
    if (a.money < L.cfg.businessCost) { logE('MONEY', 'warn', a, 'INSUFFICIENT_FUNDS', 'need ' + L.cfg.businessCost + ' ¤ to incorporate'); return false; }
    money(a, -L.cfg.businessCost, 'MONEY', 'BUSINESS_OPENED', 'incorporated a new venture', -L.cfg.businessCost);
    const kind = AP.pick(BIZ_KINDS);
    const biz = { id: nextBizId++, name: kind + ' · ' + a.name.split(' ')[0], ownerId: a.id, level: 1, staff: [], income: 0, lastPayout: 0, day: AP.simDay };
    L.businesses.push(biz);
    a.businessId = biz.id;
    const s = AP.BUILD_SPOTS[AP.buildSpotIdx % AP.BUILD_SPOTS.length];
    const b = AP.mkBuilding({ type: 'BUSINESS', name: biz.name.toUpperCase().slice(0, 12), x: s.x, y: s.y, w: 3, h: 3, hh: 40, color: '#ffb545' });
    AP.rebuildBlocked();
    logE('MONEY', 'info', a, 'BUSINESS_INCORPORATED', biz.name + ' trading');
    APU.emit('feed', ['🏪 <b>' + a.name + '</b> opened <b>' + biz.name + '</b>', 'f-amber']);
    return true;
  };

  L.expandBusiness = function (biz, a) {
    if (biz.level >= 5) return false;
    if (a.money < L.cfg.businessExpandCost) return false;
    money(a, -L.cfg.businessExpandCost, 'MONEY', 'BUSINESS_EXPANDED', biz.name + ' → level ' + (biz.level + 1), -L.cfg.businessExpandCost);
    biz.level++;
    logE('MONEY', 'info', a, 'BUSINESS_GROWTH', biz.name + ' now level ' + biz.level);
    APU.emit('feed', ['📈 <b>' + biz.name + '</b> expanded to level ' + biz.level, 'f-amber']);
    return true;
  };

  function businessTick() {
    for (const biz of L.businesses) {
      const owner = byId(biz.ownerId);
      const gross = biz.level * (46 + Math.random() * 40);
      biz.income = gross;
      AP.dayOutput += gross * 0.4;
      AP.treasury += gross * 0.22;
      if (owner && AP.simDay - biz.day >= 1) {
        biz.day = AP.simDay;
        const net = gross * 0.55;
        owner.money += net;
        logE('MONEY', 'info', owner, 'BUSINESS_PAYOUT', biz.name + ' dividend', +net.toFixed(2));
        if (biz.level < 5 && owner.money > L.cfg.businessExpandCost * 3) L.expandBusiness(biz, owner);
      }
    }
  }

  /* ---------------- crime ---------------- */
  function crimeTick() {
    const pressure = AP.clamp(
      (AP.agents.filter((a) => !a.job).length / Math.max(1, AP.agents.length)) * 1.4
      + (1 - AP.avgHappiness() / 100) * 0.9
      - L.cfg.securitySpend * 1.2, 0, 3);
    const p = L.cfg.crimeRate * pressure / 7;
    for (const a of AP.agents) {
      if (Math.random() > p) continue;
      const loss = Math.min(a.money, Math.round(20 + Math.random() * 90));
      if (loss <= 0) continue;
      a.money -= loss; a.happiness = AP.clamp(a.happiness - 7, 0, 100);
      const kind = AP.pick(['pickpocketed', 'scammed online', 'house broken into', 'phone snatched']);
      logE('CRIME', 'warn', a, 'CRIME_INCIDENT', a.name + ' was ' + kind, -loss);
      APU.emit('feed', ['🚨 <b>' + a.name + '</b> was ' + kind + ' · −' + loss + ' ¤', 'f-bad']);
    }
  }

  /* ---------------- daily pass ---------------- */
  APU.hooks.day.push(function () {
    const list = live().slice();
    for (const a of list) {
      if (a._dead) continue;
      reproTick(a); birthTick(a); weddingTick(a); socialTick(a); healthTick(a); vehicleTick(a);
      if (Math.random() < 0.12) ageTick(a);
    }
    weatherDamage();
    businessTick();
    crimeTick();
    rollWeather();
    APU.emit('lifepass', { day: AP.simDay, pop: AP.agents.length });
  });

  /* per-tick weather easing */
  APU.hooks.tick.push(function () { if (weatherMin > 0) weatherMin -= AP.MIN_PER_TICK; });

  /* ---------------- census snapshot for the UI ---------------- */
  L.census = function () {
    const list = live();
    return {
      population: list.length,
      married: list.filter((a) => a.married).length,
      couples: list.filter((a) => a.partnerId).length / 2,
      pregnant: list.filter((a) => a.pregnancy).length,
      children: list.filter((a) => a.age < 18).length,
      seniors: list.filter((a) => a.age >= 60).length,
      vehicleOwners: list.filter((a) => a.assets.vehicles.length).length,
      landowners: list.filter((a) => a.assets.land.length).length,
      businesses: L.businesses.length,
      avgAge: list.length ? Math.round(list.reduce((s, a) => s + a.age, 0) / list.length) : 0,
      avgHealth: list.length ? Math.round(list.reduce((s, a) => s + a.health, 0) / list.length) : 0,
      weather: L.weather
    };
  };

  logE('SYSTEM', 'info', null, 'LIFE_ENGINE', 'life engine attached — marriage·birth·aging·health·vehicles·land·business·weather·crime');
})();
