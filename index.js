const mineflayer = require('mineflayer');

function createBot() {
  console.log('Connecting to Minecraft server...');

  const bot = mineflayer.createBot({
    // Reads host and port from Railway environment variables
    host: process.env.MC_HOST || '15.235.182.152',
    port: parseInt(process.env.MC_PORT) || 33838,
    username: process.env.MC_USERNAME || 'KeepAlive',
    auth: 'offline',                  // Disables Microsoft auth pinging
    checkTimeoutInterval: 60 * 1000
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
