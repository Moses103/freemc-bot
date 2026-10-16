const mineflayer = require('mineflayer');

function createBot() {
  const bot = mineflayer.createBot({
    host: 'stablesmp.playserver.pro', // Replace with your FreeMC IP
    port: 33838,          // Replace with your FreeMC Port
    username: 'KeepAlive'
  });

  bot.on('spawn', () => {
    console.log('Bot successfully connected! Keeping chunk loaded...');
    // Jump every 30 seconds to prevent AFK kick
    setInterval(() => {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
    }, 30000);
  });

  bot.on('end', () => {
    console.log('Disconnected from server. Reconnecting in 15 seconds...');
    setTimeout(createBot, 15000);
  });

  bot.on('error', (err) => {
    console.log('Bot encountered an error:', err.message);
  });
}

createBot();
