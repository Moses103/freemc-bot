const https = require('https');

// REPLACE 'panel.yourdomain.com' WITH YOUR ACTUAL POWERUPSTACK PANEL DOMAIN
const PANEL_DOMAIN = process.env.PANEL_DOMAIN || 'panel.yourdomain.com'; 
const API_KEY = process.env.POWERUPSTACK_API_KEY;  
const SERVER_ID = process.env.POWERUPSTACK_SERVER_ID; 

function keepAlive() {
  if (!API_KEY || !SERVER_ID) {
    console.log('Missing POWERUPSTACK_API_KEY or POWERUPSTACK_SERVER_ID in Railway variables.');
    return;
  }

  const options = {
    hostname: PANEL_DOMAIN.replace(/^https?:\/\//, ''), // Strips https:// if present
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
      try {
        const parsed = JSON.parse(data);
        const status = parsed.attributes ? parsed.attributes.current_state : 'Unknown';
        console.log(`[${new Date().toLocaleTimeString()}] PowerupStack Status: ${status}`);
      } catch (e) {
        console.log(`Received status code ${res.statusCode} from panel API.`);
      }
    });
  });

  req.on('error', (err) => {
    console.error('API Ping Error:', err.message);
  });

  req.end();
}

// Ping every 3 minutes
setInterval(keepAlive, 3 * 60 * 1000);
keepAlive();
