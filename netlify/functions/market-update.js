const https = require('https');

function anthropicCall(messages, useWebSearch, apiKey) {
  return new Promise((resolve, reject) => {
    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: 'Real estate analyst. JSON only. No markdown.',
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
        } catch(e) { reject(new Error('Parse: ' + data.substring(0, 80))); }
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
  for (let i = 0; i < 5; i++) {
    const result = await anthropicCall(messages, true, apiKey);
    if (result.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: result.content });
      const toolResults = result.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    const t = result.content && result.content.find(b => b.type === 'text');
    if (t) return t.text;
    break;
  }
  throw new Error('No response');
}

async function runKnowledge(prompt, apiKey) {
  const result = await anthropicCall([{ role: 'user', content: prompt }], false, apiKey);
  const t = result.content && result.content.find(b => b.type === 'text');
  if (!t) throw new Error('No text');
  return t.text;
}

function extractJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON');
  return JSON.parse(text.substring(s, e + 1));
}

// Minimal JSON schemas - shorter = fewer tokens
const schemas = {
  local: '{"area":"...","median_price":"$X","median_price_change":"+X%","days_on_market":"X","compete_score":"X/100","inventory":"X","headline":"...","source":"Redfin"}',
  california: '{"median_price":"$X","median_price_change":"+X%","days_on_market":"X","homes_sold":"X","above_list_pct":"X%","affordability":"X%","headline":"...","source":"CAR"}',
  national: '{"median_price":"$X","median_price_change":"+X%","days_on_market":"X","inventory_change":"+X%","market_sentiment":"...","headline":"...","source":"NAR"}'
};

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'No API key' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const section = body.section || 'local';
  const today = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const searchQ = {
    local: `Roseville Sacramento CA housing market ${today} median price days inventory. JSON: ${schemas.local}`,
    california: `California housing market ${today} median price days sold affordability. JSON: ${schemas.california}`,
    national: `US national housing market ${today} median price days inventory sentiment. JSON: ${schemas.national}`
  };

  const knowledgeQ = {
    local: `Roseville Sacramento CA housing market data ${today}. JSON: ${schemas.local}`,
    california: `California statewide housing market ${today}. JSON: ${schemas.california}`,
    national: `US national housing market ${today}. JSON: ${schemas.national}`
  };

  try {
    let text, usedSearch = true;
    try {
      text = await Promise.race([runSearch(searchQ[section], apiKey), timeout(8000)]);
    } catch(e) {
      usedSearch = false;
      text = await runKnowledge(knowledgeQ[section], apiKey);
    }
    const data = extractJSON(text);
    if (!usedSearch) data.source = (data.source || '') + ' (AI est.)';
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, section, data }) };
  } catch(err) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
