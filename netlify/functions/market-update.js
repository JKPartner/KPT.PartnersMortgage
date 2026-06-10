const https = require('https');

function anthropicCall(messages, useWebSearch, apiKey) {
  return new Promise((resolve, reject) => {
    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      system: 'You are a real estate data analyst. Respond ONLY with valid JSON. No markdown, no backticks. Start with { and end with }.',
      messages: messages
    };
    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const payload = JSON.stringify(body);
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
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          resolve(parsed);
        } catch(e) { reject(new Error('Parse: ' + data.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function runSearch(prompt, apiKey) {
  let messages = [{ role: 'user', content: prompt }];
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    const result = await anthropicCall(messages, true, apiKey);
    if (result.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: result.content });
      const toolResults = result.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    const textBlock = result.content && result.content.find(b => b.type === 'text');
    if (textBlock) return textBlock.text;
    break;
  }
  throw new Error('No response after ' + attempts + ' attempts');
}

async function runKnowledge(prompt, apiKey) {
  const result = await anthropicCall([{ role: 'user', content: prompt }], false, apiKey);
  const textBlock = result.content && result.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in knowledge response');
  return textBlock.text;
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found');
  return JSON.parse(text.substring(start, end + 1));
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'API key not configured' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const section = body.section || 'local';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const formats = {
    local: '{"area":"Roseville / Sacramento, CA","median_price":"$XXX,XXX","median_price_change":"+X.X% YoY","days_on_market":"XX days","compete_score":"XX/100","inventory":"X,XXX homes","headline":"One opportunity-focused sentence","source":"Redfin"}',
    california: '{"median_price":"$XXX,XXX","median_price_change":"+X.X% YoY","days_on_market":"XX days","homes_sold":"XX,XXX","above_list_pct":"XX%","affordability":"XX%","headline":"One opportunity-focused sentence","source":"CAR / Redfin"}',
    national: '{"median_price":"$XXX,XXX","median_price_change":"+X.X% YoY","days_on_market":"XX days","inventory_change":"+X% YoY","market_sentiment":"Stabilizing","headline":"One opportunity-focused sentence","source":"NAR / Redfin"}'
  };

  const searchPrompts = {
    local: `Search for the latest Roseville CA and Sacramento CA housing market stats. Today is ${today}. No mortgage rate percentages. JSON only: ${formats.local}`,
    california: `Search for the latest California statewide housing market data from CAR or Redfin. Today is ${today}. No mortgage rate percentages. JSON only: ${formats.california}`,
    national: `Search for the latest US national housing market data from NAR or Redfin. Today is ${today}. No mortgage rate percentages. JSON only: ${formats.national}`
  };

  const knowledgePrompts = {
    local: `Using your most recent knowledge, provide current Roseville CA / Sacramento CA housing market data as of ${today}. No mortgage rate percentages. JSON only: ${formats.local}`,
    california: `Using your most recent knowledge, provide current California statewide housing market data as of ${today}. No mortgage rate percentages. JSON only: ${formats.california}`,
    national: `Using your most recent knowledge, provide current US national housing market data as of ${today}. No mortgage rate percentages. JSON only: ${formats.national}`
  };

  try {
    let text;
    let usedWebSearch = true;

    try {
      // Try web search with 8 second timeout (safely under Netlify's 10s limit)
      text = await Promise.race([
        runSearch(searchPrompts[section], apiKey),
        timeout(8000)
      ]);
    } catch(e) {
      // Fall back to knowledge if web search times out or fails
      usedWebSearch = false;
      text = await runKnowledge(knowledgePrompts[section], apiKey);
    }

    const data = extractJSON(text);
    if (!usedWebSearch) {
      data.source = (data.source || '') + ' (AI estimate)';
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, section, data }) };

  } catch(err) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
