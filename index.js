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
  try {
    const addrs = await dns.resolve4(domain);
    console.log(`[DNS] ${domain} -> ${addrs.join(', ')}`);
  } catch (e) {
    console.log(`[DNS] A lookup failed: ${e.code}`);
  }
  return { host: domain, port: fallbackPort };
}

// Expanded Anti-AFK Engine with Hit, Use Item, and Mine capabilities
function scheduleNextAfkAction(bot) {
  if (!bot || !bot.entity) return;

  // Schedule the next action between 5 and 15 seconds
  const nextDelay = getRandomInt(500, 1000);

  afkTimeout = setTimeout(async () => {
    if (!bot.entity) return;

    const actionType = getRandomInt(1, 8);

    switch (actionType) {
      case 1: {
        // Look around in a random direction
        const yaw = (Math.random() * Math.PI * 2) - Math.PI;
        const pitch = (Math.random() * 0.8) - 0.4;
        await bot.look(yaw, pitch, true).catch(() => {});
        console.log('[Anti-AFK] Looked around');
        break;
      }

      case 2: {
        // Jump briefly
        bot.setControlState('jump', true);
        setTimeout(() => bot.entity && bot.setControlState('jump', false), getRandomInt(300, 600));
        console.log('[Anti-AFK] Jumped');
        break;
      }

      case 3: {
        // Crouch briefly
        bot.setControlState('sneak', true);
        setTimeout(() => bot.entity && bot.setControlState('sneak', false), getRandomInt(800, 2000));
        console.log('[Anti-AFK] Crouched');
        break;
      }

      case 4: {
        // Move in a short burst
        const direction = Math.random() > 0.5 ? 'forward' : 'back';
        bot.setControlState(direction, true);
        setTimeout(() => {
          if (bot.entity) bot.setControlState(direction, false);
        }, getRandomInt(400, 1000));
        console.log(`[Anti-AFK] Moved ${direction}`);
        break;
      }

      case 5: {
        // Swing arm / Hit attack
        // If an entity is nearby, hit it; otherwise swing arm into the air
        const filter = (e) => e.type === 'mob' || e.type === 'player';
        const target = bot.nearestEntity(filter);
        if (target && bot.entity.position.distanceTo(target.position) < 3.5) {
          bot.attack(target);
          console.log(`[Anti-AFK] Attacked entity (${target.name || target.username})`);
        } else {
          bot.swingArm('right');
          console.log('[Anti-AFK] Swung arm / Hit air');
        }
        break;
      }

      case 6: {
        // Use / Right-click held item (e.g. food, shield, bow, or tool)
        try {
          bot.activateItem();
          console.log('[Anti-AFK] Used held item');
          setTimeout(() => {
            if (bot.entity) bot.deactivateItem();
          }, 1000);
        } catch (err) {
          bot.swingArm('right');
        }
        break;
      }

      case 7: {
        // Mine a block in front of or below the bot
        const blockInFront = bot.blockAt(bot.entity.position.offset(0, 0, 1)) || bot.blockAt(bot.entity.position.offset(0, -1, 0));
        
        if (blockInFront && blockInFront.name !== 'air' && blockInFront.name !== 'bedrock') {
          try {
            console.log(`[Anti-AFK] Mining block: ${blockInFront.name}`);
            await bot.dig(blockInFront, 'ignore');
          } catch (err) {
            console.log('[Anti-AFK] Mining attempt interrupted or not breakable');
          }
        } else {
          bot.swingArm('right');
          console.log('[Anti-AFK] Punched block in range');
        }
        break;
      }

      case 8: {
        // Switch main hand hotbar slot randomly (0 to 8)
        const randomSlot = getRandomInt(0, 8);
        bot.setQuickBarSlot(randomSlot);
        console.log(`[Anti-AFK] Switched hotbar to slot ${randomSlot}`);
        break;
      }
    }

    // Schedule next iteration
    scheduleNextAfkAction(bot);
  }, nextDelay);
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
    console.log('[Bot] Spawned! Starting advanced anti-AFK engine...');
    clearTimers();
    scheduleNextAfkAction(bot);
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
