// Identifies a Pokémon or One Piece card from a photo using a vision model
// through Vercel AI Gateway. On Vercel the gateway is authenticated with the
// deployment's OIDC token; AI_GATEWAY_API_KEY works as an alternative.
const { send, fetchWithTimeout } = require("./_lib");

const MODEL = process.env.CARD_VISION_MODEL || "google/gemini-2.5-flash";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    game: { type: "string", enum: ["pokemon", "onepiece", "other", "unknown"] },
    name: { type: "string", description: "Card name exactly as printed, e.g. 'Charizard ex' or 'Monkey.D.Luffy'" },
    number: { type: "string", description: "Collector number as printed, e.g. '223/197' or 'OP01-024'. Empty if unreadable." },
    set: { type: "string", description: "Set name or set code if visible or confidently known. Empty if unsure." },
    variant: { type: "string", description: "Notable variant: e.g. Full Art, Alternate Art, Reverse Holo, Manga, 1st Edition. Empty if none/unsure." },
    language: { type: "string", description: "Language printed on the card, e.g. English, Japanese." },
    confidence: { type: "number", description: "0 to 1" },
    notes: { type: "string", description: "Short note if the photo is unclear or not a card." },
  },
  required: ["game", "name", "number", "set", "variant", "language", "confidence", "notes"],
};

const PROMPT = `You identify trading cards from photos. Only two games are supported: Pokémon TCG and One Piece Card Game.
Read the card name, the collector number (bottom corner; Pokémon looks like "125/197" or "SVP 044"; One Piece looks like "OP01-024", "ST10-005", "EB01-012", "P-001"), the set, and any special variant.
Only report text you can actually read or are confident about. Never guess a number you cannot read; leave it empty.
If the image is not a Pokémon or One Piece card, set game to "other" (or "unknown" if no card is visible).`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const image = body && body.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return send(res, 400, { error: "Send a JPEG, PNG or WebP photo." });
  }
  if (image.length > 4_000_000) return send(res, 413, { error: "Photo is too large. Try again." });

  const token =
    process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return send(res, 503, { error: "Card recognition is not configured (no AI Gateway credentials)." });

  try {
    const r = await fetchWithTimeout(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          messages: [
            { role: "system", content: PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Identify this card." },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: SCHEMA } },
        }),
      },
      45000
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && (data.error.message || data.error.type)) || `HTTP ${r.status}`;
      console.error("identify gateway error", r.status, msg);
      return send(res, 502, { error: "Card recognition failed. Type the card name instead.", detail: String(msg).slice(0, 200) });
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let card;
    try { card = JSON.parse(text); } catch { card = null; }
    if (!card) return send(res, 502, { error: "Could not read the card. Type the card name instead." });

    const query = [card.name, card.number].filter(Boolean).join(" ").trim();
    return send(res, 200, { card, query, model: MODEL });
  } catch (e) {
    console.error("identify failed", e && e.message);
    return send(res, 504, { error: "Card recognition timed out. Try again or type the card name." });
  }
};
