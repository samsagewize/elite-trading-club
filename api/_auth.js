// Session cookies, password hashing (scrypt), user records, and basic rate limits.
const crypto = require("crypto");
const store = require("./_store");
const { emailKey, isValidEmail, normalizeEmail, readSubscriber } = require("./_email");

const COOKIE = "etc_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const TIERS = [
  { id: "bronze", name: "Bronze", min: 0 },
  { id: "silver", name: "Silver", min: 100 },
  { id: "gold", name: "Gold", min: 250 },
];

function clientIp(req) {
  const x = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return x || String(req.headers["x-real-ip"] || "") || "unknown";
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET missing");
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function unsign(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || !token.includes(".")) return null;
  const i = token.lastIndexOf(".");
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

function cookieHeader(token, maxAge) {
  const v = token ? `${COOKIE}=${token}` : `${COOKIE}=`;
  return `${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function setSession(res, user, days = 30) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const token = sign({ uid: user.id, v: user.tokenVersion || 1, exp });
  res.setHeader("Set-Cookie", cookieHeader(token, days * 86400));
}

function clearSession(res) {
  res.setHeader("Set-Cookie", cookieHeader("", 0));
}

function scrypt(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { algo: "scrypt", salt: salt.toString("base64"), hash: hash.toString("base64"), ...SCRYPT };
}

async function verifyPassword(password, stored) {
  if (!stored || stored.algo !== "scrypt") return false;
  const salt = Buffer.from(stored.salt, "base64");
  const hash = await scrypt(password, salt, stored.keylen || 32, {
    N: stored.N || 16384,
    r: stored.r || 8,
    p: stored.p || 1,
  });
  const a = hash;
  const b = Buffer.from(stored.hash, "base64");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function rateLimit(kind, key, limit, windowMs) {
  const path = `rate/${kind}/${emailKey(String(key))}.json`;
  const now = Date.now();
  const rec = (await store.readJSON(path)) || { n: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) {
    rec.n = 0;
    rec.resetAt = now + windowMs;
  }
  rec.n += 1;
  await store.writeJSON(path, rec);
  return rec.n > limit ? { ok: false, retryAt: rec.resetAt } : { ok: true };
}

function userPath(id) {
  return `users/u/${id}.json`;
}
function emailIndexPath(email) {
  return `users/email/${emailKey(email)}.json`;
}

async function readUser(id) {
  return store.readJSON(userPath(id));
}

async function saveUser(user) {
  await store.writeJSON(userPath(user.id), user);
}

async function findUserByEmail(email) {
  const idx = await store.readJSON(emailIndexPath(email));
  if (!idx || !idx.id) return null;
  return readUser(idx.id);
}

async function currentUser(req) {
  const data = unsign(parseCookies(req)[COOKIE]);
  if (!data || !data.uid || data.exp < Math.floor(Date.now() / 1000)) return null;
  const user = await readUser(data.uid);
  if (!user || (user.tokenVersion || 1) !== data.v) return null;
  return user;
}

function tierFor(verified) {
  let t = TIERS[0];
  for (const x of TIERS) if (verified >= x.min) t = x;
  const i = TIERS.findIndex((x) => x.id === t.id);
  const next = TIERS[i + 1] || null;
  const progress = next ? Math.min(1, Math.max(0, (verified - t.min) / (next.min - t.min))) : 1;
  return { id: t.id, name: t.name, min: t.min, next: next ? next.name : null, nextAt: next ? next.min : null, progress };
}

function publicUser(user) {
  if (!user) return null;
  const verified = user.pointsVerified || 0;
  const pending = user.pointsPending || 0;
  return {
    id: user.id,
    email: user.email,
    name: user.name || "",
    createdAt: user.createdAt,
    subscriber: !!user.subscriber,
    pointsVerified: verified,
    pointsPending: pending,
    tier: tierFor(verified),
  };
}

async function linkSubscriber(user) {
  const rec = await readSubscriber(user.email);
  const was = !!user.subscriber;
  user.subscriber = !!rec;
  return user.subscriber !== was;
}

async function createUser({ email, password, name }) {
  const existing = await findUserByEmail(email);
  if (existing) return { error: "An account with this email already exists. Try logging in.", status: 409 };
  const id = crypto.randomBytes(12).toString("hex");
  const user = {
    id,
    email,
    name: name || "",
    pass: await hashPassword(password),
    createdAt: new Date().toISOString(),
    tokenVersion: 1,
    subscriber: false,
    pointsPending: 0,
    pointsVerified: 0,
    entryIds: [],
  };
  await linkSubscriber(user);
  await store.writeJSON(emailIndexPath(email), { id });
  await saveUser(user);
  return { user };
}

async function listUsers() {
  const paths = (await store.listPaths("users/u/")).filter((p) => p.endsWith(".json"));
  const users = [];
  for (let i = 0; i < paths.length; i += 20) {
    const chunk = await Promise.all(paths.slice(i, i + 20).map((p) => store.readJSON(p)));
    chunk.forEach((u) => u && users.push(u));
  }
  users.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return users;
}


function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  const authz = String(req.headers.authorization || "");
  const given = authz.startsWith("Bearer ") ? authz.slice(7) : String((req.query && req.query.token) || "");
  return !!(expected && given && safeEqual(given, expected));
}

module.exports = {
  COOKIE,
  TIERS,
  isValidEmail,
  normalizeEmail,
  clientIp,
  setSession,
  clearSession,
  currentUser,
  hashPassword,
  verifyPassword,
  rateLimit,
  readUser,
  saveUser,
  findUserByEmail,
  createUser,
  linkSubscriber,
  publicUser,
  tierFor,
  listUsers,
  safeEqual,
  isAdmin,
};
