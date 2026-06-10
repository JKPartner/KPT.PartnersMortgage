const https = require('https');

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error('Anthropic API error: ' + parsed.error.message));
          } else {
            resolve(parsed);
          }
        } catch(e) {
          reject(new Error('JSON parse error: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const SYSTEM = `You are a real estate market data analyst. Search for the most current housing market data for Roseville/Sacramento CA, California statewide, and the US national market.

After searching, respond ONLY with a single valid JSON object. No markdown, no backticks, no explanation before or after. Start your response with { and end with }.

Required format:
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
    "inventory": "X,XXX homes",
    "headline": "One opportunity-focused sentence about the local market",
    "source_url": "https://redfin.com or similar"
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
    "headline": "One opportunity-focused sentence about the CA market",
    "source_url": "https://car.org or similar"
  },
  "national": {
    "median_price": "$XXX,XXX",
    "median_price_change": "+X.X% YoY",
    "days_on_market": "XX days",
    "inventory_change": "+X% YoY",
    "market_sentiment": "Stabilizing",
    "headline": "One opportunity-focused sentence about the national market",
    "source_url": "https://nar.realtor or similar"
  },
  "updated": "June 10, 2026"
}

Do NOT include any mortgage rate percentages. Use only real data from your searches.`;

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let messages = [{
      role: 'user',
      content: 'Search for the latest housing market data for Roseville CA, California statewide, and US national. Get median prices, days on market, inventory levels, and sales volume with year-over-year changes. Then respond with the JSON only.'
    }];

    let finalText = null;
    const maxTurns = 8;

    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await callAnthropic({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM,
        messages: messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      });

      // If stop_reason is end_turn, look for text with JSON
      if (result.stop_reason === 'end_turn') {
        const textBlocks = result.content.filter(b => b.type === 'text');
        for (const block of textBlocks) {
          const t = block.text.trim();
          if (t.includes('"local"') && t.includes('"california"')) {
            finalText = t;
            break;
          }
        }
        if (finalText) break;
        // If end_turn but no JSON yet, push and ask again
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: 'Now respond with only the JSON object.' });
        continue;
      }

      // If tool_use, add assistant message and empty tool results to continue
      if (result.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: result.content });
        const toolResults = result.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: ''
          }));
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    if (!finalText) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'No JSON response after ' + maxTurns + ' turns' })
      };
    }

    // Extract JSON robustly
    const jsonStart = finalText.indexOf('{');
    const jsonEnd = finalText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'No JSON brackets found in response' })
      };
    }

    const parsed = JSON.parse(finalText.substring(jsonStart, jsonEnd + 1));

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
