// GET /api/suggest?game=pokemon&q=chari — live name suggestions from TCGplayer search.
const { GAMES, send, cleanQuery } = require("./_lib");
const { searchProducts } = require("./_tcg");

module.exports = async (req, res) => {
  const { game = "pokemon", q } = req.query || {};
  if (!GAMES[game]) return send(res, 400, { error: "Only Pokémon and One Piece are supported." });
  const query = cleanQuery(q).slice(0, 60);
  if (query.length < 2) return send(res, 200, { suggestions: [] });
  try {
    const products = await searchProducts(game, query, 8);
    return send(res, 200, {
      suggestions: products.map((p) => ({ id: p.id, name: p.name, set: p.set, number: p.number, image: p.image.replace("_in_400x400", "_in_200x200"), marketPrice: p.marketPrice })),
    }, 3600);
  } catch (e) {
    return send(res, 200, { suggestions: [] });
  }
};
