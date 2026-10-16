const mineflayer = require('mineflayer');
const https = require('https');

// Primary Domain or IP fallback
const MC_HOST = process.env.MC_HOST || 'stablesmp.playserver.pro';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;
// Explicitly specify version to bypass autoVersion ping (-1 error)
const MC_VERSION = process.env.MC_VERSION || '1.21.11';

// PowerupStack Web Panel Fallback Config
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

  console.log(`Connecting Mineflayer bot to ${MC_HOST}:${MC_PORT} (Version: ${MC_VERSION})...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAliveBot',
    auth: 'offline',
    version: MC_VERSION, // Hardcoded version prevents auto-version handshake errors
    family: 4,
    checkTimeoutInterval: 60 * 1000
  });

  bot._client.on('connect', () => {
    console.log('TCP Socket connected! Server port is OPEN.');
  });

  bot.on('spawn', () => {
    console.log('>>> SUCCESS: Bot joined the Minecraft server in-game! <<<');
    
    // Jump every 30 seconds to maintain activity
    setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }
    }, 30000);
  });

  bot.on('error', (err) => {
    console.log('Mineflayer Error:', err.message);
    
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code) && !useWebFallback) {
      console.log(`Connection refused or lost on port ${MC_PORT}.`);
      console.log('Activating PowerupStack web ping fallback...');
      useWebFallback = true;
      pingPowerupStackWeb();
      setInterval(pingPowerupStackWeb, 2 * 60 * 1000);
    }
  });

  bot.on('end', (reason) => {
    console.log(`Disconnected (${reason}).`);
    if (!useWebFallback) {
      console.log('Reconnecting bot in 15 seconds...');
      setTimeout(createBot, 15000);
    }
  });
}

createBot();
