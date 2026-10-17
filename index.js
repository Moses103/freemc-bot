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
const version = process.env.MC_VERSION || false;       // false = auto-detect
const auth = process.env.AUTH || 'offline';             // 'offline' or 'microsoft'
const serverPassword = process.env.BOT_PASSWORD || '';  // only if server uses /login
const enableMovement = process.env.ENABLE_MOVEMENT === 'true'; // jump/sneak/walk once in the real world

let afkTimeout = null;
let reconnectTimeout = null;
let reconnectDelay = 10000;

function clearTimers() {
  if (afkTimeout) clearTimeout(afkTimeout);
  afkTimeout = null;
}

function getRandomInt(min, max) {
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

// Anti-AFK: safe actions by default, movement only if ENABLE_MOVEMENT=true
function scheduleNextAfkAction(bot) {
  if (!bot || !bot.entity) return;

  afkTimeout = setTimeout(() => {
    if (!bot.entity) return;

    const maxAction = enableMovement ? 5 : 2;
    const actionType = getRandomInt(1, maxAction);

    try {
      switch (actionType) {
        case 1:
          bot.swingArm('right');
          console.log('[Anti-AFK] Swung arm');
          break;
        case 2:
          bot.setQuickBarSlot(getRandomInt(0, 8));
          console.log('[Anti-AFK] Switched hotbar slot');
          break;
        case 3:
          bot.setControlState('jump', true);
          setTimeout(() => bot.entity && bot.setControlState('jump', false), 400);
          console.log('[Anti-AFK] Jumped');
          break;
        case 4:
          bot.setControlState('sneak', true);
          setTimeout(() => bot.entity && bot.setControlState('sneak', false), 1000);
          console.log('[Anti-AFK] Crouched');
          break;
        case 5:
          bot.look(Math.random() * Math.PI * 2 - Math.PI, Math.random() * 0.6 - 0.3, true).catch(() => {});
          console.log('[Anti-AFK] Looked around');
          break;
      }
    } catch (err) {
      console.log('[Anti-AFK] Action failed:', err.message);
    }

    scheduleNextAfkAction(bot);
  }, getRandomInt(500, 1000));
}

async function createBot() {
  const { host, port } = await resolveTarget();
  console.log(`[Bot] Connecting to ${host}:${port} as ${username} (auth: ${auth})...`);

  mc.ping({ host, port }, (err, res) => {
    if (err) return console.error('[Ping] Failed:', err.code || err.message);
    console.log(`[Ping] Online. Version: ${res.version.name} (protocol ${res.version.protocol}), players: ${res.players.online}/${res.players.max}`);
  });

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version,
    auth,
    checkTimeoutInterval: 60 * 1000
  });

  // Keep physics off so the bot doesn't fall or send bad positions in a queue/limbo world
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
    console.log('[Bot] Spawned! Starting anti-AFK...');
    clearTimers();

    // Only turn physics on if movement is enabled, and only after the world has had time to load
    if (enableMovement) {
      setTimeout(() => {
        if (bot.entity) {
          bot.physicsEnabled = true;
          console.log('[Bot] Physics enabled');
        }
      }, 10000);
    }

    scheduleNextAfkAction(bot);
  });

  // Log queue/lobby messages to see where the bot actually is
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
