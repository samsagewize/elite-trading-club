// POST /api/signup { email, consent: true }
const crypto = require("crypto");
const { send } = require("./_lib");
const store = require("./_store");

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
const CONSENT = "Get card alerts from Elite Trading Club. Unsubscribe anytime.";

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const email = String(b.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return send(res, 400, { error: "Please enter a valid email address." });
  if (b.consent !== true) return send(res, 400, { error: "Please tick the box to join." });

  const key = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
  const path = `signups/${key}.json`;
  try {
    const existing = await store.readJSON(path);
    if (!existing) {
      await store.writeJSON(path, {
        email,
        createdAt: new Date().toISOString(),
        consent: CONSENT,
        source: "card-search",
      });
    }
    res.setHeader("Set-Cookie", "etc_member=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure");
    return send(res, 200, { ok: true, already: !!existing });
  } catch (e) {
    console.error("signup failed", e && e.message);
    return send(res, 500, { error: "Couldn't save that right now. Please try again." });
  }
};
