const mineflayer = require('mineflayer');
const mc = require('minecraft-protocol');
const dns = require('dns').promises;
const http = require('http');

// HTTP server for Railway health checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft Bots are operational.\n');
}).listen(PORT, () => console.log(`[HTTP] Listening on port ${PORT}`));

// ---------------- Config ----------------
const domain = process.env.SERVER_HOST || 'stablesmp.playserver.pro';
const fallbackPort = parseInt(process.env.SERVER_PORT || '33838', 10);
const BOT_NAMES = (process.env.BOT_NAMES || 'God_Of_War,Wemmbu,SpokeIsHere,FlameFrags,NightingGale,ParrotX')
  .split(',').map((s) => s.trim()).filter(Boolean);
const version = process.env.MC_VERSION || false;          // false = use the server's real version when known
const auth = process.env.AUTH || 'offline';
const serverPassword = process.env.BOT_PASSWORD || '';    // only if server uses /login
const enableMovement = process.env.MOVEMENT !== 'false';
const physicsDelay = parseInt(process.env.PHYSICS_DELAY || '10000', 10);
const maxRadius = parseInt(process.env.MAX_RADIUS || '6', 10);
const minInterval = parseInt(process.env.MIN_INTERVAL || '1000', 10);
const maxInterval = parseInt(process.env.MAX_INTERVAL || '6000', 10);
const pauseEvery = parseInt(process.env.PAUSE_EVERY || String(60 * 60 * 1000), 10); // 1 hour
const pauseFor = parseInt(process.env.PAUSE_FOR || String(3 * 60 * 1000), 10);      // 3 minutes
const joinJitter = parseInt(process.env.JOIN_JITTER || String(3 * 60 * 1000), 10);  // random 0-3 min delay when joining

// Waiting for the server to start
const waitForServerOn = process.env.WAIT_FOR_SERVER !== 'false'; // set false to join without checking
const checkInterval = parseInt(process.env.CHECK_INTERVAL || '30000', 10);
const readyDelay = parseInt(process.env.READY_DELAY || '5000', 10);
const maxPingTimeouts = parseInt(process.env.MAX_PING_TIMEOUTS || '3', 10); // join anyway after this many timeouts in a row

const HOUR = 3600 * 1000;
const WINDOW_H = 6;                         // each bot is online 6h per day
const WINDOW_MS = WINDOW_H * HOUR;
const MARGIN_MS = 5 * 60 * 1000;            // join 5 min early / leave 5 min late for overlap
const MIN_GAP_H = 2;                        // min time between two bots' start times
const MAX_GAP_H = 5.5;                      // max gap between start times (guarantees coverage)

if (BOT_NAMES.length < 5) {
  console.warn('[Config] Need at least 5 bots to cover 24h with 6h windows!');
}

// Random interval, picked fresh every time it's used
function getActionInterval() {
  return Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
}

// ---------------- Daily schedule (UTC) ----------------
function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seededRng = (label) => mulberry32(hashStr(label));
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Hours after 00:00 UTC when the first window of a day starts (0 - 1.5h, random per day)
function firstStartHours(dayStartMs) {
  return seededRng('first:' + dayKey(dayStartMs))() * 1.5;
}

// The two bots that take the last two slots of a day (these windows can run past midnight)
function closersOf(dayStartMs) {
  const rng = seededRng('closers:' + dayKey(dayStartMs));
  return shuffle(BOT_NAMES, rng).slice(0, 2);
}

const scheduleCache = new Map();

function getDaySchedule(dayStartMs) {
  const key = dayKey(dayStartMs);
  if (scheduleCache.has(key)) return scheduleCache.get(key);

  const rng = seededRng('day:' + key);
  const n = BOT_NAMES.length;

  const f = firstStartHours(dayStartMs);
  const fNext = firstStartHours(dayStartMs + 24 * HOUR);
  const lMin = 24 - WINDOW_H + fNext + 0.25;   // last window must still be running when the next day starts
  const l = lMin + rng() * 1.5;

  let starts = null;
  for (let attempt = 0; attempt < 20000 && !starts; attempt++) {
    const mids = [];
    for (let i = 0; i < n - 2; i++) mids.push(f + rng() * (l - f));
    const cand = [f, ...mids.sort((a, b) => a - b), l];
    let ok = true;
    for (let i = 1; i < cand.length; i++) {
      const gap = cand[i] - cand[i - 1];
      if (gap < MIN_GAP_H || gap > MAX_GAP_H) { ok = false; break; }
    }
    if (ok) starts = cand;
  }
  if (!starts) starts = Array.from({ length: n }, (_, i) => f + ((l - f) * i) / (n - 1));

  const closers = closersOf(dayStartMs);
  const prevClosers = closersOf(dayStartMs - 24 * HOUR);
  const pool = shuffle(BOT_NAMES.filter((x) => !closers.includes(x)), rng);

  // the bots that closed yesterday may still be online after midnight, so they can't open today
  if (prevClosers.includes(pool[0])) {
    const k = pool.findIndex((x) => !prevClosers.includes(x));
    if (k > 0) [pool[0], pool[k]] = [pool[k], pool[0]];
  }
  const names = [...pool, ...closers];

  const windows = names.map((name, i) => ({
    name,
    start: dayStartMs + starts[i] * HOUR,
    end: dayStartMs + starts[i] * HOUR + WINDOW_MS
  }));
  scheduleCache.set(key, windows);

  const fmt = (ms) => new Date(ms).toISOString().slice(11, 16);
  console.log(`[Schedule] ${key} (UTC): ` + windows.map((w) => `${w.name} ${fmt(w.start)}-${fmt(w.end)}`).join(' | '));
  return windows;
}

function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function wantedNow() {
  const now = Date.now();
  const today = utcDayStart(now);
  const wanted = new Set();
  for (const dayStart of [today - 24 * HOUR, today, today + 24 * HOUR]) {
    for (const w of getDaySchedule(dayStart)) {
      if (now >= w.start - MARGIN_MS && now <= w.end + MARGIN_MS) wanted.add(w.name);
    }
  }
  return wanted;
}

// ---------------- Helpers ----------------
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveTarget() {
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${domain}`);
    if (records.length) {
      const r = records.sort((a, b) => a.priority - b.priority)[0];
      console.log(`[DNS] SRV record found: ${r.name}:${r.port}`);
      return { host: r.name, port: r.port };
    }
  } catch (e) {
    console.log(`[DNS] No SRV record (${e.code}), using ${domain}:${fallbackPort}`);
  }
  return { host: domain, port: fallbackPort };
}
// ---------------- Server status check ----------------
let serverReady = false; // last known state, used by the scheduler

function pingServer(host, port) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ready: false, text: 'ping timeout' }), 10000);
    mc.ping({ host, port }, (err, res) => {
      clearTimeout(timer);
      if (err || !res) return resolve({ ready: false, text: `unreachable (${err ? err.code || err.message : 'no response'})` });

      const raw = (res.version && res.version.name) || '';
      const text = raw.replace(/§./g, '').trim() || 'no status';
      const protocol = res.version ? res.version.protocol : -1;
      // Placeholder statuses (Sleeping, Queued, Starting...) use protocol -1
      const placeholder = protocol <= 0 || /sleep|queue|start|offline|stopp|wait|load|hibern/i.test(text);
      const m = text.match(/\d+\.\d+(?:\.\d+)?/);
      resolve({
        ready: !placeholder,
        mcVersion: m ? m[0] : null,
        text: `${text} (protocol ${protocol}, players ${res.players.online}/${res.players.max})`
      });
    });
  });
}

// Blocks until the server is up (or the ping keeps timing out); returns the target to connect to
async function waitForServer(r) {
  let lastText = null;
  let lastLog = 0;
  let timeouts = 0;

  while (!r.stopped) {
    const { host, port } = await resolveTarget();
    if (!waitForServerOn) return { host, port, mcVersion: null };

    const status = await pingServer(host, port);
    serverReady = status.ready;

    // Repeated ping timeouts usually mean the status port is slow, not that the server is off
    timeouts = status.text.startsWith('ping timeout') ? timeouts + 1 : 0;
    if (timeouts >= maxPingTimeouts) {
      console.log(`[${r.name}] Ping timed out ${timeouts} times, trying to join anyway`);
      return { host, port, mcVersion: null };
    }

    if (status.ready) {
      if (lastText !== null) console.log(`[${r.name}] Server is up (${status.text}). Joining in ${readyDelay / 1000}s...`);
      await sleep(readyDelay);
      if (r.stopped) return null;
      const again = await pingServer(host, port);
      serverReady = again.ready;
      if (again.ready) return { host, port, mcVersion: again.mcVersion };
      continue;
    }

    if (status.text !== lastText || Date.now() - lastLog > 5 * 60 * 1000) {
      console.log(`[${r.name}] Waiting for server... status: ${status.text}`);
      lastText = status.text;
      lastLog = Date.now();
    }
    await sleep(checkInterval);
  }
  return null;
}

function stopMoving(bot) {
  ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach((c) => {
    try { bot.setControlState(c, false); } catch (_) {}
  });
}

function isUnsafeAhead(bot) {
  const pos = bot.entity.position;
  const yaw = bot.entity.yaw;
  const ahead = pos.offset(-Math.sin(yaw) * 1.2, 0, -Math.cos(yaw) * 1.2);
  const below1 = bot.blockAt(ahead.offset(0, -1, 0));
  const below2 = bot.blockAt(ahead.offset(0, -2, 0));
  const feet = bot.blockAt(ahead);
  const liquid = (b) => b && (b.name === 'water' || b.name === 'lava');
  if (liquid(feet) || liquid(below1)) return true;
  return below1 && below2 && below1.name === 'air' && below2.name === 'air';
}

// ---------------- Per-bot runner ----------------
const runners = new Map(); // name -> runner state
let emergencyName = null;

function clearActivity(r) {
  ['moveTimeout', 'actionTimeout', 'physicsTimeout', 'resumeTimeout', 'stableTimeout'].forEach((k) => {
    if (r[k]) { clearTimeout(r[k]); r[k] = null; }
  });
  if (r.pauseInterval) { clearInterval(r.pauseInterval); r.pauseInterval = null; }
}

function movementLoop(r, bot, home) {
  if (r.bot !== bot || !bot.entity) return;

  const pos = bot.entity.position;
  const dist = Math.hypot(pos.x - home.x, pos.z - home.z);
  const yaw = dist > maxRadius
    ? Math.atan2(-(home.x - pos.x), -(home.z - pos.z))
    : Math.random() * Math.PI * 2 - Math.PI;

  bot.look(yaw, 0, true).then(() => {
    if (r.bot !== bot || !bot.entity) return;
    stopMoving(bot);

    if (isUnsafeAhead(bot)) {
      r.moveTimeout = setTimeout(() => movementLoop(r, bot, home), 300);
      return;
    }

    bot.setControlState('forward', true);
    if (Math.random() < 0.4) bot.setControlState('sprint', true);
    r.moveTimeout = setTimeout(() => movementLoop(r, bot, home), getActionInterval());
  }).catch(() => {
    r.moveTimeout = setTimeout(() => movementLoop(r, bot, home), 1000);
  });
}

function actionLoop(r, bot) {
  if (r.bot !== bot || !bot.entity) return;

  r.actionTimeout = setTimeout(() => {
    if (r.bot !== bot || !bot.entity) return;
    try {
      const a = rand(1, 4);
      if (a === 1) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.entity && bot.setControlState('jump', false), 400);
      } else if (a === 2) {
        bot.setQuickBarSlot(rand(0, 8));
      } else if (a === 3) {
        bot.swingArm('right');
      } else {
        bot.setControlState('sneak', true);
        setTimeout(() => bot.entity && bot.setControlState('sneak', false), 800);
      }
    } catch (err) {
      console.log(`[${r.name}] Action failed:`, err.message);
    }
    actionLoop(r, bot);
  }, getActionInterval());
}

function startActivity(r, bot, home) {
  if (enableMovement && home) movementLoop(r, bot, home);
  actionLoop(r, bot);
}

function pauseActivity(r, bot, home) {
  if (r.bot !== bot || !bot.entity) return;
  console.log(`[${r.name}] Pausing for ${pauseFor / 60000} min`);
  if (r.moveTimeout) clearTimeout(r.moveTimeout);
  if (r.actionTimeout) clearTimeout(r.actionTimeout);
  r.moveTimeout = r.actionTimeout = null;
  stopMoving(bot);

  r.resumeTimeout = setTimeout(() => {
    if (r.bot !== bot || !bot.entity) return;
    console.log(`[${r.name}] Resuming activity`);
    startActivity(r, bot, home);
  }, pauseFor);
}

async function connectRunner(r) {
  if (r.stopped) return;

  // Wait here until the server is online
  const target = await waitForServer(r);
  if (!target || r.stopped) return;
  const { host, port } = target;
  const useVersion = version || target.mcVersion || false;
  console.log(`[${r.name}] Connecting to ${host}:${port} (version: ${useVersion || 'auto'})...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username: r.name,
    version: useVersion,
    auth,
    checkTimeoutInterval: 60 * 1000
  });
  r.bot = bot;
  r.loggedIn = false;
  r.movementOn = false;
  bot.physicsEnabled = false;

  const watchdog = setTimeout(() => {
    console.log(`[${r.name}] No login after 30s, retrying`);
    bot.end('login timeout');
  }, 30000);

  bot.once('login', () => {
    clearTimeout(watchdog);
    r.loggedIn = true;
    console.log(`[${r.name}] Logged in`);
  });

  // Keep physics off until movement is meant to start (spawn/respawn can turn it back on)
  bot.on('spawn', () => { if (!r.movementOn) bot.physicsEnabled = false; });

  if (serverPassword) {
    bot.on('messagestr', (msg) => {
      const m = msg.toLowerCase();
      if (m.includes('/register')) bot.chat(`/register ${serverPassword} ${serverPassword}`);
      else if (m.includes('/login')) bot.chat(`/login ${serverPassword}`);
    });
  }

  // Log server messages (queue notices, plugin messages)
  bot.on('messagestr', (msg) => {
    if (msg.trim()) console.log(`[${r.name}] [Chat]`, msg);
  });

  bot.once('spawn', () => {
    console.log(`[${r.name}] Spawned`);
    clearActivity(r);

    // Only reset the reconnect backoff if the bot stays connected for a minute
    r.stableTimeout = setTimeout(() => { r.reconnectDelay = 10000; }, 60000);

    const begin = (home) => {
      startActivity(r, bot, home);
      r.pauseInterval = setInterval(() => pauseActivity(r, bot, home), pauseEvery);
    };

    if (!enableMovement) return begin(null);

    r.physicsTimeout = setTimeout(() => {
      if (r.bot !== bot || !bot.entity) return;
      const home = bot.entity.position.clone();
      r.movementOn = true;
      bot.physicsEnabled = true;
      console.log(`[${r.name}] Movement enabled`);
      begin(home);
    }, physicsDelay);
  });

  bot.on('kicked', (reason) => console.log(`[${r.name}] Kicked:`, JSON.stringify(reason)));
  bot.on('error', (err) => console.error(`[${r.name}] Error:`, err.message || err));

  bot.once('end', (reason) => {
    clearTimeout(watchdog);
    clearActivity(r);
    r.loggedIn = false;
    if (r.stopped) {
      console.log(`[${r.name}] Disconnected (window over)`);
      return;
    }
    console.log(`[${r.name}] Disconnected (${reason}). Reconnecting in ${r.reconnectDelay / 1000}s...`);
    r.reconnectTimeout = setTimeout(() => connectRunner(r), r.reconnectDelay);
    r.reconnectDelay = Math.min(r.reconnectDelay * 2, 120000);
  });
}

function startRunner(name, immediate = false) {
  if (runners.has(name)) return;
  const delay = immediate ? 0 : rand(0, joinJitter);
  console.log(`[Scheduler] Starting ${name}${delay ? ` (joining in ${Math.round(delay / 1000)}s)` : ''}`);
  const r = {
    name, bot: null, loggedIn: false, stopped: false, reconnectDelay: 10000, movementOn: false,
    moveTimeout: null, actionTimeout: null, physicsTimeout: null,
    resumeTimeout: null, pauseInterval: null, reconnectTimeout: null,
    stableTimeout: null, startTimeout: null
  };
  runners.set(name, r);
  r.startTimeout = setTimeout(() => connectRunner(r), delay);
}

function stopRunner(name) {
  const r = runners.get(name);
  if (!r) return;
  console.log(`[Scheduler] Stopping ${name}`);
  r.stopped = true;
  clearActivity(r);
  if (r.startTimeout) clearTimeout(r.startTimeout);
  if (r.reconnectTimeout) clearTimeout(r.reconnectTimeout);
  try { if (r.bot) r.bot.quit('window over'); } catch (_) {}
  runners.delete(name);
}

// ---------------- Scheduler ----------------
let noneOnlineSince = null;

function tick() {
  const wanted = wantedNow();

  const loggedIn = [...runners.values()].filter((r) => r.loggedIn).map((r) => r.name);
  const scheduledOnline = loggedIn.some((n) => wanted.has(n));

  // Safety net: if the server is up but nobody is online for 2+ minutes, add a backup bot.
  if (loggedIn.length === 0 && serverReady) {
    if (!noneOnlineSince) noneOnlineSince = Date.now();
    if (!emergencyName && Date.now() - noneOnlineSince > 120000) {
      const spare = BOT_NAMES.filter((n) => !wanted.has(n));
      if (spare.length) {
        emergencyName = spare[rand(0, spare.length - 1)];
        console.log(`[Scheduler] Nobody online, bringing in ${emergencyName} as backup`);
      }
    }
  } else {
    noneOnlineSince = null;
  }
  if (emergencyName && scheduledOnline) {
    console.log(`[Scheduler] Scheduled bot is back, releasing backup ${emergencyName}`);
    emergencyName = null;
  }
  if (emergencyName) wanted.add(emergencyName);

  for (const name of BOT_NAMES) {
    if (wanted.has(name) && !runners.has(name)) startRunner(name, name === emergencyName);
    if (!wanted.has(name) && runners.has(name)) stopRunner(name);
  }
}

console.log(`[Scheduler] Bots: ${BOT_NAMES.join(', ')}`);
tick();
setInterval(tick, 30000);
