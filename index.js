const mineflayer = require('mineflayer');
const http = require('http');

// HTTP server for Railway health checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft Bot is operational.\n');
}).listen(PORT, () => console.log(`[HTTP] Listening on port ${PORT}`));

// Config
const host = process.env.SERVER_HOST || 'stablesmp.playserver.pro';
const port = parseInt(process.env.SERVER_PORT || '33838', 10);
const username = process.env.BOT_USERNAME || 'KeepALive';
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

function createBot() {
  console.log(`[Bot] Connecting to ${host}:${port} as ${username} (auth: ${auth})...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version,
    auth,
    checkTimeoutInterval: 60 * 1000
  });

  bot.once('login', () => {
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
    console.log(`[Bot] Disconnected (${reason}). Reconnecting in ${reconnectDelay / 1000}s...`);
    clearTimers();
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(createBot, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 120000);
  });
}

createBot();
