// Identifies a Pokémon or One Piece card from a photo using a vision model
// through Vercel AI Gateway. On Vercel the gateway is authenticated with the
// deployment's OIDC token; AI_GATEWAY_API_KEY works too, and GEMINI_API_KEY
// (Google AI Studio) is used instead when it is set.
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

  const geminiKey = process.env.GEMINI_API_KEY;
  const token =
    process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  if (!geminiKey && !token) {
    return send(res, 200, { card: null, code: "needs_setup", error: "Photo recognition isn't set up yet. Reading the card number from your photo instead." });
  }

  try {
    const card = geminiKey ? await viaGemini(geminiKey, image) : await viaGateway(token, image);
    const query = [card.name, card.number].filter(Boolean).join(" ").trim();
    return send(res, 200, { card, query, model: geminiKey ? GEMINI_MODEL : MODEL });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("identify failed:", msg.slice(0, 300));
    const needsSetup = /credit card|unlock your free credits|unauthorized|invalid api key|API key not valid/i.test(msg);
    // 200 so the page quietly falls back to on-phone OCR without a console error.
    return send(res, 200, {
      card: null,
      code: needsSetup ? "needs_setup" : "failed",
      error: needsSetup
        ? "Photo recognition isn't switched on yet. Reading the card number from your photo instead."
        : "Couldn't read the card. Reading the card number from your photo instead.",
    });
  }
};

async function viaGateway(token, image) {
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
          { role: "user", content: [{ type: "text", text: "Identify this card." }, { type: "image_url", image_url: { url: image } }] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: SCHEMA } },
      }),
    },
    45000
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && (data.error.message || data.error.type)) || `AI Gateway HTTP ${r.status}`);
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return JSON.parse(text);
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function viaGemini(key, image) {
  const m = image.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  const schema = JSON.parse(JSON.stringify(SCHEMA));
  delete schema.additionalProperties;
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: "user", parts: [{ text: "Identify this card." }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
      }),
    },
    45000
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || `Gemini HTTP ${r.status}`);
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return JSON.parse(parts.map((p) => p.text || "").join(""));
}
