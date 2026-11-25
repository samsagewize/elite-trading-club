// GET /api/rewards  current user's profile + entries
// POST /api/rewards  log a bought/sold card
// GET /api/rewards?photo=<id>  entry photo (owner or skipped)
const { send } = require("./_lib");
const auth = require("./_auth");
const rewards = require("./_rewards");

function readBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

async function sendPhoto(req, res, id) {
  const user = await auth.currentUser(req);
  const entry = await rewards.readEntry(id);
  if (!entry || !entry.hasPhoto) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    return res.end("Not found");
  }
  const isOwner = user && user.id === entry.userId;
  if (!isOwner && !auth.isAdmin(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain");
    return res.end("Unauthorized");
  }
  const file = await rewards.getPhoto(id);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    return res.end("Not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", file.contentType || "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=60");
  const buf = Buffer.from(await new Response(file.stream).arrayBuffer());
  res.end(buf);
}

module.exports = async (req, res) => {
  const photoId = req.query && req.query.photo;
  if (req.method === "GET" && photoId) return sendPhoto(req, res, String(photoId).slice(0, 40));

  const user = await auth.currentUser(req);
  if (!user) return send(res, 401, { error: "Please log in to see your rewards." });

  if (req.method === "GET") {
    const entries = await rewards.retallyUser(user);
    await auth.saveUser(user);
    return send(res, 200, {
      user: auth.publicUser(user),
      entries: entries.map(rewards.publicEntry),
      rules: {
        perCard: rewards.POINTS.perCard,
        bonus: rewards.POINTS.bonus,
        first: rewards.POINTS.first,
        tiers: auth.TIERS,
        note: "Rewards and perks are redeemable for store perks. Details are available from the club. This is not money, cash, or a promise of profit.",
      },
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });

  const ipLimit = await auth.rateLimit("entry-ip", auth.clientIp(req), 20, 60 * 60 * 1000);
  const uLimit = await auth.rateLimit("entry-user", user.id, 20, 60 * 60 * 1000);
  if (!ipLimit.ok || !uLimit.ok) return send(res, 429, { error: "That's a lot of entries at once. Please wait and try again." });

  try {
    const result = await rewards.createEntry(user, readBody(req));
    if (result.error) return send(res, result.status || 400, { error: result.error });
    const entries = await rewards.retallyUser(user);
    await auth.saveUser(user);
    return send(res, 200, {
      ok: true,
      entry: rewards.publicEntry(result.entry),
      user: auth.publicUser(user),
      entries: entries.map(rewards.publicEntry),
    });
  } catch (e) {
    console.error("rewards write failed", e && e.message);
    return send(res, 500, { error: "Couldn't save that entry right now. Please try again." });
  }
};
