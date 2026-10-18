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
const BOT_NAMES = (process.env.BOT_NAMES || 'God_Of_War,Wemmbu,SpokeIsHere,FlameFrags,NightingGale')
  .split(',').map((s) => s.trim()).filter(Boolean);
const version = process.env.MC_VERSION || false;          // false = auto-detect
const auth = process.env.AUTH || 'offline';
const serverPassword = process.env.BOT_PASSWORD || '';    // only if server uses /login
const enableMovement = process.env.MOVEMENT !== 'false';
const physicsDelay = parseInt(process.env.PHYSICS_DELAY || '10000', 10);
const maxRadius = parseInt(process.env.MAX_RADIUS || '6', 10);
const minInterval = parseInt(process.env.MIN_INTERVAL || '1000', 10); 
const maxInterval = parseInt(process.env.MAX_INTERVAL || '6000', 10); 
const actionInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
const pauseEvery = parseInt(process.env.PAUSE_EVERY || String(60 * 60 * 1000), 10); // 1 hour
const pauseFor = parseInt(process.env.PAUSE_FOR || String(3 * 60 * 1000), 10);      // 5 minutes

// Waiting for the server to start
const waitForServerOn = process.env.WAIT_FOR_SERVER !== 'false'; // set false to join without checking
const checkInterval = parseInt(process.env.CHECK_INTERVAL || '30000', 10); // ping every 30s while waiting
const readyDelay = parseInt(process.env.READY_DELAY || '5000', 10);       // extra wait after it's ready

const HOUR = 3600 * 1000;
const WINDOW_MS = 6 * HOUR;                 // each bot is online 6h per day
const MARGIN_MS = 5 * 60 * 1000;            // join 5 min early / leave 5 min late for overlap
const MAX_GAP_H = 5.5;                      // max gap between window starts (guarantees coverage)

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

const scheduleCache = new Map();

function getDaySchedule(dayStartMs) {
  const key = new Date(dayStartMs).toISOString().slice(0, 10);
  if (scheduleCache.has(key)) return scheduleCache.get(key);

  const rng = mulberry32(hashStr(key));

  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const n = names.length;
  const lastStart = 24 - 6;
  let starts;
  for (let attempt = 0; attempt < 10000; attempt++) {
    const mids = [];
    for (let i = 0; i < n - 2; i++) mids.push(rng() * lastStart);
    starts = [0, ...mids.sort((a, b) => a - b), lastStart];
    let ok = true;
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] - starts[i - 1] > MAX_GAP_H) { ok = false; break; }
    }
    if (ok) break;
    starts = null;
  }
  if (!starts) {
    starts = names.map((_, i) => (lastStart / (n - 1)) * i);
  }

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
      return { host: r.name, port: r.port };
    }
  } catch (e) { /* no SRV, use fallback */ }
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
      resolve({ ready: !placeholder, text: `${text} (protocol ${protocol}, players ${res.players.online}/${res.players.max})` });
    });
  });
}

// Blocks until the real server is up; returns the target to connect to
async function waitForServer(r) {
  let lastText = null;
  let lastLog = 0;

  while (!r.stopped) {
    const { host, port } = await resolveTarget();
    if (!waitForServerOn) return { host, port };

    const status = await pingServer(host, port);
    serverReady = status.ready;

    if (status.ready) {
      if (lastText !== null) console.log(`[${r.name}] Server is up (${status.text}). Joining in ${readyDelay / 1000}s...`);
      await sleep(readyDelay);
      if (r.stopped) return null;
      // Re-check once more so we don't join right as it goes back to sleep
      const again = await pingServer(host, port);
      serverReady = again.ready;
      if (again.ready) return { host, port };
      continue;
    }

    // Log when the status changes, or every 5 minutes
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
    r.moveTimeout = setTimeout(() => movementLoop(r, bot, home), actionInterval);
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
  }, actionInterval);
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

  // Wait here until the real server is online
  const target = await waitForServer(r);
  if (!target || r.stopped) return;
  const { host, port } = target;
  console.log(`[${r.name}] Connecting to ${host}:${port}...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username: r.name,
    version,
    auth,
    checkTimeoutInterval: 60 * 1000
  });
  r.bot = bot;
  r.loggedIn = false;
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

  if (serverPassword) {
    bot.on('messagestr', (msg) => {
      const m = msg.toLowerCase();
      if (m.includes('/register')) bot.chat(`/register ${serverPassword} ${serverPassword}`);
      else if (m.includes('/login')) bot.chat(`/login ${serverPassword}`);
    });
  }

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
    // After a disconnect, connectRunner waits for the server again before rejoining
    console.log(`[${r.name}] Disconnected (${reason}). Reconnecting in ${r.reconnectDelay / 1000}s...`);
    r.reconnectTimeout = setTimeout(() => connectRunner(r), r.reconnectDelay);
    r.reconnectDelay = Math.min(r.reconnectDelay * 2, 120000);
  });
}

function startRunner(name) {
  if (runners.has(name)) return;
  console.log(`[Scheduler] Starting ${name}`);
  const r = {
    name, bot: null, loggedIn: false, stopped: false, reconnectDelay: 10000,
    moveTimeout: null, actionTimeout: null, physicsTimeout: null,
    resumeTimeout: null, pauseInterval: null, reconnectTimeout: null, stableTimeout: null
  };
  runners.set(name, r);
  connectRunner(r);
}

function stopRunner(name) {
  const r = runners.get(name);
  if (!r) return;
  console.log(`[Scheduler] Stopping ${name}`);
  r.stopped = true;
  clearActivity(r);
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
  // Skipped while the server itself is down, since a backup couldn't join anyway.
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
    if (wanted.has(name) && !runners.has(name)) startRunner(name);
    if (!wanted.has(name) && runners.has(name)) stopRunner(name);
  }
}

console.log(`[Scheduler] Bots: ${BOT_NAMES.join(', ')}`);
tick();
setInterval(tick, 30000);
