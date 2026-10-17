const mineflayer = require('mineflayer');
const mc = require('minecraft-protocol');
const dns = require('dns').promises;
const http = require('http');

// HTTP server for Railway health checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft Bot is operational.\n');
}).listen(PORT, () => console.log(`[HTTP] Listening on port ${PORT}`));

// Config
const domain = process.env.SERVER_HOST || 'stablesmp.playserver.pro';
const fallbackPort = parseInt(process.env.SERVER_PORT || '33838', 10);
const username = process.env.BOT_USERNAME || 'KeepALive';
const version = process.env.MC_VERSION || false;          // false = auto-detect
const auth = process.env.AUTH || 'offline';                // 'offline' or 'microsoft'
const serverPassword = process.env.BOT_PASSWORD || '';     // only if server uses /login
const enableMovement = process.env.MOVEMENT !== 'true';   // set MOVEMENT=false to disable
const physicsDelay = parseInt(process.env.PHYSICS_DELAY || '3000', 10); // wait before moving
const maxRadius = parseInt(process.env.MAX_RADIUS || '6', 10);           // stay near spawn
const actionInterval = parseInt(process.env.ACTION_INTERVAL || '4000', 10); // ms between actions

let moveTimeout = null;
let actionTimeout = null;
let physicsTimeout = null;
let reconnectTimeout = null;
let reconnectDelay = 10000;

function clearTimers() {
  [moveTimeout, actionTimeout, physicsTimeout].forEach((t) => t && clearTimeout(t));
  moveTimeout = actionTimeout = physicsTimeout = null;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function resolveTarget() {
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${domain}`);
    if (records.length) {
      const r = records.sort((a, b) => a.priority - b.priority)[0];
      console.log(`[DNS] SRV found: ${r.name}:${r.port}`);
      return { host: r.name, port: r.port };
    }
  } catch (e) {
    console.log(`[DNS] No SRV record (${e.code}), using ${domain}:${fallbackPort}`);
  }
  return { host: domain, port: fallbackPort };
}

function stopMoving(bot) {
  ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach((c) => {
    try { bot.setControlState(c, false); } catch (_) {}
  });
}

// True if the block ahead has a drop (2+ air blocks below) or liquid
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

// Movement loop: every tick pick a new heading and walk
function movementLoop(bot, home) {
  if (!bot.entity) return;

  const pos = bot.entity.position;
  const dist = Math.hypot(pos.x - home.x, pos.z - home.z);

  let yaw;
  if (dist > maxRadius) {
    // Too far from spawn: face home and walk back
    yaw = Math.atan2(-(home.x - pos.x), -(home.z - pos.z));
  } else {
    yaw = Math.random() * Math.PI * 2 - Math.PI;
  }

  bot.look(yaw, 0, true).then(() => {
    if (!bot.entity) return;
    stopMoving(bot);

    if (isUnsafeAhead(bot)) {
      console.log('[Move] Unsafe ahead, picking a new direction');
      moveTimeout = setTimeout(() => movementLoop(bot, home), 300);
      return;
    }

    bot.setControlState('forward', true);
    if (Math.random() < 0.4) bot.setControlState('sprint', true);
    console.log(`[Move] Walking (${dist.toFixed(1)} blocks from spawn)`);

    moveTimeout = setTimeout(() => movementLoop(bot, home), actionInterval);
  }).catch(() => {
    moveTimeout = setTimeout(() => movementLoop(bot, home), 1000);
  });
}

// Random action every tick: jump, hotbar swap, arm swing, or short sneak
function actionLoop(bot) {
  if (!bot.entity) return;

  actionTimeout = setTimeout(() => {
    if (!bot.entity) return;
    try {
      const a = rand(1, 4);
      if (a === 1) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.entity && bot.setControlState('jump', false), 400);
        console.log('[Action] Jumped');
      } else if (a === 2) {
        bot.setQuickBarSlot(rand(0, 8));
        console.log('[Action] Switched hotbar slot');
      } else if (a === 3) {
        bot.swingArm('right');
        console.log('[Action] Swung arm');
      } else {
        bot.setControlState('sneak', true);
        setTimeout(() => bot.entity && bot.setControlState('sneak', false), 800);
        console.log('[Action] Crouched');
      }
    } catch (err) {
      console.log('[Action] Failed:', err.message);
    }
    actionLoop(bot);
  }, actionInterval);
}

async function createBot() {
  const { host, port } = await resolveTarget();
  console.log(`[Bot] Connecting to ${host}:${port} as ${username} (auth: ${auth})...`);

  mc.ping({ host, port }, (err, res) => {
    if (err) return console.error('[Ping] Failed:', err.code || err.message);
    console.log(`[Ping] Online. Version: ${res.version.name}, players: ${res.players.online}/${res.players.max}`);
  });

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version,
    auth,
    checkTimeoutInterval: 60 * 1000
  });

  // Physics stays off until the bot is settled in a loaded world
  bot.physicsEnabled = false;

  bot._client.on('connect', () => console.log('[Bot] TCP connected'));

  const watchdog = setTimeout(() => {
    console.log('[Bot] No login after 30s, forcing reconnect');
    bot.end('login timeout');
  }, 30000);

  bot.once('login', () => {
    clearTimeout(watchdog);
    console.log(`[Bot] Logged in as ${username}`);
    reconnectDelay = 10000;
  });

  if (serverPassword) {
    bot.on('messagestr', (msg) => {
      const m = msg.toLowerCase();
      if (m.includes('/register')) bot.chat(`/register ${serverPassword} ${serverPassword}`);
      else if (m.includes('/login')) bot.chat(`/login ${serverPassword}`);
    });
  }

  bot.once('spawn', () => {
    console.log('[Bot] Spawned!');
    clearTimers();

    if (!enableMovement) {
      actionLoop(bot);
      return;
    }

    console.log(`[Bot] Waiting ${physicsDelay / 1000}s before enabling movement...`);
    physicsTimeout = setTimeout(() => {
      if (!bot.entity) return;
      const home = bot.entity.position.clone();
      bot.physicsEnabled = true;
      console.log(`[Bot] Movement enabled, home at ${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)}`);
      movementLoop(bot, home);
      actionLoop(bot);
    }, physicsDelay);
  });

  // Log chat/queue messages
  bot.on('messagestr', (msg) => {
    if (msg.trim()) console.log('[Chat]', msg);
  });

  bot.on('kicked', (reason) => console.log('[Bot] Kicked:', JSON.stringify(reason)));
  bot.on('error', (err) => console.error('[Bot] Error:', err.message || err));

  bot.once('end', (reason) => {
    clearTimeout(watchdog);
    console.log(`[Bot] Disconnected (${reason}). Reconnecting in ${reconnectDelay / 1000}s...`);
    clearTimers();
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(createBot, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 120000);
  });
}

createBot();
