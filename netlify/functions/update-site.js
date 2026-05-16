const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { secret, content, filename, message } = JSON.parse(event.body);

    // Check secret key so only Claude can trigger this
    if (secret !== process.env.UPDATE_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = 'JKPartner';
    const repo = 'KPT.PartnersMortgage';
    const file = filename || 'index.html';

    // Step 1: Get current file SHA
    const sha = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/contents/${file}`,
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'KPT-Site-Updater',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data).sha); }
          catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    // Step 2: Push updated file
    const encoded = Buffer.from(content).toString('base64');
    const payload = JSON.stringify({
      message: message || 'Update from Claude',
      content: encoded,
      sha: sha
    });

    await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/contents/${file}`,
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'KPT-Site-Updater',
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Site updated! Netlify is redeploying now.' })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
