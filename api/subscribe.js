// POST /api/subscribe { email, source? }
const { send } = require("./_lib");
const { normalizeEmail, isValidEmail, saveSubscriber } = require("./_email");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const email = normalizeEmail(b.email);
  if (!isValidEmail(email)) return send(res, 400, { error: "Please enter a valid email address." });
  const source = String(b.source || "home-subscribe").slice(0, 40);
  try {
    const { already } = await saveSubscriber({ email, source });
    return send(res, 200, {
      ok: true,
      already,
      message: already
        ? "You're already on the list. Thanks!"
        : "You're subscribed. Thanks for joining Elite Trading Club.",
    });
  } catch (e) {
    console.error("subscribe failed", e && e.message);
    return send(res, 500, { error: "Couldn't save that right now. Please try again." });
  }
};
