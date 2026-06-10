const https = require('https');

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, error: 'API key not configured' })
    };
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: `You are a real estate market data analyst with knowledge through mid-2026. Today is ${today}. Respond ONLY with a single valid JSON object. No markdown, no backticks, no text before or after the JSON.`,
    messages: [{
      role: 'user',
      content: `Provide current housing market data for three areas. Use your most recent knowledge for Roseville/Sacramento CA, California statewide, and US national markets.

Respond with ONLY this JSON (no markdown, start with {):
{
  "local": {
    "area": "Roseville / Sacramento, CA",
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "homes_sold": "XXX",
    "sale_to_list": "XX.X%",
    "compete_score": "XX/100",
    "inventory": "X,XXX homes",
    "headline": "One opportunity-focused sentence about the local market"
  },
  "california": {
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "homes_sold": "XX,XXX",
    "above_list_pct": "XX%",
    "inventory": "XXX,XXX homes",
    "affordability": "XX%",
    "headline": "One opportunity-focused sentence about the CA market"
  },
  "national": {
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "inventory_change": "+X% YoY",
    "market_sentiment": "Stabilizing",
    "headline": "One opportunity-focused sentence about the national market"
  },
  "updated": "${today}"
}`
    }]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: parsed.error.message }) });
            return;
          }
          const text = parsed.content && parsed.content[0] && parsed.content[0].text;
          if (!text) {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'No text in response' }) });
            return;
          }
          const jsonStart = text.indexOf('{');
          const jsonEnd = text.lastIndexOf('}');
          if (jsonStart === -1 || jsonEnd === -1) {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'No JSON in response: ' + text.substring(0, 100) }) });
            return;
          }
          const marketData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
          resolve({ statusCode: 200, headers, body: JSON.stringify({ success: true, data: marketData }) });
        } catch(e) {
          resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Parse error: ' + e.message }) });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Network error: ' + e.message }) });
    });

    req.write(payload);
    req.end();
  });
};
