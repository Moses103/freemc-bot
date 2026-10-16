const mineflayer = require('mineflayer');
const https = require('https');

const MC_HOST = process.env.MC_HOST || '15.235.182.152';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;
const PANEL_DOMAIN = process.env.PANEL_DOMAIN || 'stablesmp.playserver.pro';
const API_KEY = process.env.POWERUPSTACK_API_KEY;
const SERVER_ID = process.env.POWERUPSTACK_SERVER_ID;

let useApiFallback = false;

function pingPanelApi() {
  if (!API_KEY || !SERVER_ID) {
    console.log('[Panel API] Skipping API ping: Missing POWERUPSTACK_API_KEY or POWERUPSTACK_SERVER_ID in Railway variables.');
    return;
  }

  const cleanHost = PANEL_DOMAIN.replace(/^httpconst mineflayer = require('mineflayer');
const https = require('https');

// Game Server Config
const MC_HOST = process.env.MC_HOST || '15.235.182.152';
const MC_PORT = parseInt(process.env.MC_PORT) || 33838;

// PowerupStack Web Panel Config
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

  console.log(`Connecting to Minecraft server at ${MC_HOST}:${MC_PORT}...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAlive',
    auth: 'offline',
    version: '1.21.1',
    family: 4, // Forces IPv4 socket connection
    checkTimeoutInterval: 60 * 1000
  });

  bot.on('spawn', () => {
    console.log('Bot successfully connected! Keeping chunk loaded...');
    setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }
    }, 30000);
  });

  bot.on('error', (err) => {
    console.log('Bot encountered an error:', err.message);
    
    // Automatically switches to web ping if game port times out or connection is refused
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code)) {
      console.log(`Network error (${err.code}). Switching to PowerupStack web ping fallback...`);
      useWebFallback = true;
      pingPowerupStackWeb();
      setInterval(pingPowerupStackWeb, 2 * 60 * 1000); // Ping web console every 2 minutes
    }
  });

  bot.on('end', (reason) => {
    if (!useWebFallback) {
      console.log(`Disconnected from server (${reason}). Reconnecting in 30 seconds...`);
      setTimeout(createBot, 30000);
    }
  });
}

createBot();s?:\/\//, '').replace(/\/.*$/, '');

  const options = {
    hostname: cleanHost,
    port: 443,
    path: `/api/client/servers/${SERVER_ID}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[Panel API] KeepAlive Ping sent! HTTP Status: ${res.statusCode}`);
    });
  });

  req.on('error', (err) => {
    console.error('[Panel API] Error:', err.message);
  });

  req.end();
}

function createBot() {
  if (useApiFallback) {
    pingPanelApi();
    return;
  }

  console.log(`Connecting to Minecraft server at ${MC_HOST}:${MC_PORT}...`);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: process.env.MC_USERNAME || 'KeepAlive',
    auth: 'offline',
    version: '1.21.11',
    checkTimeoutInterval: 60 * 1000
  });

  bot.on('spawn', () => {
    console.log('Bot successfully connected! Keeping chunk loaded...');
    setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }
    }, 30000);
  });

  bot.on('error', (err) => {
    console.log('Bot encountered an error:', err.message);
    
    // Triggers fallback on ETIMEDOUT, ECONNREFUSED, or any network failure
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code)) {
      console.log(`Network error (${err.code}). Switching to PowerupStack Panel API ping fallback...`);
      useApiFallback = true;
      pingPanelApi();
      setInterval(pingPanelApi, 3 * 60 * 1000); // Ping panel every 3 minutes
    }
  });

  bot.on('end', (reason) => {
    if (!useApiFallback) {
      console.log(`Disconnected from server (${reason}). Reconnecting in 30 seconds...`);
      setTimeout(createBot, 30000);
    }
  });
}

createBot();
