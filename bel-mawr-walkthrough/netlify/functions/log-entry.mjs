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
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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

async function appendRow(accessToken, values) {
  const appendRange = `'${SHEET_TAB}'!A2:H2`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      majorDimension: 'ROWS',
      values: [values],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();

    // Vapi sends tool calls in message.toolCallList
    let args = {};
    let toolCallId = null;

    if (body.message && body.message.toolCallList && body.message.toolCallList.length > 0) {
      const tc = body.message.toolCallList[0];
      toolCallId = tc.id;
      // arguments can be in tc.arguments or tc.function.arguments
      if (tc.function && tc.function.arguments) {
        args = tc.function.arguments;
      } else if (tc.arguments) {
        args = tc.arguments;
      }
      if (typeof args === 'string') args = JSON.parse(args);
    } else {
      // Direct call (e.g., from browser console for testing)
      args = body;
    }

    const {
      address = '',
      specificLocation = '',
      priority = '',
      category = '',
      operatingOrReserve = '',
      description = '',
    } = args;

    if (!description) {
      const errResp = { results: [{ toolCallId: toolCallId || 'unknown', result: 'Error: description is required' }] };
      return new Response(JSON.stringify(errResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Generate date stamp in MM/DD/YYYY format
    const now = new Date();
    const dateEntered = String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + '/' + now.getFullYear();

    // Row maps to columns A through I
    // A=Date Entered, B=Address, C=Location, D=Rank, E=Category, F=Op/Res, G=Description, H=Photos, I=blank
    const row = [
      dateEntered,
      address,
      specificLocation,
      priority,
      category,
      operatingOrReserve,
      description,
      '', // H - Photos (filled later)
    ];

    const token = await getAccessToken();
    const result = await appendRow(token, row);

    // Return in Vapi's expected format
    const response = toolCallId
      ? { results: [{ toolCallId, result: 'Row logged successfully' }] }
      : { success: true, result };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const errMsg = err.message || 'Unknown error';
    const response = { results: [{ toolCallId: 'unknown', result: 'Error: ' + errMsg }] };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/log-entry' };
