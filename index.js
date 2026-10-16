const mineflayer = require('mineflayer');

function createBot() {
  const bot = mineflayer.createBot({
    host: 'stablesmp.playserver.pro',
    port: 33838,
    username: 'KeepAlive', // Change to your preferred bot name
    version: '1.21.11'      // Matches your Paper server version
  });

  bot.on('login', () => {
    console.log(`[Bot] Connected to Paper 1.21.11 at stablesmp.playserver.pro as ${bot.username}`);
  });

  bot.on('spawn', () => {
    console.log('[Bot] Spawned in the world!');
  });

  bot.on('kicked', (reason) => {
    console.log('[Bot] Kicked from server:', reason);
  });

  bot.on('error', (err) => {
    console.error('[Bot] Error:', err);
  });

  // Auto-reconnect if dropped
  bot.on('end', () => {
    console.log('[Bot] Disconnected. Reconnecting in 10 seconds...');
    setTimeout(createBot, 10000);
  });
}

createBot();
