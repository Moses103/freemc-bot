const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'https://panel.powerupstack.com';
const API_KEY = process.env.POWERUPSTACK_API_KEY;
const SERVER_ID = process.env.POWERUPSTACK_SERVER_ID;

async function keepServerAlive() {
  try {
    const response = await axios.get(`${PANEL_URL}/api/client/servers/${SERVER_ID}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    });
    console.log(`[${new Date().toLocaleTimeString()}] PowerupStack Status: ${response.data.attributes.current_state}`);
  } catch (error) {
    console.error('Failed to ping PowerupStack API:', error.response?.data || error.message);
  }
}

// Ping panel every 3 minutes to keep instance awake
setInterval(keepServerAlive, 3 * 60 * 1000);
keepServerAlive();
