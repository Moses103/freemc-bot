const mineflayer = require('mineflayer');

function createBot() {
  console.log('Connecting to Minecraft server...');

  const bot = mineflayer.createBot({
    host: '15.235.182.152', // Subdomain host
    port: 33838,                      // Your specific server port
    username: 'KeepAlive',
    version: '1.21.11',                 // Explicitly pin version to prevent autoVersion ETIMEDOUT crashes
    checkTimeoutInterval: 60 * 1000   // Keepalive timeout threshold
  });

  bot.on('spawn', () => {
    console.log('Bot successfully connected! Keeping chunk loaded...');
    
    // Jump every 30 seconds to prevent AFK kick
    setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }
    }, 30000);
  });

  bot.on('error', (err) => {
    console.log('Bot encountered an error:', err.message);
  });

  bot.on('end', (reason) => {
    console.log(`Disconnected from server (${reason}). Reconnecting in 15 seconds...`);
    setTimeout(createBot, 15000);
  });
}

createBot();
