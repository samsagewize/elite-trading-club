// GET /api/popular — most looked-up and recently searched cards.
const { send } = require("./_lib");
const store = require("./_store");

module.exports = async (req, res) => {
  try {
    const idx = await store.loadIndex();
    const all = Object.keys(idx.products).map((id) => ({ id: Number(id), ...idx.products[id] }));
    const score = (p) => p.picks * 2 + p.searches;
    const popular = all.sort((a, b) => score(b) - score(a)).slice(0, 6);
    const recent = idx.recent.slice(0, 6).map((r) => ({ id: r.id, at: r.at, ...(idx.products[r.id] || {}) })).filter((p) => p.name);
    return send(res, 200, { popular, recent }, 60);
  } catch (e) {
    return send(res, 200, { popular: [], recent: [] });
  }
};
