// Shared email validation and subscriber storage (signups/ in the private blob store).
const crypto = require("crypto");
const store = require("./_store");

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;

const CONSENT = {
  "card-search": "Get card alerts from Elite Trading Club. Unsubscribe anytime.",
  "home-subscribe": "Get club updates from Elite Trading Club. Unsubscribe anytime.",
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return !!email && email.length <= 254 && EMAIL_RE.test(email);
}

function emailKey(email) {
  return crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
}

function signupPath(email) {
  return `signups/${emailKey(email)}.json`;
}

async function readSubscriber(email) {
  return store.readJSON(signupPath(email));
}

// Dedupes by email and keeps the first-subscribed timestamp.
async function saveSubscriber({ email, source, consent }) {
  const path = signupPath(email);
  const existing = await store.readJSON(path);
  if (existing) return { already: true, record: existing };
  const record = {
    email,
    createdAt: new Date().toISOString(),
    consent: consent || CONSENT[source] || CONSENT["home-subscribe"],
    source: source || "subscribe",
  };
  await store.writeJSON(path, record);
  return { already: false, record };
}

module.exports = {
  EMAIL_RE,
  CONSENT,
  normalizeEmail,
  isValidEmail,
  emailKey,
  signupPath,
  readSubscriber,
  saveSubscriber,
};
