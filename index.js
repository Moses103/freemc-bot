const mineflayer = require('mineflayer');
const http = require('http');

// 1. HTTP server binding for Railway health checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft Bot is operational.\n');
}).listen(PORT, () => {
  console.log(`[HTTP] Web server listening on port ${PORT}`);
});

// Explicitly declare global interval variables to prevent ReferenceErrors
let crouchInterval = null;
let jumpInterval = null;

function createBot() {
  const host = process.env.SERVER_HOST || 'stablesmp.playserver.pro';
  const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 33838;
  const username = process.env.BOT_USERNAME || 'KeepALive';
  const version = process.env.MC_VERSION || '1.21.11';

  console.log(`[Bot] Connecting to ${host}:${port}...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version,
    checkTimeoutInterval: 60 * 1000
  });

  bot.on('login', () => {
    console.log(`[Bot] Connected as ${username} to ${host}:${port}`);
  });

  bot.on('spawn', () => {
    console.log('[Bot] Spawned in world! Starting anti-AFK timers...');

    // Clear any active timers before creating new ones
    if (crouchInterval) clearInterval(crouchInterval);
    if (jumpInterval) clearInterval(jumpInterval);

    // Crouch (sneak) every 10 seconds (10,000 ms)
    crouchInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('sneak', true);
      console.log('[Anti-AFK] Crouched');

      setTimeout(() => {
        if (bot.entity) bot.setControlState('sneak', false);
      }, 1000);
    }, 10000);

    // Jump every 15 seconds (15,000 ms)
    jumpInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      console.log('[Anti-AFK] Jumped');

      setTimeout(() => {
        if (bot.entity) bot.setControlState('jump', false);
      }, 500);
    }, 15000);
  });

  bot.on('kicked', (reason) => {
    console.log('[Bot] Kicked from server:', JSON.stringify(reason));
  });

  bot.on('error', (err) => {
    console.error('[Bot] Error caught:', err.message || err);
  });

  // Always clear intervals on disconnect and schedule reconnection
  bot.on('end', (reason) => {
    console.log(`[Bot] Connection ended (${reason}). Reconnecting in 10 seconds...`);
    
    if (crouchInterval) clearInterval(crouchInterval);
    if (jumpInterval) clearInterval(jumpInterval);
    
    crouchInterval = null;
    jumpInterval = null;

    setTimeout(createBot, 10000);
  });
}

// Start the bot loop
createBot();
