// Looks up public details (price, beds, baths, sq ft, type, main photo) for a
// listing link so the realtor portal's Open House Flyer can prefill them.
// Only listing sites on the allowlist are fetched, so this can't be used as a
// general-purpose proxy.
const ALLOWED = /(^|\.)(zillow\.com|redfin\.com|realtor\.com|trulia\.com|homes\.com)$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function parse(html) {
  const meta = {};
  const chunks = [];
  const re = /<meta[^>]+(?:property|name)=["'](?:og:description|og:title|twitter:description|twitter:title|description)["'][^>]*content=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) chunks.push(m[1]);
  const text = chunks.join(' | ') + '\n' + html.slice(0, 600000);

  const pricePats = [/"price"\s*:\s*"?(\d{5,8})"?/, /listPrice["\s:]+(\d{5,8})/i, /\$(\d{2,3}(?:,\d{3})+)/];
  for (const p of pricePats) {
    const x = text.match(p);
    if (x) { const n = parseInt(x[1].replace(/,/g, ''), 10); if (n > 50000 && n < 50000000) { meta.price = n; break; } }
  }
  const beds = text.match(/(\d{1,2})\s*(?:beds?|bd)\b/i);
  const baths = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:baths?|ba)\b/i);
  const sqft = text.match(/([\d,]{3,7})\s*(?:sq\.?\s*ft|sqft)/i);
  if (beds) meta.beds = beds[1];
  if (baths) meta.baths = baths[1];
  if (sqft) meta.sqft = sqft[1].replace(/,/g, '');
  if (/single.family|single_family/i.test(text)) meta.propType = 'Single Family';
  else if (/condo/i.test(text)) meta.propType = 'Condo';
  else if (/townhous|townhome/i.test(text)) meta.propType = 'Townhome';
  else if (/multi.family|duplex|triplex|fourplex/i.test(text)) meta.propType = '2-4 Units';
  const img = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (img) meta.image = img[1].replace(/&amp;/g, '&');
  return meta;
}

async function photoDataUrl(src) {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:') return null;
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2500000) return null;
    return 'data:' + type.split(';')[0] + ';base64,' + buf.toString('base64');
  } catch (e) { return null; }
}

exports.handler = async function (event) {
  const raw = (event.queryStringParameters || {}).url || '';
  let target;
  try { target = new URL(raw); } catch (e) { return json(400, { error: 'Invalid link' }); }
  if (target.protocol !== 'https:' || !ALLOWED.test(target.hostname)) return json(400, { error: 'Only Zillow, Redfin, Realtor.com, Trulia or Homes.com links are supported' });
  try {
    const r = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow', signal: AbortSignal.timeout(9000)
    });
    if (!r.ok) return json(200, { blocked: true });
    const html = await r.text();
    const meta = parse(html);
    if (meta.image) { meta.photo = await photoDataUrl(meta.image); delete meta.image; }
    return json(200, meta);
  } catch (e) {
    return json(200, { blocked: true });
  }
};
