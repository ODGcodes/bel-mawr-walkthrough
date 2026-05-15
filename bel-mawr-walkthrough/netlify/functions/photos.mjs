import { getStore } from "@netlify/blobs";
import { SignJWT, importPKCS8 } from 'jose';

const SHEET_ID = '16FVKmjOPVmYKNlO-9wYRmzwzv5PG44GQaXqtSGMUyYY';
const SHEET_TAB = 'Sheet1';
const SITE_URL = 'https://bel-mawr-walkthrough.netlify.app';

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
  if (!data.access_token) throw new Error('Auth failed');
  return data.access_token;
}

async function addPhotoUrlToSheet(photoUrl, address, category, rowNumber) {
  try {
    const token = await getAccessToken();

    // Build gallery link
    const addr = (address || '').toString().trim();
    const cat = (category || '').toString().trim();
    const params = new URLSearchParams();
    if (addr) params.set('address', addr);
    if (cat) params.set('category', cat);
    const galleryUrl = SITE_URL + '/photos.html?' + params.toString();
    const displayLabel = 'Photos' + (addr ? ' ' + addr : '') + (cat ? ' ' + cat : '');
    const cellValue = '=HYPERLINK("' + galleryUrl.replace(/"/g, '""') + '","' + displayLabel.replace(/"/g, '""') + '")';

    // PRIMARY: If rowNumber is provided, write directly to that row
    if (rowNumber && parseInt(rowNumber) > 0) {
      const rowNum = parseInt(rowNumber);
      const writeRange = `'${SHEET_TAB}'!H${rowNum}`;
      const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`;
      const writeResp = await fetch(writeUrl, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: writeRange, majorDimension: 'ROWS', values: [[cellValue]] }),
      });
      const writeData = await writeResp.json();
      if (writeData.error) return { matched: false, reason: JSON.stringify(writeData.error) };
      return { matched: true, row: rowNum, method: 'rowNumber' };
    }

    // FALLBACK: Match by address+category
    const range = encodeURIComponent(`'${SHEET_TAB}'!A:H`);
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?majorDimension=ROWS`;
    const readResp = await fetch(readUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    const readData = await readResp.json();
    if (!readData.values) return { matched: false, reason: 'No data in sheet' };

    const photoAddr = addr;
    const photoCat = cat.toLowerCase();
    let bestRow = -1;

    // Address + category match
    for (let i = 1; i < readData.values.length; i++) {
      const rowAddr = (readData.values[i][1] || '').toString().trim();
      const rowCat = (readData.values[i][4] || '').toString().trim().toLowerCase();
      if (photoAddr && rowAddr === photoAddr && photoCat && rowCat === photoCat) { bestRow = i; break; }
    }

    // Address only match
    if (bestRow < 0) {
      for (let i = 1; i < readData.values.length; i++) {
        const rowAddr = (readData.values[i][1] || '').toString().trim();
        if (photoAddr && rowAddr === photoAddr) { bestRow = i; break; }
      }
    }

    if (bestRow < 0) return { matched: false, reason: 'No matching row for address=' + address + ' category=' + category };

    const rowNum = bestRow + 1;
    const writeRange = `'${SHEET_TAB}'!H${rowNum}`;
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`;
    const writeResp = await fetch(writeUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: writeRange, majorDimension: 'ROWS', values: [[cellValue]] }),
    });
    const writeData = await writeResp.json();
    if (writeData.error) return { matched: false, reason: JSON.stringify(writeData.error) };
    return { matched: true, row: rowNum, method: 'fallback' };
  } catch (e) {
    return { matched: false, reason: e.message };
  }
}

export default async (req, context) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const store = getStore("photos");
    const metaStore = getStore("photo-meta");

    if (key) {
      const blob = await store.get(key, { type: "arrayBuffer" });
      if (!blob) return new Response("Not found", { status: 404 });
      let mime = "image/jpeg";
      try {
        const m = await metaStore.get(key, { type: "json" });
        if (m && m.mimeType) mime = m.mimeType;
      } catch (e) {}
      return new Response(blob, { headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" } });
    }

    const { blobs } = await metaStore.list();
    const photos = [];
    for (const b of blobs) {
      try {
        const m = await metaStore.get(b.key, { type: "json" });
        photos.push({ key: b.key, ...m });
      } catch (e) {}
    }
    return new Response(JSON.stringify({ photos }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { photoName, fileBase64, fileMimeType, address, category, description, timestamp, rowNumber } = body;
      if (!fileBase64 || !photoName) {
        return new Response(JSON.stringify({ error: "Missing fileBase64 or photoName" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const binary = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
      const store = getStore("photos");
      await store.set(photoName, binary);
      const photoUrl = SITE_URL + "/api/photos?key=" + encodeURIComponent(photoName);
      const metaStore = getStore("photo-meta");
      await metaStore.setJSON(photoName, {
        photoName, mimeType: fileMimeType || "image/jpeg",
        address: address || "",
        category: category || "", description: description || "",
        timestamp: timestamp || new Date().toISOString(),
        rowNumber: rowNumber || "", url: photoUrl
      });

      const sheetResult = await addPhotoUrlToSheet(photoUrl, address, category, rowNumber);

      return new Response(JSON.stringify({ success: true, photoName, url: photoUrl, sheet: sheetResult }), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Upload failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing ?key= parameter" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const store = getStore("photos");
    const metaStore = getStore("photo-meta");
    await store.delete(key);
    await metaStore.delete(key);
    return new Response(JSON.stringify({ success: true, deleted: key }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/photos" };
