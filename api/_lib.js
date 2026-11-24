const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const GAMES = {
  pokemon: { label: "Pokémon", tcgLine: "pokemon", ebayWord: "pokemon" },
  onepiece: { label: "One Piece", tcgLine: "one-piece-card-game", ebayWord: "one piece" },
};

function send(res, status, body, cacheSeconds) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheSeconds && status === 200) {
    res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function cleanQuery(q) {
  return String(q || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

module.exports = { BROWSER_UA, GAMES, send, fetchWithTimeout, cleanQuery };
