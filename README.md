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


## Subscribe

The gold Subscribe button on the home page reveals an email field. Addresses
are saved by `POST /api/subscribe` in the private Vercel Blob store
(`signups/`, same records as the card-search sign-up gate). Export them with
`GET /api/admin-signups` and an `Authorization: Bearer <ADMIN_TOKEN>` header.

## Profile and rewards (`/profile`)

Members can create a profile (email + password), log in, and log cards they
bought from the club or sold to it.

- `POST /api/auth?action=register|login|logout` and `GET /api/auth`
- `GET`/`POST /api/rewards` (session cookie required)
- Points: +10 per card, +5 with a photo or order reference, +50 on the first
  entry. Points stay pending until an admin verifies the entry. Verified
  points count toward Bronze (0), Silver (100) and Gold (250).
- Admin: `GET /api/admin-signups?type=profiles` and `?type=entries`
  (`&format=json` for JSON), and `POST /api/admin-signups` with
  `{ "action": "approve"|"reject", "id" }` and the same Bearer token.
  Rewrites: `/api/admin-profiles`, `/api/admin-entries`, `/api/admin-subscribers`.
- Rewards and perks are redeemable for store perks. Details from the club.
  Nothing here is money or a promise of profit.
