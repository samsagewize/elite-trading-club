# Elite Trading Club

Simple official site for Elite Trading Club.

- Live: https://elite-trading-club.vercel.app
- Card search: https://elite-trading-club.vercel.app/search
- Instagram: [instagram.com/elitetrading.club](https://www.instagram.com/elitetrading.club/)
- Subscribe: the gold button on the home page saves emails via `POST /api/subscribe`. Export with `GET /api/admin-signups` (Bearer `ADMIN_TOKEN`).

Nothing on the site is financial advice or a promise of results.

## Card search (/search)

Take or upload a photo of a Pokémon or One Piece card to see what it sold for.

- `api/identify.js` reads the card from the photo with a vision model. It uses
  Vercel AI Gateway with the deployment's OIDC token (the team needs a card on
  file in Vercel → AI Gateway to unlock the free credits), or `AI_GATEWAY_API_KEY`,
  or `GEMINI_API_KEY` (Google AI Studio) if that is set instead. When none of
  these work, the page reads the collector number on the phone with Tesseract OCR.
- `api/tcgplayer.js` finds matching products with TCGplayer's public search and
  returns each product's latest sales (date, condition, variant, quantity, price).
- `api/ebay.js` tries eBay's public sold/completed search. eBay currently answers
  cloud servers with 403, so the page shows a "See eBay sold listings" button
  instead of numbers. No prices are ever estimated or made up.

Static HTML, CSS and plain JavaScript; the API routes are plain Vercel Node functions.
