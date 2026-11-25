// GET  /api/admin-signups                 CSV of subscribers (email, created_at, consent, source)
// GET  /api/admin-signups?type=profiles   CSV or JSON (?format=json) of profiles
// GET  /api/admin-signups?type=entries    CSV or JSON of all bought/sold card entries
// POST /api/admin-signups                 { action: "approve"|"reject", id, note? }
// Auth: Authorization: Bearer <ADMIN_TOKEN>  (or ?token=). Never log the token.
const { send } = require("./_lib");
const store = require("./_store");
const auth = require("./_auth");
const rewards = require("./_rewards");

function csv(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendCsv(res, filename, header, rows) {
  const out = [header.join(",")].concat(rows.map((r) => r.map(csv).join(",")));
  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(out.join("\n") + "\n");
}

async function exportSignups(res) {
  const paths = await store.listPaths("signups/");
  const rows = [];
  for (let i = 0; i < paths.length; i += 20) {
    const chunk = await Promise.all(paths.slice(i, i + 20).map((p) => store.readJSON(p)));
    chunk.forEach((r) => r && rows.push(r));
  }
  rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  sendCsv(res, "etc-signups.csv", ["email", "created_at", "consent", "source"],
    rows.map((r) => [r.email, r.createdAt, r.consent, r.source]));
}

async function exportProfiles(res, asJson) {
  const users = await auth.listUsers();
  const list = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name || "",
    created_at: u.createdAt,
    subscriber: !!u.subscriber,
    points_pending: u.pointsPending || 0,
    points_verified: u.pointsVerified || 0,
    tier: auth.tierFor(u.pointsVerified || 0).name,
    entries: (u.entryIds || []).length,
  }));
  if (asJson) return send(res, 200, { profiles: list });
  sendCsv(res, "etc-profiles.csv",
    ["id", "email", "name", "created_at", "subscriber", "points_pending", "points_verified", "tier", "entries"],
    list.map((r) => [r.id, r.email, r.name, r.created_at, r.subscriber, r.points_pending, r.points_verified, r.tier, r.entries]));
}

async function exportEntries(res, asJson) {
  const entries = await rewards.listAllEntries();
  const list = entries.map((e) => ({
    id: e.id,
    user_id: e.userId,
    email: e.email,
    type: e.type,
    game: e.game,
    card_name: e.cardName,
    set: e.set || "",
    number: e.number || "",
    condition: e.condition || "",
    price: e.price,
    date: e.date,
    ref: e.ref || "",
    has_photo: !!e.hasPhoto,
    points: e.points,
    bonus: e.bonus,
    first_bonus: e.firstBonus || 0,
    status: e.status,
    created_at: e.createdAt,
    reviewed_at: e.reviewedAt || "",
    review_note: e.reviewNote || "",
  }));
  if (asJson) return send(res, 200, { entries: list });
  sendCsv(res, "etc-entries.csv",
    ["id", "user_id", "email", "type", "game", "card_name", "set", "number", "condition", "price", "date", "ref", "has_photo", "points", "bonus", "first_bonus", "status", "created_at", "reviewed_at", "review_note"],
    list.map((r) => [r.id, r.user_id, r.email, r.type, r.game, r.card_name, r.set, r.number, r.condition, r.price, r.date, r.ref, r.has_photo, r.points, r.bonus, r.first_bonus, r.status, r.created_at, r.reviewed_at, r.review_note]));
}

async function review(req, res) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const action = String(b.action || "").toLowerCase();
  if (action !== "approve" && action !== "reject") return send(res, 400, { error: "action must be approve or reject" });
  const id = String(b.id || "").slice(0, 40);
  const entry = await rewards.readEntry(id);
  if (!entry) return send(res, 404, { error: "Entry not found." });
  entry.status = action === "approve" ? "verified" : "rejected";
  entry.reviewedAt = new Date().toISOString();
  if (b.note) entry.reviewNote = String(b.note).slice(0, 200);
  await rewards.saveEntry(entry);
  const user = await auth.readUser(entry.userId);
  if (user) {
    await rewards.retallyUser(user);
    await auth.saveUser(user);
  }
  return send(res, 200, {
    ok: true,
    entry: rewards.publicEntry(entry),
    user: user ? auth.publicUser(user) : null,
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!auth.isAdmin(req)) {
    if (req.method === "GET" && !(req.query && (req.query.type || req.query.format))) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain");
      return res.end("Unauthorized");
    }
    return send(res, 401, { error: "Unauthorized" });
  }
  try {
    if (req.method === "POST") return review(req, res);
    if (req.method !== "GET") return send(res, 405, { error: "Use GET or POST" });
    const type = String((req.query && req.query.type) || "");
    const asJson = String((req.query && req.query.format) || "") === "json";
    if (type === "profiles") return exportProfiles(res, asJson);
    if (type === "entries") return exportEntries(res, asJson);
    return exportSignups(res);
  } catch (e) {
    console.error("admin export failed", e && e.message);
    return send(res, 500, { error: "Couldn't load that right now." });
  }
};
