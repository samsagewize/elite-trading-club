// POST /api/signup { email, consent: true }
const { send } = require("./_lib");
const { normalizeEmail, isValidEmail, saveSubscriber, CONSENT } = require("./_email");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const email = normalizeEmail(b.email);
  if (!isValidEmail(email)) return send(res, 400, { error: "Please enter a valid email address." });
  if (b.consent !== true) return send(res, 400, { error: "Please tick the box to join." });

  try {
    const { already } = await saveSubscriber({
      email,
      source: "card-search",
      consent: CONSENT["card-search"],
    });
    res.setHeader("Set-Cookie", "etc_member=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure");
    return send(res, 200, { ok: true, already });
  } catch (e) {
    console.error("signup failed", e && e.message);
    return send(res, 500, { error: "Couldn't save that right now. Please try again." });
  }
};
