// POST /api/auth?action=register|login|logout   GET /api/auth  (current user)
const { send } = require("./_lib");
const auth = require("./_auth");

function readBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

module.exports = async (req, res) => {
  const action = String((req.query && req.query.action) || "").toLowerCase();

  if (req.method === "GET") {
    const user = await auth.currentUser(req);
    if (!user) return send(res, 200, { user: null });
    const changed = await auth.linkSubscriber(user);
    if (changed) await auth.saveUser(user);
    return send(res, 200, { user: auth.publicUser(user) });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });

  if (action === "logout") {
    auth.clearSession(res);
    return send(res, 200, { ok: true });
  }

  if (!process.env.SESSION_SECRET) {
    return send(res, 500, { error: "Sign-in isn't available right now." });
  }

  const b = readBody(req);
  const email = auth.normalizeEmail(b.email);
  const password = String(b.password || "");
  const ip = auth.clientIp(req);

  if (action === "register") {
    if (!auth.isValidEmail(email)) return send(res, 400, { error: "Please enter a valid email address." });
    if (password.length < 8 || password.length > 128) return send(res, 400, { error: "Please choose a password of at least 8 characters." });
    const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const ipLimit = await auth.rateLimit("reg-ip", ip, 8, 60 * 60 * 1000);
    const emLimit = await auth.rateLimit("reg-email", email, 5, 60 * 60 * 1000);
    if (!ipLimit.ok || !emLimit.ok) return send(res, 429, { error: "Too many sign-up tries. Please wait and try again." });
    try {
      const result = await auth.createUser({ email, password, name });
      if (result.error) return send(res, result.status || 400, { error: result.error });
      auth.setSession(res, result.user);
      return send(res, 200, { ok: true, user: auth.publicUser(result.user) });
    } catch (e) {
      console.error("register failed", e && e.message);
      return send(res, 500, { error: "Couldn't create that profile right now. Please try again." });
    }
  }

  if (action === "login") {
    if (!auth.isValidEmail(email) || !password) return send(res, 400, { error: "Please enter your email and password." });
    const ipLimit = await auth.rateLimit("login-ip", ip, 30, 15 * 60 * 1000);
    const emLimit = await auth.rateLimit("login-email", email, 10, 15 * 60 * 1000);
    if (!ipLimit.ok || !emLimit.ok) return send(res, 429, { error: "Too many login tries. Please wait and try again." });
    try {
      const user = await auth.findUserByEmail(email);
      const ok = user && await auth.verifyPassword(password, user.pass);
      if (!ok) return send(res, 401, { error: "That email or password doesn't match." });
      const changed = await auth.linkSubscriber(user);
      if (changed) await auth.saveUser(user);
      auth.setSession(res, user);
      return send(res, 200, { ok: true, user: auth.publicUser(user) });
    } catch (e) {
      console.error("login failed", e && e.message);
      return send(res, 500, { error: "Couldn't log in right now. Please try again." });
    }
  }

  return send(res, 400, { error: "Unknown action." });
};
