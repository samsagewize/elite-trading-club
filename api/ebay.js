// eBay SOLD listings only. Fetches eBay's public sold/completed search page
// (LH_Sold=1&LH_Complete=1) and reads price, sold date and title. If eBay
// blocks the request we say so and return only the sold-search link.
const { BROWSER_UA, GAMES, send, fetchWithTimeout, cleanQuery } = require("./_lib");

function soldUrl(q) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
}

function decode(s) {
  return String(s || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSold(html) {
  const out = [];
  // Split into result cards (newer "s-card" layout and older "s-item" layout).
  const chunks = html.split(/<li[^>]+class="[^"]*\b(?:s-card|s-item)\b[^"]*"/i).slice(1);
  for (const raw of chunks) {
    const chunk = raw.slice(0, 20000);
    const text = decode(chunk);
    if (/Shop on eBay/i.test(text)) continue;
    const dateM = text.match(/Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    if (!dateM) continue;
    let title = "";
    const tM =
      chunk.match(/class="[^"]*(?:s-card__title|s-item__title)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|h3|span)>/i) ||
      chunk.match(/<img[^>]+alt="([^"]+)"/i);
    if (tM) title = decode(tM[1]).replace(/^New Listing\s*/i, "").replace(/Opens in a new window or tab$/i, "").trim();
    const pM =
      chunk.match(/class="[^"]*(?:s-card__price|s-item__price)[^"]*"[^>]*>([\s\S]*?)<\/span>\s*(?:<\/span>)?/i);
    const priceText = pM ? decode(pM[1]) : "";
    const nums = priceText.match(/\$\s?[\d,]+(?:\.\d{2})?/g);
    if (!nums) continue;
    const price = Number(nums[0].replace(/[$,\s]/g, ""));
    const linkM = chunk.match(/href="(https:\/\/www\.ebay\.com\/itm\/\d+)[^"]*"/i);
    out.push({
      title,
      price,
      priceText: nums.length > 1 ? `${nums[0]} to ${nums[1]}` : nums[0],
      date: dateM[1],
      url: linkM ? linkM[1] : null,
    });
    if (out.length >= 30) break;
  }
  return out;
}

module.exports = async (req, res) => {
  const { game = "pokemon", q } = req.query || {};
  if (!GAMES[game]) return send(res, 400, { error: "Only Pokémon and One Piece are supported." });
  const query = cleanQuery(q);
  if (!query) return send(res, 400, { error: "Enter a card name." });
  const fullQuery = `${GAMES[game].ebayWord} ${query}`;
  const url = soldUrl(fullQuery);
  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const html = await r.text();
    const challenged = /captcha|Pardon Our Interruption|splashui\/challenge/i.test(html.slice(0, 50000)) && !/s-(card|item)__price/.test(html);
    if (!r.ok || challenged) {
      return send(res, 200, { source: "eBay sold listings", query: fullQuery, url, blocked: true, status: r.status, sales: [] }, 120);
    }
    const sales = parseSold(html);
    return send(res, 200, { source: "eBay sold listings", query: fullQuery, url, blocked: false, sales }, 900);
  } catch (e) {
    console.error("ebay failed", e && e.message);
    return send(res, 200, { source: "eBay sold listings", query: fullQuery, url, blocked: true, error: "eBay did not answer.", sales: [] });
  }
};
