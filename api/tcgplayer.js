// GET /api/tcgplayer?game=pokemon&q=charizard%20ex%20223/197  -> matching products (learned picks first)
// GET /api/tcgplayer?id=509980                                -> latest sales + saved sale history
const { GAMES, send, cleanQuery } = require("./_lib");
const { searchProducts, latestSales } = require("./_tcg");
const store = require("./_store");

function saleKey(s) {
  return [s.date, s.price, s.condition, s.variant, s.quantity].join("|");
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function salesFor(id) {
  const path = `sales/${id}.json`;
  let live = null, error = null;
  try { live = await latestSales(id); } catch (e) { error = e.message; }
  const saved = (await store.readJSON(path)) || { id: Number(id), sales: [] };

  if (live) {
    const have = new Set(saved.sales.map(saleKey));
    const fresh = live.filter((s) => !have.has(saleKey(s)));
    if (fresh.length) {
      saved.sales = fresh.concat(saved.sales)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 600);
      saved.updatedAt = new Date().toISOString();
      store.writeJSON(path, saved).catch((e) => console.error("sales save failed", e && e.message));
    }
  }

  const history = saved.sales;
  const cutoff = Date.now() - 30 * 864e5;
  const nm30 = history.filter((s) => s.condition === "Near Mint" && new Date(s.date).getTime() >= cutoff).map((s) => s.price);
  return {
    sales: live || history.slice(0, 25),
    fromHistory: !live,
    error,
    history: {
      count: history.length,
      since: history.length ? history[history.length - 1].date : null,
      nearMint30dMedian: median(nm30),
      nearMint30dCount: nm30.length,
    },
  };
}

module.exports = async (req, res) => {
  const { game = "pokemon", q, id } = req.query || {};
  try {
    if (id) {
      if (!/^\d{1,9}$/.test(String(id))) return send(res, 400, { error: "Bad product id" });
      const r = await salesFor(id);
      if (!r.sales.length && r.error) return send(res, 502, { error: "TCGplayer did not answer.", blocked: true });
      return send(res, 200, {
        source: "TCGplayer latest sales",
        productId: Number(id),
        url: `https://www.tcgplayer.com/product/${id}`,
        ...r,
      }, 300);
    }
    if (!GAMES[game]) return send(res, 400, { error: "Only Pokémon and One Piece are supported." });
    const query = cleanQuery(q);
    if (!query) return send(res, 400, { error: "Enter a card name." });
    let products = await searchProducts(game, query);

    // Learned picks: cards people confirmed for this same search go first.
    const idx = await store.loadIndex();
    const numberLike = query.match(/[A-Z]{2,3}\d{2}-\d{3}|\d{1,3}\/\d{2,3}/i);
    const keys = store.readKeys(game, { query, numbers: numberLike ? [{ number: numberLike[0] }] : [] });
    const boost = store.boosts(idx, keys);
    products = products
      .map((p, i) => ({ p, i, b: boost[p.id] || 0 }))
      .sort((a, b) => b.b - a.b || (b.p.marketPrice != null) - (a.p.marketPrice != null) || a.i - b.i)
      .map((o) => ({ ...o.p, learned: o.b > 0 }));

    return send(res, 200, {
      source: "TCGplayer search",
      game,
      query,
      products,
      searchUrl: `https://www.tcgplayer.com/search/${GAMES[game].tcgLine}/product?q=${encodeURIComponent(query)}&productLineName=${GAMES[game].tcgLine}`,
    }, 60);
  } catch (e) {
    console.error("tcgplayer failed", e && e.message);
    return send(res, 502, { error: "TCGplayer did not answer.", blocked: true });
  }
};
