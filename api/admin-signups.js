// GET /api/admin-signups  with header  Authorization: Bearer <ADMIN_TOKEN>
// Returns every sign-up as CSV (email, created_at, consent, source).
const crypto = require("crypto");
const store = require("./_store");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function csv(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = async (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  const auth = String(req.headers.authorization || "");
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : String((req.query && req.query.token) || "");
  res.setHeader("Cache-Control", "no-store");
  if (!expected || !given || !safeEqual(given, expected)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain");
    return res.end("Unauthorized");
  }
  const paths = await store.listPaths("signups/");
  const rows = [];
  for (let i = 0; i < paths.length; i += 20) {
    const chunk = await Promise.all(paths.slice(i, i + 20).map((p) => store.readJSON(p)));
    chunk.forEach((r) => r && rows.push(r));
  }
  rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const out = ["email,created_at,consent,source"].concat(rows.map((r) => [r.email, r.createdAt, r.consent, r.source].map(csv).join(",")));
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="etc-signups.csv"');
  res.end(out.join("\n") + "\n");
};
