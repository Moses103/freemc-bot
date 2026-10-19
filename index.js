const mineflayer = require('mineflayer');

// ---------------- Config ----------------
const HOST = 'stablesmp.playserver.pro';
const PORT = 33838;
const VERSION = '1.21.11';
const BOT_NAMES = ['God_Of_War', 'Wemmbu', 'SpokeIsHere', 'FlameFrags', 'NightingGale', 'ParrotX'];

const PHYSICS_DELAY = 10000;            // wait after spawn before moving
const MAX_RADIUS = 6;                   // how far a bot wanders from its spawn point
const MIN_INTERVAL = 1000;
const MAX_INTERVAL = 6000;
const PAUSE_EVERY = 60 * 60 * 1000;     // 1 hour
const PAUSE_FOR = 3 * 60 * 1000;        // 3 minutes
const LOGIN_TIMEOUT = 30000;

const HOUR = 3600 * 1000;
const WINDOW_H = 6;                     // each bot is online 6h per day
const WINDOW_MS = WINDOW_H * HOUR;
const MARGIN_MS = 5 * 60 * 1000;        // join 5 min early / leave 5 min late
const MIN_GAP_H = 2;                    // min gap between two bots' start times
const MAX_GAP_H = 5.5;                  // max gap between start times (guarantees coverage)

// ---------------- Helpers ----------------
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getActionInterval() {
  return rand(MIN_INTERVAL, MAX_INTERVAL);
}

function stopMoving(bot) {
  ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach((c) => {
    try { bot.setControlState(c, false); } catch (_) {}
  });
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

// The two bots that take the last two slots of a day (can run past midnight)
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

  // bots that closed yesterday may still be online after midnight, so they can't open today
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

// ---------------- Movement ----------------
// Looks at the cell ahead in a given direction (yaw) and reports what's there
function probe(bot, yaw, dist = 1.0) {
  const p = bot.entity.position;
  const at = p.offset(-Math.sin(yaw) * dist, 0, -Math.cos(yaw) * dist);
  const feet = bot.blockAt(at);
  const head = bot.blockAt(at.offset(0, 1, 0));
  const top = bot.blockAt(at.offset(0, 2, 0));
  const below1 = bot.blockAt(at.offset(0, -1, 0));
  const below2 = bot.blockAt(at.offset(0, -2, 0));
  const solid = (b) => b && b.boundingBox === 'block';
  const liquid = (b) => b && (b.name === 'water' || b.name === 'lava');

  const step = solid(feet) && !solid(head) && !solid(top);                    // one-block step to jump onto
  const blocked = solid(head) || (solid(feet) && solid(top));                 // wall or low ceiling
  const unsafe = liquid(feet) || liquid(below1) || (!solid(feet) && !solid(below1) && !solid(below2)); // liquid or 2+ drop
  return { blocked, step, unsafe };
}

// Picks a direction that isn't blocked or dangerous. Returns null if boxed in.
function pickHeading(bot, home, awayFrom) {
  const pos = bot.entity.position;
  const dist = Math.hypot(pos.x - home.x, pos.z - home.z);

  for (let i = 0; i < 14; i++) {
    let yaw;
    if (awayFrom !== undefined) {
      yaw = awayFrom + Math.PI + (Math.random() - 0.5) * Math.PI * 1.2;      // hit something: turn roughly around
    } else if (dist > MAX_RADIUS) {
      yaw = Math.atan2(-(home.x - pos.x), -(home.z - pos.z)) + (Math.random() - 0.5) * 0.8; // head back to spawn
    } else {
      yaw = Math.random() * Math.PI * 2 - Math.PI;
    }
    const pr = probe(bot, yaw);
    if (!pr.blocked && !pr.unsafe) return yaw;
  }
  return null;
}

function movementLoop(r, bot, home, awayFrom) {
  if (r.bot !== bot || !bot.entity) return;

  const yaw = pickHeading(bot, home, awayFrom);
  if (yaw === null) {
    // boxed in: turn to a random direction and try again shortly
    stopMoving(bot);
    bot.look(Math.random() * Math.PI * 2 - Math.PI, 0, true).catch(() => {});
    r.moveTimeout = setTimeout(() => movementLoop(r, bot, home), 800);
    return;
  }

  bot.look(yaw, 0, true).then(() => {
    if (r.bot !== bot || !bot.entity) return;
    stopMoving(bot);
    bot.setControlState('forward', true);
    if (Math.random() < 0.4) bot.setControlState('sprint', true);

    const endAt = Date.now() + getActionInterval();
    let last = bot.entity.position.clone();
    let still = 0;

    // Check the path every 0.4s while walking
    const watch = () => {
      if (r.bot !== bot || !bot.entity) return;

      if (Date.now() >= endAt) {
        movementLoop(r, bot, home);
        return;
      }

      const p = bot.entity.position;
      const moved = Math.hypot(p.x - last.x, p.z - last.z);
      last = p.clone();
      still = moved < 0.05 ? still + 1 : 0;

      const pr = probe(bot, bot.entity.yaw, 0.8);

      // wall, drop, or stuck for ~1s: turn away from this direction
      if (pr.blocked || pr.unsafe || still >= 2) {
        movementLoop(r, bot, home, bot.entity.yaw);
        return;
      }

      // one-block step ahead: jump onto it
      if (pr.step) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.entity && bot.setControlState('jump', false), 300);
      }

      r.moveTimeout = setTimeout(watch, 400);
    };
    r.moveTimeout = setTimeout(watch, 400);
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
    } catch (_) {}
    actionLoop(r, bot);
  }, getActionInterval());
}

function startActivity(r, bot, home) {
  movementLoop(r, bot, home);
  actionLoop(r, bot);
}

function pauseActivity(r, bot, home) {
  if (r.bot !== bot || !bot.entity) return;
  console.log(`[${r.name}] Pausing for ${PAUSE_FOR / 60000} min`);
  if (r.moveTimeout) clearTimeout(r.moveTimeout);
  if (r.actionTimeout) clearTimeout(r.actionTimeout);
  r.moveTimeout = r.actionTimeout = null;
  stopMoving(bot);

  r.resumeTimeout = setTimeout(() => {
    if (r.bot !== bot || !bot.entity) return;
    console.log(`[${r.name}] Resuming activity`);
    startActivity(r, bot, home);
  }, PAUSE_FOR);
}

// ---------------- Per-bot runner ----------------
const runners = new Map(); // name -> runner state

function clearActivity(r) {
  ['moveTimeout', 'actionTimeout', 'physicsTimeout', 'resumeTimeout', 'stableTimeout'].forEach((k) => {
    if (r[k]) { clearTimeout(r[k]); r[k] = null; }
  });
  if (r.pauseInterval) { clearInterval(r.pauseInterval); r.pauseInterval = null; }
}

function connectRunner(r) {
  if (r.stopped) return;

  console.log(`[${r.name}] Connecting to ${HOST}:${PORT}...`);

  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: r.name,
    version: VERSION,
    auth: 'offline',
    checkTimeoutInterval: 60 * 1000
  });
  r.bot = bot;
  r.loggedIn = false;
  r.movementOn = false;
  bot.physicsEnabled = false;

  const watchdog = setTimeout(() => {
    console.log(`[${r.name}] No login after ${LOGIN_TIMEOUT / 1000}s, retrying`);
    bot.end('login timeout');
  }, LOGIN_TIMEOUT);

  bot.once('login', () => {
    clearTimeout(watchdog);
    r.loggedIn = true;
    console.log(`[${r.name}] Logged in`);
  });

  // Keep physics off until movement is meant to start (spawn/respawn can turn it back on)
  bot.on('spawn', () => { if (!r.movementOn) bot.physicsEnabled = false; });

  bot.once('spawn', () => {
    console.log(`[${r.name}] Spawned`);
    clearActivity(r);

    // Only reset the reconnect backoff if the bot stays connected for a minute
    r.stableTimeout = setTimeout(() => { r.reconnectDelay = 10000; }, 60000);

    r.physicsTimeout = setTimeout(() => {
      if (r.bot !== bot || !bot.entity) return;
      const home = bot.entity.position.clone();
      r.movementOn = true;
      bot.physicsEnabled = true;
      console.log(`[${r.name}] Movement enabled`);
      startActivity(r, bot, home);
      r.pauseInterval = setInterval(() => pauseActivity(r, bot, home), PAUSE_EVERY);
    }, PHYSICS_DELAY);
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

function startRunner(name) {
  if (runners.has(name)) return;
  // Random 15-45s delay so bots never join the proxy at the same moment
  const delay = rand(15000, 45000);
  console.log(`[Scheduler] Starting ${name} (joining in ${Math.round(delay / 1000)}s)...`);

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
let shuttingDown = false;

function tick() {
  if (shuttingDown) return;
  const wanted = wantedNow();
  for (const name of BOT_NAMES) {
    if (wanted.has(name) && !runners.has(name)) startRunner(name);
    if (!wanted.has(name) && runners.has(name)) stopRunner(name);
  }
}

tick();
setInterval(tick, 30000);

// ---------------- Clean shutdown (redeploys) ----------------
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const name of [...runners.keys()]) stopRunner(name);
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
