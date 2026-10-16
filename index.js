const mineflayer = require('mineflayer');
const https = require('https');

// Always use the domain to avoid dynamic IP shift issues
const MC_HOST = process.env.MC_HOST || 'stablesmp.playserver.pro';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;
// Properly uses environment variable or defaults to 1.21
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
    console.log(`[PowerupStack Web Ping] HTTP Status: ${res.statusCode}`);
  });

  req.on('error', (err) => {
    console.error('[PowerupStack Web Ping Error]:', err.message);
  });

  req.end();
}

function createBot() {
  if (useWebFallback) {
    pingPowerupStackWeb();
    return;
  }

  console.log(`[Connect Attempt] Connecting Mineflayer to ${MC_HOST}:${MC_PORT} (Version: ${MC_VERSION})...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAliveBot',
    auth: 'offline',
    version: MC_VERSION, // Uses process.env.MC_VERSION dynamically
    family: 4,
    connectTimeout: 30000,
    checkTimeoutInterval: 60 * 1000
  });

  // Safely hook protocol deserializer once connection attaches it
  bot._client.on('session', () => {
    if (bot._client.deserializer) {
      bot._client.deserializer.on('error', (err) => {
        // Silently discard packet decode errors (e.g. PartialReadError on 1.21.11 items)
      });
    }
  });

  bot._client.on('error', (err) => {
    if (err.name === 'PartialReadError' || (err.message && err.message.includes('PartialReadError'))) {
      return;
    }
    console.log('[Protocol Error]:', err.message);
  });

  bot._client.on('connect', () => {
    console.log(`[Net Status] TCP socket connected to ${MC_HOST}:${MC_PORT}`);
  });

  bot.on('login', () => {
    console.log('[Net Status] Handshake accepted by Paper server.');
  });

  bot.on('spawn', () => {
    console.log('>>> SUCCESS: Bot joined the Paper server! <<<');

    setTimeout(() => {
      bot.chat('/register KeepAlive123 KeepAlive123');
      bot.chat('/login KeepAlive123');
    }, 2000);

    // Keep active with periodic jumping
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
    console.log('[Server Kick Reason]:', reason);
  });

  bot.on('error', (err) => {
    console.log('[Mineflayer Error]:', err.message);
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code) && !useWebFallback) {
      console.log(`[Fallback] Switching to Web Ping due to ${err.code}...`);
      useWebFallback = true;
      pingPowerupStackWeb();
      setInterval(pingPowerupStackWeb, 2 * 60 * 1000);
    }
  });

  bot.on('end', (reason) => {
    console.log(`[Net Status] Socket closed. Reason: ${reason}`);
    if (!useWebFallback) {
      console.log('[Reconnecting] Retrying in 15 seconds...');
      setTimeout(createBot, 15000);
    }
  });
}

createBot();const mineflayer = require('mineflayer');
const https = require('https');

// Always use the domain to avoid dynamic IP shift issues
const MC_HOST = process.env.MC_HOST || 'stablesmp.playserver.pro';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;

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
    console.log(`[PowerupStack Web Ping] HTTP Status: ${res.statusCode}`);
  });

  req.on('error', (err) => {
    console.error('[PowerupStack Web Ping Error]:', err.message);
  });

  req.end();
}

function createBot() {
  if (useWebFallback) {
    pingPowerupStackWeb();
    return;
  }

  console.log(`[Connect Attempt] Connecting Mineflayer to ${MC_HOST}:${MC_PORT}...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAliveBot',
    auth: 'offline',
    version: '1.21', // Handshake version for mineflayer core
    family: 4,
    connectTimeout: 30000,
    checkTimeoutInterval: 60 * 1000
  });

  // Prevent PartialReadError or protocol mismatches on Paper 1.21.11 from breaking socket
  if (bot._client && bot._client.deserializer) {
    bot._client.deserializer.on('error', (err) => {
      // Silently discard packet decode errors on 1.21.11 items
    });
  }

  bot._client.on('error', (err) => {
    if (err.name === 'PartialReadError' || err.message.includes('PartialReadError')) {
      return;
    }
    console.log('[Protocol Error]:', err.message);
  });

  bot._client.on('connect', () => {
    console.log(`[Net Status] TCP socket connected to ${MC_HOST}:${MC_PORT}`);
  });

  bot.on('login', () => {
    console.log('[Net Status] Handshake accepted by Paper 1.21.11 server.');
  });

  bot.on('spawn', () => {
    console.log('>>> SUCCESS: Bot joined the Paper 1.21.11 server! <<<');

    setTimeout(() => {
      bot.chat('/register KeepAlive123 KeepAlive123');
      bot.chat('/login KeepAlive123');
    }, 2000);

    // Keep active with periodic jumping
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
    console.log('[Server Kick Reason]:', reason);
  });

  bot.on('error', (err) => {
    console.log('[Mineflayer Error]:', err.message);
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code) && !useWebFallback) {
      console.log(`[Fallback] Switching to Web Ping due to ${err.code}...`);
      useWebFallback = true;
      pingPowerupStackWeb();
      setInterval(pingPowerupStackWeb, 2 * 60 * 1000);
    }
  });

  bot.on('end', (reason) => {
    console.log(`[Net Status] Socket closed. Reason: ${reason}`);
    if (!useWebFallback) {
      console.log('[Reconnecting] Retrying in 15 seconds...');
      setTimeout(createBot, 15000);
    }
  });
}

createBot();
