const mineflayer = require('mineflayer');
const https = require('https');

// Use the domain directly instead of hardcoded numeric IPs
const MC_HOST = process.env.MC_HOST || 'stablesmp.playserver.pro';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;
const MC_VERSION = process.env.MC_VERSION || '1.21.1';

const PANEL_DOMAIN = 'www.powerupstack.com';
const INSTANCE_PATH = '/panel/instances/01a1424f-1513-78f6-894d-728833e3fdb5/console';

let useWebFallback = false;

function pingPowerupStackWeb() {
  const options = {
    hostname: PANEL_DOMAIN,
    port: 443,
    path: INSTANCE_PATH,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`[PowerupStack Web Ping] Ping sent! HTTP Status: ${res.statusCode}`);
  });

  req.on('error', (err) => {
    console.error('[PowerupStack Web Ping] Error:', err.message);
  });

  req.end();
}

function createBot() {
  if (useWebFallback) {
    pingPowerupStackWeb();
    return;
  }

  console.log(`[Connect Attempt] Resolving domain ${MC_HOST}:${MC_PORT} (Version: ${MC_VERSION})...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAliveBot',
    auth: 'offline',
    version: MC_VERSION,
    family: 4, // Forces DNS lookup to resolve the domain to IPv4
    connectTimeout: 30000, // Extends connection timeout window to 30 seconds
    checkTimeoutInterval: 60 * 1000
  });

  // Ignore non-fatal packet decoding errors (e.g., PartialReadError)
  bot._client.on('error', (err) => {
    if (err.name === 'PartialReadError') {
      console.log('[Protocol Warning] Ignored unparseable packet from server.');
      return;
    }
    console.log('[Protocol Error]:', err.message);
  });

  bot._client.on('connect', () => {
    console.log(`[Net Status] TCP socket established with ${MC_HOST}:${MC_PORT}.`);
  });

  bot.on('login', () => {
    console.log('[Net Status] Handshake accepted by server.');
  });

  bot.on('spawn', () => {
    console.log('[Net Status] Bot spawned in world/limbo.');

    setTimeout(() => {
      bot.chat('/register KeepAlive123 KeepAlive123');
      bot.chat('/login KeepAlive123');
    }, 2000);

    setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }
    }, 15000);
  });

  bot.on('message', (jsonMsg) => {
    console.log('[Server Chat]:', jsonMsg.toString());
  });

  bot.on('kicked', (reason) => {
    console.log('[Server Kicked Event]:', reason);
  });

  bot.on('error', (err) => {
    console.log('[Mineflayer Error]:', err.message);
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code) && !useWebFallback) {
      console.log(`[Fallback] Switch to Web Ping due to ${err.code}...`);
      useWebFallback = true;
      pingPowerupStackWeb();
      setInterval(pingPowerupStackWeb, 2 * 60 * 1000);
    }
  });

  bot.on('end', (reason) => {
    console.log(`[Net Status] Socket closed. Reason: ${reason}`);
    if (!useWebFallback) {
      console.log('[Reconnecting] Retrying in 20 seconds...');
      setTimeout(createBot, 20000);
    }
  });
}

createBot();
