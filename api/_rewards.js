// Reward entries, point rules, and photo helpers.
const crypto = require("crypto");
const blob = require("@vercel/blob");
const store = require("./_store");

const GAMES = { pokemon: "Pokémon", onepiece: "One Piece" };
const TYPES = { bought: "Bought from us", sold: "Sold to us" };
const POINTS = { perCard: 10, bonus: 5, first: 50 };

function pointsOf(e) {
  if (!e || e.status === "rejected") return 0;
  return (Number(e.points) || 0) + (Number(e.bonus) || 0) + (Number(e.firstBonus) || 0);
}

function tally(entries) {
  let pointsPending = 0, pointsVerified = 0;
  for (const e of entries) {
    const n = pointsOf(e);
    if (e.status === "verified") pointsVerified += n;
    else if (e.status === "pending") pointsPending += n;
  }
  return { pointsPending, pointsVerified };
}

function entryPath(id) { return `entries/${id}.json`; }
function photoPath(id) { return `entries/${id}.jpg`; }

async function readEntry(id) {
  return store.readJSON(entryPath(id));
}

async function saveEntry(entry) {
  await store.writeJSON(entryPath(entry.id), entry);
}

async function listEntries(ids) {
  const out = [];
  if (!ids || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = await Promise.all(ids.slice(i, i + 20).map((id) => readEntry(id)));
    chunk.forEach((e) => e && out.push(e));
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

async function listAllEntries() {
  const paths = (await store.listPaths("entries/")).filter((p) => p.endsWith(".json"));
  const ids = paths.map((p) => p.replace(/^entries\//, "").replace(/\.json$/, ""));
  return listEntries(ids);
}

function publicEntry(e) {
  if (!e) return null;
  return {
    id: e.id,
    type: e.type,
    game: e.game,
    cardName: e.cardName,
    set: e.set || "",
    number: e.number || "",
    condition: e.condition || "",
    price: e.price,
    date: e.date,
    ref: e.ref || "",
    productId: e.productId || null,
    hasPhoto: !!e.hasPhoto,
    photoUrl: e.hasPhoto ? `/api/rewards?photo=${encodeURIComponent(e.id)}` : null,
    points: e.points,
    bonus: e.bonus,
    firstBonus: e.firstBonus || 0,
    totalPoints: pointsOf({ ...e, status: "pending" }),
    status: e.status,
    createdAt: e.createdAt,
    reviewedAt: e.reviewedAt || null,
  };
}

function trim(v, max) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parsePrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return null;
  return Math.round(n * 100) / 100;
}

function parseDate(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const min = new Date("2000-01-01T00:00:00Z");
  const max = new Date(Date.now() + 86400000);
  if (d < min || d > max) return null;
  return s;
}

function decodePhoto(raw) {
  if (!raw) return null;
  let s = String(raw);
  const m = s.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (m) s = m[2];
  else if (/^data:/i.test(s)) return { error: "Please attach a JPEG, PNG or WebP photo." };
  if (s.length > 900000) return { error: "That photo is too large. Try a smaller picture." };
  let buf;
  try { buf = Buffer.from(s, "base64"); } catch { return { error: "That photo could not be read." }; }
  if (!buf || buf.length < 32 || buf.length > 650000) return { error: "That photo is too large. Try a smaller picture." };
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf.length > 12 && buf.slice(8, 12).toString() === "WEBP";
  if (!isJpeg && !isPng && !isWebp) return { error: "Please attach a JPEG, PNG or WebP photo." };
  return { buf, type: isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg" };
}

async function putPhoto(id, buf, type) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await blob.put(photoPath(id), buf, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: type,
    cacheControlMaxAge: 60,
  });
}

async function getPhoto(id) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const r = await blob.get(photoPath(id), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return r;
  } catch {
    return null;
  }
}

function validateBody(b, { isFirst }) {
  const type = String(b.type || "");
  if (!TYPES[type]) return { error: "Please choose whether you bought this card from us or sold it to us." };
  const game = String(b.game || "");
  if (!GAMES[game]) return { error: "Please choose Pokémon or One Piece." };
  const cardName = trim(b.cardName || b.name, 120);
  if (cardName.length < 2) return { error: "Please enter the card name." };
  const set = trim(b.set, 80);
  const number = trim(b.number, 40);
  const condition = trim(b.condition, 60);
  const price = parsePrice(b.price);
  if (price == null) return { error: "Please enter a valid price." };
  const date = parseDate(b.date);
  if (!date) return { error: "Please enter the date of the purchase or sale." };
  const ref = trim(b.ref, 80);
  const productId = b.productId ? String(b.productId).slice(0, 20) : "";
  const photo = b.photo ? decodePhoto(b.photo) : null;
  if (photo && photo.error) return { error: photo.error };
  const hasPhoto = !!(photo && photo.buf);
  const bonus = hasPhoto || ref ? POINTS.bonus : 0;
  const firstBonus = isFirst ? POINTS.first : 0;
  return {
    entry: {
      type,
      game,
      cardName,
      set,
      number,
      condition,
      price,
      date,
      ref,
      productId: productId || null,
      hasPhoto,
      points: POINTS.perCard,
      bonus,
      firstBonus,
      status: "pending",
    },
    photo,
  };
}

async function createEntry(user, body) {
  const isFirst = !(user.entryIds && user.entryIds.length);
  const v = validateBody(body, { isFirst });
  if (v.error) return { error: v.error, status: 400 };
  const id = crypto.randomBytes(12).toString("hex");
  const entry = {
    id,
    userId: user.id,
    email: user.email,
    ...v.entry,
    createdAt: new Date().toISOString(),
  };
  if (v.photo && v.photo.buf) {
    try { await putPhoto(id, v.photo.buf, v.photo.type); }
    catch (e) {
      console.error("photo put failed", e && e.message);
      return { error: "Couldn't save that photo. You can still log the card without one.", status: 500 };
    }
    entry.hasPhoto = true;
  }
  await saveEntry(entry);
  user.entryIds = user.entryIds || [];
  user.entryIds.push(id);
  return { entry };
}

async function retallyUser(user) {
  const entries = await listEntries(user.entryIds || []);
  const t = tally(entries);
  user.pointsPending = t.pointsPending;
  user.pointsVerified = t.pointsVerified;
  return entries;
}

module.exports = {
  GAMES,
  TYPES,
  POINTS,
  pointsOf,
  tally,
  readEntry,
  saveEntry,
  listEntries,
  listAllEntries,
  publicEntry,
  createEntry,
  retallyUser,
  getPhoto,
  photoPath,
};
