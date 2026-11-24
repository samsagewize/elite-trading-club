// POST /api/resolve { game?, numbers:[{game,number,raw,weight}], text }
// Turns what the on-device reader saw into TCGplayer candidates:
//  1) collector numbers (with misread fixes already applied) matched exactly,
//  2) otherwise a Pokémon name found in the text, ranked by number fragments,
//  3) cards people confirmed before for the same read are boosted.
const { GAMES, send } = require("./_lib");
const { searchProducts } = require("./_tcg");
const store = require("./_store");
const POKEMON = require("./_pokemon-names.json");

const POKE_RE = new RegExp(
  "(" + POKEMON.filter((n) => n.length >= 4).sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "gi"
);

// Pokémon names found in the OCR text; the card name is printed at the top,
// so names seen earlier (and more often) come first.
function pokemonNames(text) {
  const seen = {};
  let m;
  POKE_RE.lastIndex = 0;
  while ((m = POKE_RE.exec(text))) {
    const n = m[1].toLowerCase();
    // "Evolves from Charmeleon" names the previous stage, not this card
    if (/from\W{0,3}$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) continue;
    if (!seen[n]) seen[n] = { first: m.index, count: 0 };
    seen[n].count++;
  }
  return Object.keys(seen).sort((a, b) => (seen[a].first - seen[b].first) - 200 * (seen[b].count - seen[a].count));
}

function suffixFor(text, name) {
  const head = text.slice(0, 160);
  const big = /\b(VMAX|VSTAR)\b/i.exec(head);
  if (big) return big[1].toUpperCase();
  const after = new RegExp(name + "\\W{0,3}(VMAX|VSTAR|V|ex|EX|GX)\\b", "i").exec(text);
  return after ? after[1] : "";
}

function has(text, n, strict) {
  if (!n) return false;
  return strict ? new RegExp("(^|[^0-9])" + n + "([^0-9]|$)").test(text) : text.includes(n);
}

// How well a printing's collector number agrees with digits seen in the photo.
function scoreByFragments(p, text) {
  const parts = String(p.number || "").split("/");
  const idx = parts[0] ? String(Number(parts[0])) : "";
  const tot = parts[1] || "";
  let s = 0;
  if (tot) s += has(text, tot, true) ? 3 : has(text, tot, false) && tot.length >= 3 ? 1 : 0;
  if (idx.length >= 2) s += has(text, idx, true) || has(text, parts[0], true) ? 2 : 0;
  return s;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const text = String(body.text || "").slice(0, 4000);
  const numbers = (Array.isArray(body.numbers) ? body.numbers : []).slice(0, 4)
    .filter((n) => n && GAMES[n.game] && typeof n.number === "string" && n.number.length < 20);
  const preferGame = GAMES[body.game] ? body.game : null;

  try {
    const idx = await store.loadIndex();
    let candidates = [], via = null, game = preferGame || (numbers[0] && numbers[0].game) || "pokemon";

    // 1) collector numbers
    const lists = await Promise.all(numbers.map((n) => searchProducts(n.game, n.number, 24).catch(() => [])));
    for (let k = 0; k < numbers.length; k++) {
      const n = numbers[k], found = lists[k];
      const exact = found.filter((p) => store.normNumber(p.number) === store.normNumber(n.number));
      if (exact.length) {
        const boost = store.boosts(idx, store.readKeys(n.game, { numbers: [n] }));
        const lower = text.toLowerCase();
        const nameHit = (p) => {
          const words = p.name.toLowerCase().replace(/\(.*?\)|-.*$/g, " ").split(/[^a-z.]+/).filter((w) => w.length >= 3);
          return words.filter((w) => lower.includes(w)).length;
        };
        candidates = exact
          .map((p, i) => ({ p, i, b: boost[p.id] || 0, n: nameHit(p), l: p.listings || 0 }))
          .sort((a, b) => b.b - a.b || b.n - a.n || b.l - a.l || a.i - b.i)
          .map((o) => ({ ...o.p, learned: o.b > 0, matched: n.number }));
        via = "number"; game = n.game;
        break;
      }
    }

    // 2) Pokémon name + number fragments. Also used when the number matched a
    // card whose name doesn't appear anywhere in the photo (a misread digit).
    let name = null;
    const names = (!preferGame || preferGame === "pokemon") ? pokemonNames(text) : [];
    const numberAgrees = candidates.some((c) => names.some((n) => c.name.toLowerCase().includes(n)));
    if (names.length && (!candidates.length || (game === "pokemon" && !numberAgrees))) {
      const byNumber = candidates;
      {
        name = names[0];
        const sfx = suffixFor(text, name);
        const q = (name + " " + sfx).trim();
        // The ex / V / VMAX logos are hard to read, so look at all of them.
        const queries = [...new Set([q, name + " ex", name + " V", name + " VMAX", name])];
        const lists = await Promise.all(queries.map((qq) => searchProducts("pokemon", qq, 50).catch(() => [])));
        const seenIds = new Set(), found = [];
        lists.forEach((l) => l.forEach((p) => { if (!seenIds.has(p.id)) { seenIds.add(p.id); found.push(p); } }));
        const boost = store.boosts(idx, store.readKeys("pokemon", { name: q }));
        candidates = found
          .filter((p) => p.name.toLowerCase().includes(name))
          .map((p, i) => ({ p, i, s: scoreByFragments(p, text) + (sfx && new RegExp("\\b" + sfx + "\\b", "i").test(p.name) ? 2 : 0), b: boost[p.id] || 0 }))
          .sort((a, b) => b.b - a.b || b.s - a.s || (b.p.marketPrice || 0) - (a.p.marketPrice || 0) || a.i - b.i)
          .map((o) => ({ ...o.p, learned: o.b > 0 }));
        via = "name"; game = "pokemon"; name = q;
        // keep the number matches after the name matches
        const ids = new Set(candidates.map((c) => c.id));
        candidates = candidates.concat(byNumber.filter((c) => !ids.has(c.id)));
      }
    }

    return send(res, 200, { via, game, name, candidates: candidates.slice(0, 8) });
  } catch (e) {
    console.error("resolve failed", e && e.message);
    return send(res, 502, { error: "Card lookup failed. Type the card name instead." });
  }
};
