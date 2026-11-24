// TCGplayer's public endpoints, the same ones tcgplayer.com's pages call.
const { BROWSER_UA, GAMES, fetchWithTimeout } = require("./_lib");

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "User-Agent": BROWSER_UA,
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

function productFromRow(x, game) {
  const id = Math.round(Number(x.productId));
  const attrs = x.customAttributes || {};
  return {
    id,
    game,
    name: x.productName,
    set: x.setName,
    number: attrs.number || "",
    rarity: x.rarityName || "",
    marketPrice: typeof x.marketPrice === "number" ? x.marketPrice : null,
    lowestPrice: typeof x.lowestPrice === "number" ? x.lowestPrice : null,
    listings: typeof x.totalListings === "number" ? x.totalListings : (Array.isArray(x.listings) ? x.listings.length : null),
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_400x400.jpg`,
    url: `https://www.tcgplayer.com/product/${id}`,
  };
}

async function searchProducts(game, q, size = 12) {
  const line = GAMES[game].tcgLine;
  const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(q)}&isList=false`;
  const payload = {
    algorithm: "sales_synonym_v2",
    from: 0,
    size,
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
  return rows.map((x) => productFromRow(x, game));
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
  }));
}

module.exports = { searchProducts, latestSales };
