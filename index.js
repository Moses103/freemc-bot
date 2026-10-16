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

  const cleanHost = PANEL_DOMAIN.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

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
