const https = require('https');

function anthropicCall(messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: system,
      messages: messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const system = `You are a real estate market analyst. Search for the most current housing market data available today.
Respond ONLY with valid JSON, no markdown, no backticks, no explanation.
Use this exact format:
{
  "local": {
    "area": "Roseville / Sacramento, CA",
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "homes_sold": "XXX",
    "homes_sold_change": "+X% YoY",
    "sale_to_list": "XX.X%",
    "compete_score": "XX/100",
    "compete_label": "Somewhat Competitive",
    "inventory": "X,XXX homes",
    "headline": "One sentence opportunity-focused insight about local market"
  },
  "california": {
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "homes_sold": "XX,XXX",
    "homes_sold_change": "+X% YoY",
    "sale_to_list": "XX.X%",
    "above_list_pct": "XX%",
    "inventory": "XXX,XXX homes",
    "affordability": "XX%",
    "headline": "One sentence opportunity-focused insight about CA market"
  },
  "national": {
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "inventory_change": "+X% YoY",
    "market_sentiment": "Stabilizing / Competitive / Cooling",
    "headline": "One sentence opportunity-focused national housing insight"
  },
  "updated": "Month DD, YYYY"
}
Do NOT include any specific mortgage rate percentages anywhere. Use only real data from your web search.`;

  try {
    const result = await anthropicCall([{
      role: 'user',
      content: 'Search for the latest Roseville CA housing market stats, California statewide housing market data, and national US housing market trends as of today. Return current median prices, days on market, inventory, and sales volume with year-over-year changes.'
    }], system);

    const textBlock = result.content && result.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in response');

    const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: parsed })
    };
  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
