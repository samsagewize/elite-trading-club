// TCGplayer data from the same public endpoints tcgplayer.com's own pages call.
//   GET /api/tcgplayer?game=pokemon&q=charizard%20ex%20223/197  -> matching products
//   GET /api/tcgplayer?id=509980                                -> latest sales for one product
const { BROWSER_UA, GAMES, send, fetchWithTimeout, cleanQuery } = require("./_lib");

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "User-Agent": BROWSER_UA,
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

async function searchProducts(game, q) {
  const line = GAMES[game].tcgLine;
  const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(q)}&isList=false`;
  const payload = {
    algorithm: "sales_synonym_v2",
    from: 0,
    size: 12,
    filters: { term: { productLineName: [line], productTypeName: ["Cards"] }, range: {}, match: {} },
    listingSearch: {
      context: { cart: {} },
      filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } },
    },
    context: { cart: {}, shippingCountry: "US" },
    settings: { useFuzzySearch: true, didYouMean: {} },
    sort: {},
  };
  const r = await fetchWithTimeout(url, { method: "POST", headers: HEADERS, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`TCGplayer search HTTP ${r.status}`);
  const d = await r.json();
  const rows = (d && d.results && d.results[0] && d.results[0].results) || [];
  return rows.map((x) => {
    const id = Math.round(Number(x.productId));
    const attrs = x.customAttributes || {};
    return {
      id,
      name: x.productName,
      set: x.setName,
      number: attrs.number || "",
      rarity: x.rarityName || "",
      marketPrice: typeof x.marketPrice === "number" ? x.marketPrice : null,
      lowestPrice: typeof x.lowestPrice === "number" ? x.lowestPrice : null,
      image: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_200x200.jpg`,
      url: `https://www.tcgplayer.com/product/${id}`,
    };
  });
}

async function latestSales(id) {
  const url = `https://mpapi.tcgplayer.com/v2/product/${id}/latestsales`;
  const payload = { conditions: [], languages: [], variants: [], listingType: "All", offset: 0, limit: 25, time: Date.now() };
  const r = await fetchWithTimeout(url, { method: "POST", headers: HEADERS, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`TCGplayer latest sales HTTP ${r.status}`);
  const d = await r.json();
  return (d.data || []).map((s) => ({
    date: s.orderDate,
    condition: s.condition,
    variant: s.variant,
    language: s.language,
    quantity: s.quantity,
    price: s.purchasePrice,
    shipping: s.shippingPrice,
    title: s.title,
  }));
}

module.exports = async (req, res) => {
  const { game = "pokemon", q, id } = req.query || {};
  try {
    if (id) {
      if (!/^\d{1,9}$/.test(String(id))) return send(res, 400, { error: "Bad product id" });
      const sales = await latestSales(id);
      return send(res, 200, { source: "TCGplayer latest sales", productId: Number(id), url: `https://www.tcgplayer.com/product/${id}`, sales }, 300);
    }
    if (!GAMES[game]) return send(res, 400, { error: "Only Pokémon and One Piece are supported." });
    const query = cleanQuery(q);
    if (!query) return send(res, 400, { error: "Enter a card name." });
    const products = await searchProducts(game, query);
    return send(res, 200, {
      source: "TCGplayer search",
      game,
      query,
      products,
      searchUrl: `https://www.tcgplayer.com/search/${GAMES[game].tcgLine}/product?q=${encodeURIComponent(query)}&productLineName=${GAMES[game].tcgLine}`,
    }, 600);
  } catch (e) {
    console.error("tcgplayer failed", e && e.message);
    return send(res, 502, { error: "TCGplayer did not answer.", blocked: true, detail: String(e && e.message).slice(0, 120) });
  }
};
