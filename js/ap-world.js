/* ==================================================================
   AUTOPOLIS v2 — WORLD CONNECTIONS
   ------------------------------------------------------------------
   GitHub · Google (Gmail/Drive) · LAN devices (CCTV, doorbell,
   router, smart plugs).
   Honest scope: cameras, IoT, Gmail and Drive need the local
   service. Opened as a plain file, these panels say so rather than
   pretending to be connected.
   ================================================================== */
(function () {
  'use strict';
  const AP = window.AP, APU = window.APU, logE = APU.logEvent;
  const W = window.APWorld = {};

  /* ---------------- GitHub ---------------- */
  W.github = { profile: null, repos: null, error: null };

  W.loadGithub = function () {
    if (APU.online) {
      return Promise.all([
        APU.api('/api/github/profile'),
        APU.api('/api/github/repos')
      ]).then(([profile, repos]) => {
        W.github.profile = profile; W.github.repos = repos; W.github.error = null;
        logE('GITHUB', 'info', null, 'PROFILE_SYNCED', profile.login + ' · ' + (repos || []).length + ' repos · hireable=' + profile.hireable);
        APU.emit('github', W.github);
        return W.github;
      }).catch((e) => { W.github.error = String(e.message || e); APU.emit('github', W.github); return W.github; });
    }
    /* offline: public GitHub API is CORS-open, so a file:// page can still read it */
    const hdrs = { Accept: 'application/vnd.github+json' };
    return Promise.all([
      fetch('https://api.github.com/users/mhmdmukrim', { headers: hdrs }).then((r) => r.json()),
      fetch('https://api.github.com/users/mhmdmukrim/repos?per_page=100&sort=updated', { headers: hdrs }).then((r) => r.json())
    ]).then(([profile, repos]) => {
      W.github.profile = profile; W.github.repos = repos;
      logE('GITHUB', 'info', null, 'PROFILE_SYNCED', profile.login + ' · ' + (repos || []).length + ' repos (direct API)');
      APU.emit('github', W.github);
      return W.github;
    }).catch((e) => {
      W.github.error = 'GitHub unreachable — ' + String(e.message || e);
      logE('GITHUB', 'warn', null, 'SYNC_FAILED', W.github.error);
      APU.emit('github', W.github);
      return W.github;
    });
  };

  W.topRepos = function (n) {
    const r = W.github.repos;
    if (!r || !r.length) return [];
    return r.slice().sort((a, b) => (b.stargazers_count + b.forks_count * 2 + (b.pushed_at ? 1 : 0)) - (a.stargazers_count + a.forks_count * 2 + (a.pushed_at ? 1 : 0))).slice(0, n || 8);
  };

  /* ---------------- Google (Gmail / Drive) ---------------- */
  W.google = { configured: false, tokens: false, status: 'unknown' };

  W.googleStatus = function () {
    if (!APU.online) { W.google.status = 'service-offline'; APU.emit('google', W.google); return Promise.resolve(W.google); }
    return APU.api('/api/google/status').then((s) => { Object.assign(W.google, s); W.google.status = s.tokens ? 'connected' : s.configured ? 'ready' : 'not-configured'; APU.emit('google', W.google); return W.google; })
      .catch(() => { W.google.status = 'error'; APU.emit('google', W.google); return W.google; });
  };

  W.googleConnect = function () {
    if (!APU.online) { logE('GOOGLE', 'warn', null, 'SERVICE_OFFLINE', 'start the local service to connect Google'); return; }
    APU.api('/api/google/auth', { method: 'POST' }).then((r) => {
      if (r.url) { logE('GOOGLE', 'info', null, 'OAUTH_STARTED', 'opening Google consent screen'); window.open(r.url, '_blank', 'width=520,height=680'); }
      else { logE('GOOGLE', 'warn', null, 'NOT_CONFIGURED', r.error); APU.emit('toast', '⚠ ' + r.error); }
    }).catch((e) => logE('GOOGLE', 'error', null, 'OAUTH_FAILED', String(e.message || e)));
  };

  /* ---------------- LAN devices ---------------- */
  W.devices = { scan: null, cameras: [], scanning: false, error: null };

  W.scan = function () {
    if (!APU.online) { W.devices.error = 'Service offline — LAN scan needs the local service (run start.bat).'; APU.emit('devices', W.devices); return Promise.resolve(null); }
    W.devices.scanning = true; APU.emit('devices', W.devices);
    return APU.api('/api/devices/scan').then((s) => {
      W.devices.scan = s; W.devices.scanning = false; W.devices.error = null;
      const n = s.ok ? s.nets.reduce((t, x) => t + x.devices.length, 0) : 0;
      logE('DEVICE', s.ok ? 'info' : 'error', null, 'LAN_SCAN', n + ' devices known to this PC · ' + (s.error || 'ok'));
      APU.emit('devices', W.devices);
      return s;
    }).catch((e) => { W.devices.scanning = false; W.devices.error = String(e.message || e); APU.emit('devices', W.devices); return null; });
  };

  W.cameras = function () {
    if (!APU.online) return Promise.resolve(W.devices.cameras);
    return APU.api('/api/devices').then((d) => { W.devices.cameras = (d && d.cameras) || []; APU.emit('devices', W.devices); return W.devices.cameras; })
      .catch(() => W.devices.cameras);
  };

  W.addCamera = function (cam) {
    if (!cam.id || !cam.snapshot) return false;
    W.devices.cameras = W.devices.cameras.filter((c) => c.id !== cam.id).concat([cam]);
    if (APU.online) APU.api('/api/devices', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameras: W.devices.cameras }) });
    logE('DEVICE', 'info', null, 'CAMERA_ADDED', cam.name + ' → ' + cam.snapshot);
    APU.emit('devices', W.devices);
    return true;
  };

  W.snapshotURL = function (id) { return APU.online ? '/api/devices/snapshot/' + encodeURIComponent(id) : null; };

  /* generic LAN HTTP control — your own devices, normal APIs, no login bypass */
  W.toggleDevice = function (host, path, on) {
    if (!APU.online) { logE('DEVICE', 'warn', null, 'SERVICE_OFFLINE', 'device control needs the local service'); return Promise.resolve({ ok: false }); }
    logE('DEVICE', 'info', null, 'DEVICE_COMMAND', (on ? 'ON  ' : 'OFF ') + host + path);
    return fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://' + host + path }) }).then((r) => r.json()).catch(() => ({ ok: false }));
  };

  /* ---------------- boot ---------------- */
  APU.on('ready', function () {
    W.loadGithub();
    W.googleStatus();
    W.cameras();
  });

  logE('SYSTEM', 'info', null, 'WORLD_LINK', 'world module attached — github·google·lan devices');
})();
