const mineflayer = require('mineflayer');
const https = require('https');

const MC_HOST = process.env.MC_HOST || 'stablesmp.playserver.pro';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;
const MC_VERSION = process.env.MC_VERSION || '1.21';

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

  console.log(`[Connect Attempt] Connecting to ${MC_HOST}:${MC_PORT} (Version: ${MC_VERSION})...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAliveBot',
    auth: 'offline',
    version: MC_VERSION,
    family: 4,
    checkTimeoutInterval: 60 * 1000
  });

  // Track raw network client events
  bot._client.on('connect', () => {
    console.log('[Net Status] TCP socket established.');
  });

  bot._client.on('packet', (data, metadata) => {
    // Log disconnect or kick packets sent by server
    if (metadata.name === 'disconnect' || metadata.name === 'kick_disconnect') {
      console.log('[Server Raw Disconnect Packet]:', JSON.stringify(data));
    }
  });

  bot.on('login', () => {
    console.log('[Net Status] Handshake accepted by server (Login Packet received).');
  });

  bot.on('spawn', () => {
    console.log('[Net Status] Entity spawned event triggered.');

    setTimeout(() => {
      bot.chat('/register KeepAlive123 KeepAlive123');
      bot.chat('/login KeepAlive123');
    }, 1000);
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
