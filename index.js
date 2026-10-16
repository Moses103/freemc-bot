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
const username = process.env.BOT_USERNAME || 'KeepAlive';
const version = process.env.MC_VERSION || false;       // false = auto-detect
const auth = process.env.AUTH || 'offline';             // 'offline' or 'microsoft'
const serverPassword = process.env.BOT_PASSWORD || '';  // only if server uses /login

let crouchInterval = null;
let jumpInterval = null;
let reconnectTimeout = null;
let reconnectDelay = 10000;

function clearTimers() {
  if (crouchInterval) clearInterval(crouchInterval);
  if (jumpInterval) clearInterval(jumpInterval);
  crouchInterval = jumpInterval = null;
}

// Resolve the real connection target (SRV first, then plain domain)
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
    console.log('[Bot] Spawned! Starting anti-AFK timers...');
    clearTimers();

    crouchInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('sneak', true);
      setTimeout(() => bot.entity && bot.setControlState('sneak', false), 1000);
    }, 10000);

    jumpInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => bot.entity && bot.setControlState('jump', false), 500);
    }, 15000);
  });

  bot.on('kicked', (reason) => console.log('[Bot] Kicked:', JSON.stringify(reason)));
  bot.on('error', (err) => console.error('[Bot] Error:', err.message || err));

  bot.once('end', (reason) => {
    clearTimeout(watchdog);
    console.log(`[Bot] Disconnected (${reason}). Reconnecting in ${reconnectDelay / 1000}s...`);
    clearTimers();
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(createBot, reconnectDelay);
