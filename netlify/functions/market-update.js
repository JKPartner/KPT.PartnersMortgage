const https = require('https');

function anthropicCall(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are a real estate market analyst. Search for the most current housing market data available today.
After searching, respond ONLY with valid JSON, no markdown, no backticks, no explanation.
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
    "market_sentiment": "Stabilizing",
    "headline": "One sentence opportunity-focused national housing insight"
  },
  "updated": "Month DD, YYYY"
}
Do NOT include any mortgage rate percentages. Use only real data from your web search.`,
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
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 300))); }
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

  try {
    let messages = [{
      role: 'user',
      content: 'Search for the latest Roseville CA housing market stats, California statewide housing market data, and national US housing market trends as of today. Return current median prices, days on market, inventory, and sales volume with year-over-year changes. Then respond with the JSON.'
    }];

    let finalText = null;
    let attempts = 0;

    // Loop to handle multi-turn web search tool use
    while (!finalText && attempts < 6) {
      attempts++;
      const result = await anthropicCall(messages);

      if (!result.content) throw new Error('No content in response');

      // Check stop reason
      if (result.stop_reason === 'end_turn') {
        // Look for final text block
        const textBlock = result.content.find(b => b.type === 'text');
        if (textBlock && textBlock.text.trim().startsWith('{')) {
          finalText = textBlock.text;
          break;
        }
      }

      // If tool_use, build next message with tool results
      if (result.stop_reason === 'tool_use') {
        const toolUseBlocks = result.content.filter(b => b.type === 'tool_use');
        if (toolUseBlocks.length === 0) break;

        // Add assistant message
        messages.push({ role: 'assistant', content: result.content });

        // Add tool results (empty - web search results are inline)
        const toolResults = toolUseBlocks.map(tu => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: ''
        }));
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // If end_turn but no JSON yet, check for any text
      const textBlock = result.content && result.content.find(b => b.type === 'text');
      if (textBlock) {
        finalText = textBlock.text;
        break;
      }

      break;
    }

    if (!finalText) throw new Error('No final text after ' + attempts + ' attempts');

    // Clean and parse JSON
    const clean = finalText.replace(/```json|```/g, '').trim();
    const jsonStart = clean.indexOf('{');
    const jsonEnd = clean.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in response');

    const parsed = JSON.parse(clean.substring(jsonStart, jsonEnd + 1));

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
