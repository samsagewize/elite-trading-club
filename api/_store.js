// Small JSON store on Vercel Blob (private store "etc-card-search").
// Falls back to memory when BLOB_READ_WRITE_TOKEN is missing (local tests).
const blob = require("@vercel/blob");

const HAS_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const mem = new Map();

async function readJSON(pathname) {
  if (!HAS_BLOB) return mem.has(pathname) ? JSON.parse(mem.get(pathname)) : null;
  try {
    const r = await blob.get(pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (e && /not.?found/i.test(String(e.name || e.message))) return null;
    console.error("blob read failed", pathname, e && e.message);
    return null;
  }
}

async function writeJSON(pathname, data) {
  const body = JSON.stringify(data);
  if (!HAS_BLOB) { mem.set(pathname, body); return; }
  await blob.put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

async function listPaths(prefix) {
  if (!HAS_BLOB) return [...mem.keys()].filter((k) => k.startsWith(prefix));
  const out = [];
  let cursor;
  do {
    const r = await blob.list({ prefix, cursor, limit: 1000 });
    r.blobs.forEach((b) => out.push(b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// ---------- Learning index ----------
// learn/index.json = {
//   keys:     { "<game>|<read key>": { "<productId>": weight } },  // read text/number -> confirmed card
//   products: { "<productId>": { name, set, number, game, image, picks, searches, last } },
//   recent:   [ { id, at } ]                                         // newest first
// }
const INDEX = "learn/index.json";
let indexCache = null;
let indexAt = 0;

async function loadIndex(fresh) {
  if (!fresh && indexCache && Date.now() - indexAt < 30000) return indexCache;
  const idx = (await readJSON(INDEX)) || {};
  idx.keys = idx.keys || {};
  idx.products = idx.products || {};
  idx.recent = idx.recent || [];
  indexCache = idx;
  indexAt = Date.now();
  return idx;
}

async function saveIndex(idx) {
  // keep it bounded
  const keyNames = Object.keys(idx.keys);
  if (keyNames.length > 4000) keyNames.slice(0, keyNames.length - 4000).forEach((k) => delete idx.keys[k]);
  idx.recent = idx.recent.slice(0, 40);
  idx.updatedAt = new Date().toISOString();
  await writeJSON(INDEX, idx);
  indexCache = idx;
  indexAt = Date.now();
}

function normNumber(n) {
  return String(n || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\d+/g, (d) => String(Number(d)));
}

function readKeys(game, read) {
  const keys = new Set();
  (read.numbers || []).forEach((n) => {
    if (n && n.number) keys.add(`${game}|n:${normNumber(n.number)}`);
    if (n && n.raw) keys.add(`${game}|r:${String(n.raw).toUpperCase().replace(/\s+/g, "")}`);
  });
  if (read.query) keys.add(`${game}|q:${String(read.query).toLowerCase().replace(/\s+/g, " ").trim()}`);
  if (read.name) keys.add(`${game}|name:${String(read.name).toLowerCase().trim()}`);
  return [...keys].filter((k) => k.length < 120);
}

// Weight of each productId for a set of read keys.
function boosts(idx, keys) {
  const out = {};
  keys.forEach((k) => {
    const m = idx.keys[k];
    if (m) Object.keys(m).forEach((id) => { out[id] = (out[id] || 0) + m[id]; });
  });
  return out;
}

module.exports = { HAS_BLOB, readJSON, writeJSON, listPaths, loadIndex, saveIndex, normNumber, readKeys, boosts };
