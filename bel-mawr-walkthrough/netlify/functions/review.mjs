import { SignJWT, importPKCS8 } from 'jose';

const SHEET_ID = '16FVKmjOPVmYKNlO-9wYRmzwzv5PG44GQaXqtSGMUyYY';
const SHEET_TAB = 'Sheet1';

async function getAccessToken() {
  const email = Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  let rawKey = Netlify.env.get('GOOGLE_PRIVATE_KEY');
  rawKey = rawKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
  const privateKey = await importPKCS8(rawKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(privateKey);
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`'${SHEET_TAB}'!A1:H`);
    
    // Fetch display values
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await resp.json();
    if (data.error) throw new Error(JSON.stringify(data.error));

    // Also fetch formulas to extract HYPERLINK URLs from column H (Photos)
    const formulaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMULA`;
    const formulaResp = await fetch(formulaUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    const formulaData = await formulaResp.json();

    const headers = data.values && data.values[0] ? data.values[0] : [];
    const rows = data.values ? data.values.slice(1) : [];
    const formulaRows = formulaData.values ? formulaData.values.slice(1) : [];

    // Find the index of the PHOTOS column
    const photosIdx = headers.findIndex(h => h && h.toUpperCase().includes('PHOTO'));

    // Convert to array of objects
    const entries = rows
      .map((row, idx) => {
        const obj = { rowNumber: idx + 2 };
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        if (photosIdx >= 0 && formulaRows[idx] && formulaRows[idx][photosIdx]) {
          const formula = formulaRows[idx][photosIdx];
          if (typeof formula === 'string' && formula.includes('HYPERLINK')) {
            const match = formula.match(/HYPERLINK\("([^"]+)"/);
            if (match) obj._photoUrl = match[1];
          } else if (typeof formula === 'string' && formula.startsWith('http')) {
            obj._photoUrl = formula;
          }
        }
        return obj;
      })
      .filter(obj => {
        const vals = Object.values(obj).filter(v => v !== obj.rowNumber);
        return vals.some(v => v && String(v).trim());
      });

    return new Response(JSON.stringify({ headers, entries, total: entries.length }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to read sheet' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/review' };
