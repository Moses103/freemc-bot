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

let crouchInterval = null;
let jumpInterval = null;

function createBot() {
  console.log('[Bot] Connecting to Minecraft server...');

  const bot = mineflayer.createBot({
    host: process.env.SERVER_HOST || 'stablesmp.playserver.pro',
    port: parseInt(process.env.SERVER_PORT, 10) || 25565,
    username: process.env.BOT_USERNAME || 'RailwayBot',
    version: process.env.MC_VERSION || '1.21.11'
  });

  bot.on('login', () => {
    console.log(`[Bot] Connected as ${bot.username} to ${bot.options.host}:${bot.options.port}`);
  });

  bot.on('spawn', () => {
    console.log('[Bot] Spawned in world. Starting anti-AFK timers...');

    // Clear any leftover timers from previous sessions
    clearInterval(crouchInterval);
    clearInterval(jumpInterval);

    // Crouch (sneak) every 10 seconds (10,000 ms)
    crouchInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('sneak', true);
      console.log('[Anti-AFK] Crouched');

      // Hold crouch for 1 second, then stand up
      setTimeout(() => {
        bot.setControlState('sneak', false);
      }, 1000);
    }, 10000);

    // Jump every 15 seconds (15,000 ms)
    jumpInterval = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      console.log('[Anti-AFK] Jumped');

      // Release jump state after 0.5 seconds
      setTimeout(() => {
        bot.setControlState('jump', false);
      }, 500);
    }, 15000);
  });

  bot.on('kicked', (reason) => {
    console.log('[Bot] Kicked from server:', reason);
  });

  bot.on('error', (err) => {
    console.error('[Bot] Error caught:', err.message || err);
  });

  // Clean up timers and attempt reconnect on disconnect
  bot.on('end', (reason) => {
    console.log(`[Bot] Disconnected (${reason}). Clearing timers and reconnecting in 10s...`);
    clearInterval(crouchInterval);
    clearInterval(jumpInterval);
    setTimeout(createBot, 10000);
  });
}

createBot();
