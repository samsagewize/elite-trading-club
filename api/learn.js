// POST /api/learn — saves one search and teaches the matcher.
// { event: "search" | "confirm", game, read: { source, numbers, name, query, text },
//   product: { id, name, set, number, image }, prices: [..], ebayUrl }
const crypto = require("crypto");
const { GAMES, send } = require("./_lib");
const store = require("./_store");

function clean(s, n) { return String(s == null ? "" : s).slice(0, n || 200); }

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const event = b.event === "confirm" ? "confirm" : "search";
  const game = GAMES[b.game] ? b.game : null;
  const p = b.product || {};
  const id = /^\d{1,9}$/.test(String(p.id)) ? String(p.id) : null;
  if (!game || !id) return send(res, 400, { error: "Missing game or product" });

  const read = b.read || {};
  const numbers = (Array.isArray(read.numbers) ? read.numbers : []).slice(0, 4).map((n) => ({
    game: clean(n.game, 10), number: clean(n.number, 20), raw: clean(n.raw, 30),
  }));
  const record = {
    at: new Date().toISOString(),
    event,
    game,
    read: {
      source: clean(read.source, 10),
      numbers,
      name: clean(read.name, 60),
      query: clean(read.query, 120),
      text: clean(read.text, 600),
    },
    product: { id: Number(id), name: clean(p.name, 120), set: clean(p.set, 120), number: clean(p.number, 30) },
    prices: (Array.isArray(b.prices) ? b.prices : []).slice(0, 25).filter((x) => typeof x === "number"),
    marketPrice: typeof b.marketPrice === "number" ? b.marketPrice : null,
    ebayUrl: clean(b.ebayUrl, 300),
  };

  try {
    const day = record.at.slice(0, 10);
    await store.writeJSON(`searches/${day}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`, record);

    const idx = await store.loadIndex(true);
    const prod = idx.products[id] || { picks: 0, searches: 0 };
    Object.assign(prod, {
      name: record.product.name, set: record.product.set, number: record.product.number, game,
      image: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_200x200.jpg`, last: record.at,
    });
    prod.searches += 1;
    if (event === "confirm") {
      prod.picks += 1;
      // Only cards a person confirmed teach the matcher.
      store.readKeys(game, record.read).forEach((k) => {
        idx.keys[k] = idx.keys[k] || {};
        idx.keys[k][id] = (idx.keys[k][id] || 0) + 1;
      });
    }
    idx.products[id] = prod;
    idx.recent = [{ id: Number(id), at: record.at }].concat(idx.recent.filter((r) => String(r.id) !== id));
    await store.saveIndex(idx);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error("learn failed", e && e.message);
    return send(res, 200, { ok: false });
  }
};
