(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    game: "pokemon", products: [], selected: null, read: null,
    tcgReq: 0, ebayReq: 0, lastSales: null, lastEbay: null, confirmed: {}
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return typeof n === "number" && isFinite(n) ? "$" + n.toFixed(2) : "—"; }
  function shortDate(v) {
    var d = new Date(v);
    if (isNaN(d)) return esc(v);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function getJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Request failed"); e.data = d; throw e; }
        return d;
      });
    });
  }
  function postJSON(url, body) {
    return getJSON(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function status(text, kind) {
    $("preview").hidden = false;
    $("idStatus").className = "status " + (kind || "");
    $("idStatus").textContent = text;
  }
  function setProgress(p) {
    var bar = $("progress");
    if (p == null) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.firstElementChild.style.width = Math.max(4, Math.min(100, p)) + "%";
  }
  function setGame(g) {
    state.game = g;
    document.querySelectorAll(".chip").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.dataset.game === g));
    });
  }
  document.querySelectorAll(".chip").forEach(function (b) {
    b.addEventListener("click", function () {
      setGame(b.dataset.game);
      if ($("q").value.trim()) gated(function () { search($("q").value.trim(), { source: "typed" }); });
    });
  });

  // ---------- email sign-up gate (first lookup is free) ----------
  var MEMBER_KEY = "etc_member", COUNT_KEY = "etc_lookups", pending = null;
  function isMember() {
    try { if (localStorage.getItem(MEMBER_KEY)) return true; } catch (e) {}
    return /(?:^|;\s*)etc_member=1/.test(document.cookie);
  }
  function lookups() { try { return Number(localStorage.getItem(COUNT_KEY)) || 0; } catch (e) { return 0; } }
  function countLookup() { try { localStorage.setItem(COUNT_KEY, String(lookups() + 1)); } catch (e) {} }
  function gated(fn) {
    if (isMember() || lookups() < 1) { countLookup(); return fn(); }
    pending = fn;
    $("gate").hidden = false;
    $("gateEmail").focus();
  }
  $("gateForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("gateEmail").value.trim();
    $("gateError").textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) { $("gateError").textContent = "Please enter a valid email address."; return; }
    if (!$("gateConsent").checked) { $("gateError").textContent = "Please tick the box to join."; return; }
    var btn = $("gateForm").querySelector("button");
    btn.disabled = true;
    postJSON("/api/signup", { email: email, consent: true }).then(function () {
      try { localStorage.setItem(MEMBER_KEY, "1"); } catch (err) {}
      $("gate").hidden = true;
      var fn = pending; pending = null;
      if (fn) { countLookup(); fn(); }
    }).catch(function (err) {
      $("gateError").textContent = err.message || "Couldn't sign you up. Please try again.";
    }).then(function () { btn.disabled = false; });
  });

  // ---------- photo -> read the card ----------
  function toDataUrl(img, max, q) {
    var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  }
  function openPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var out = { ocr: toDataUrl(img, 2400, 0.92), ai: toDataUrl(img, 1280, 0.85) };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not open that photo.")); };
      img.src = url;
    });
  }

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    gated(function () { readPhoto(file); });
  }
  $("camera").addEventListener("change", onFile);
  $("upload").addEventListener("change", onFile);

  function readPhoto(file) {
    status("Opening photo…", "busy");
    clearResults();
    openPhoto(file).then(function (img) {
      $("previewImg").src = img.ai;
      // Optional AI read (only used if the site has a vision key); falls through instantly otherwise.
      return postJSON("/api/identify", { image: img.ai }).catch(function () { return {}; }).then(function (d) {
        var c = d && d.card;
        if (c && (c.game === "pokemon" || c.game === "onepiece") && (c.name || c.number)) {
          setGame(c.game);
          var q = d.query || c.name;
          $("q").value = q;
          status("Read: " + [c.name, c.number].filter(Boolean).join(" · "), "ok");
          return search(q, { source: "ai", name: c.name, numbers: c.number ? [{ game: c.game, number: c.number, raw: c.number }] : [] });
        }
        return scanOnDevice(img.ocr);
      });
    }).catch(function (err) {
      setProgress(null);
      status((err && err.message) || "Couldn't read the card. Type the name or number below.", "warn");
    });
  }

  function scanOnDevice(dataUrl) {
    if (!window.CardScan) { status("Card reader didn't load. Type the name or number below.", "warn"); return; }
    status("Reading the card on your phone…", "busy");
    setProgress(3);
    return window.CardScan.scan(dataUrl, { onProgress: setProgress }).then(function (r) {
      setProgress(null);
      state.read = { source: "ocr", numbers: r.numbers, text: r.text };
      window.__lastScan = { numbers: r.numbers, tried: r.tried };
      if (r.numbers[0]) setGame(r.numbers[0].game);
      status(r.numbers[0] ? "Read card number " + r.numbers[0].number + ". Matching…" : "Matching the card name…", "busy");
      return postJSON("/api/resolve", { numbers: r.numbers, text: r.text });
    }).then(function (d) {
      if (!d) return;
      if (!d.candidates || !d.candidates.length) {
        status("Couldn't read this card. Try again with the card filling the frame and no glare, or type the name or number (like 223/197 or OP01-024) below.", "warn");
        $("q").focus();
        return;
      }
      setGame(d.game);
      var top = d.candidates[0];
      $("q").value = d.via === "number" ? top.number : (d.name || "");
      state.read.name = d.name || "";
      state.read.query = $("q").value;
      status(d.via === "number"
        ? "Read card number " + (top.matched || top.number) + ". Check it's the right printing below."
        : "Read the name " + (d.name || "") + ". Pick your printing below.", "ok");
      showProducts(d.candidates);
    }).catch(function (err) {
      setProgress(null);
      status((err && err.message) || "Couldn't read the card. Type the name or number below.", "warn");
    });
  }

  // ---------- typed search ----------
  $("searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("q").value.trim();
    if (!q) return;
    $("q").blur();
    gated(function () { search(q, { source: "typed" }); });
  });

  function clearResults() {
    ["matches", "detail", "tcg", "ebay"].forEach(function (id) { $(id).hidden = true; });
  }

  function search(q, read) {
    state.read = Object.assign({ query: q, numbers: [] }, read || {});
    state.read.query = q;
    clearResults();
    $("popular").hidden = true;
    $("matches").hidden = false;
    $("matchList").innerHTML = '<li class="loading">Searching TCGplayer…</li>';
    return getJSON("/api/tcgplayer?game=" + state.game + "&q=" + encodeURIComponent(q)).then(function (d) {
      if (!d.products || !d.products.length) {
        $("matchList").innerHTML = '<li class="empty">No TCGplayer match. Try just the name, or the number like 223/197 or OP01-024.</li>';
        loadEbay(q, null);
        return;
      }
      showProducts(d.products);
    }).catch(function (err) {
      $("matchList").innerHTML = '<li class="empty">TCGplayer search is unavailable right now (' + esc(err.message) + ').</li>';
      loadEbay(q, null);
    });
  }

  function showProducts(list) {
    state.products = list.slice(0, 10);
    $("matches").hidden = false;
    $("matchList").innerHTML = state.products.map(function (p, i) {
      return '<li><button type="button" class="match" data-i="' + i + '" aria-pressed="false">' +
        '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="44" height="62">' +
        '<span class="m-text"><span class="m-name">' + esc(p.name) + (p.learned ? ' <em class="tag">picked before</em>' : "") + '</span>' +
        '<span class="m-sub">' + esc([p.set, p.number && "#" + p.number].filter(Boolean).join(" · ")) + '</span></span>' +
        '<span class="m-price">' + money(p.marketPrice) + '<small>market</small></span>' +
        '</button></li>';
    }).join("");
    $("matchList").querySelectorAll(".match").forEach(function (b) {
      b.addEventListener("click", function () { select(Number(b.dataset.i), true); });
    });
    select(0, false);
  }

  function ebayQuery(p) {
    var base = p.name.replace(/\s*\([^)]*\)/g, "").replace(/\s+-\s+[\w\/-]+$/, "").trim();
    var extra = (p.name.match(/\((Alternate Art|Manga|Parallel|SP|Reprint|Full Art|Secret)\)/i) || [])[1] || "";
    return [base, p.number, extra].filter(Boolean).join(" ");
  }

  function select(i, byUser) {
    var p = state.products[i];
    if (!p) return;
    state.selected = p;
    state.lastSales = null; state.lastEbay = null;
    $("matchList").querySelectorAll(".match").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.i) === i));
    });
    renderDetail();
    var done = 0;
    function both() { if (++done === 2) record(byUser ? "confirm" : "search"); }
    loadTcg(p, both);
    loadEbay(ebayQuery(p), both);
    if (byUser) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- save the search / teach the matcher ----------
  function record(event) {
    var p = state.selected;
    if (!p) return;
    if (event === "confirm") {
      if (state.confirmed[p.id]) return;
      state.confirmed[p.id] = true;
    }
    postJSON("/api/learn", {
      event: event,
      game: state.game,
      read: state.read || {},
      product: { id: p.id, name: p.name, set: p.set, number: p.number },
      prices: (state.lastSales || []).map(function (s) { return s.price; }),
      marketPrice: p.marketPrice,
      ebayUrl: state.lastEbay && state.lastEbay.url
    }).catch(function () {});
  }

  // ---------- detail card ----------
  function renderDetail() {
    var p = state.selected;
    var last = state.lastSales && state.lastSales[0];
    var ebayLast = state.lastEbay && state.lastEbay.sales && state.lastEbay.sales[0];
    var spread = "";
    if (last && typeof p.marketPrice === "number" && p.marketPrice > 0) {
      var diff = last.price - p.marketPrice, pct = (diff / p.marketPrice) * 100;
      spread = '<div class="kv"><span>Last sale vs market</span><b class="' + (diff >= 0 ? "up" : "down") + '">' +
        (diff >= 0 ? "+" : "−") + "$" + Math.abs(diff).toFixed(2) + " (" + (diff >= 0 ? "+" : "−") + Math.abs(pct).toFixed(1) + "%)</b></div>";
    }
    var hist = state.history;
    var lastBlock = state.lastSales === null
      ? '<div class="last"><span class="last-label">Last sold on TCGplayer</span><span class="last-price muted">…</span></div>'
      : last
        ? '<div class="last"><span class="last-label">Last sold on TCGplayer</span><span class="last-price">' + money(last.price) + '</span>' +
          '<span class="last-meta">' + shortDate(last.date) + " · " + esc([last.condition, last.variant].filter(Boolean).join(" · ")) + '</span></div>'
        : '<div class="last"><span class="last-label">Last sold on TCGplayer</span><span class="last-price muted">No recent sales</span></div>';
    $("detail").hidden = false;
    $("detailCard").innerHTML =
      '<div class="dc">' +
        '<a class="dc-img" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" width="120" height="168"></a>' +
        '<div class="dc-info">' +
          '<div class="dc-name">' + esc(p.name) + '</div>' +
          '<div class="dc-sub">' + esc([p.set, p.number && "#" + p.number, p.rarity].filter(Boolean).join(" · ")) + '</div>' +
          lastBlock +
        '</div>' +
      '</div>' +
      '<div class="kvs">' +
        '<div class="kv"><span>TCGplayer market</span><b>' + money(p.marketPrice) + '</b></div>' +
        '<div class="kv"><span>Lowest listed now</span><b>' + money(p.lowestPrice) + '</b></div>' +
        spread +
        (hist && hist.nearMint30dCount ? '<div class="kv"><span>Near Mint 30-day median</span><b>' + money(hist.nearMint30dMedian) + ' <small>(' + hist.nearMint30dCount + ' sales)</small></b></div>' : "") +
        '<div class="kv"><span>eBay last sold</span><b>' + (ebayLast ? esc(ebayLast.priceText) + ' <small>' + esc(ebayLast.date) + '</small>' : '<small>see eBay</small>') + '</b></div>' +
      '</div>' +
      '<div class="dc-actions">' +
        '<a class="ghost-btn" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">TCGplayer page ↗</a>' +
        '<a class="ghost-btn" id="ebayBtn" href="' + esc((state.lastEbay && state.lastEbay.url) || "#") + '" target="_blank" rel="noopener noreferrer">eBay sold only ↗</a>' +
      '</div>' +
      '<button type="button" id="confirmBtn" class="confirm-btn"' + (state.confirmed[p.id] ? " disabled" : "") + '>' +
        (state.confirmed[p.id] ? "✓ Saved — thanks, the scanner learns from this" : "✓ Yes, this is my card") + '</button>';
    $("confirmBtn").addEventListener("click", function () { record("confirm"); renderDetail(); });
  }

  // ---------- TCGplayer latest sales ----------
  function loadTcg(p, cb) {
    var req = ++state.tcgReq;
    state.history = null;
    $("tcg").hidden = false;
    $("tcgLink").href = p.url;
    $("tcgSales").innerHTML = '<p class="loading">Loading latest sales…</p>';
    getJSON("/api/tcgplayer?id=" + p.id).then(function (d) {
      if (req !== state.tcgReq) return;
      var s = d.sales || [];
      state.lastSales = s;
      state.history = d.history || null;
      renderDetail();
      if (!s.length) {
        $("tcgSales").innerHTML = '<p class="empty">No recent TCGplayer sales recorded for this printing.</p>';
        return;
      }
      var h = d.history && d.history.count > s.length
        ? '<p class="src">Saved history: ' + d.history.count + " sales since " + shortDate(d.history.since) + ".</p>" : "";
      $("tcgSales").innerHTML = '<ul class="sales">' + s.map(function (x) {
        return '<li><div class="s-top"><span class="s-price">' + money(x.price) + '</span>' +
          '<span class="s-date">' + shortDate(x.date) + '</span></div>' +
          '<div class="s-meta">' + esc([x.condition, x.variant, x.language && x.language !== "English" ? x.language : "", "Qty " + x.quantity].filter(Boolean).join(" · ")) + '</div></li>';
      }).join("") + '</ul><p class="src">Source: TCGplayer latest sales' + (d.fromHistory ? " (saved copy; TCGplayer didn't answer just now)" : "") + '. Prices exclude shipping.</p>' + h;
    }).catch(function () {
      if (req !== state.tcgReq) return;
      state.lastSales = [];
      renderDetail();
      $("tcgSales").innerHTML = '<p class="empty">Couldn\'t load TCGplayer sales right now. The market price above is from TCGplayer search.</p>';
    }).then(function () { if (req === state.tcgReq && cb) cb(); });
  }

  // ---------- eBay sold ----------
  function loadEbay(q, cb) {
    var req = ++state.ebayReq;
    $("ebay").hidden = false;
    $("ebaySales").innerHTML = '<p class="loading">Checking eBay sold listings…</p>';
    getJSON("/api/ebay?game=" + state.game + "&q=" + encodeURIComponent(q)).then(function (d) {
      if (req !== state.ebayReq) return;
      state.lastEbay = d;
      $("ebayLink").href = d.url;
      if (state.selected) renderDetail();
      var s = d.sales || [];
      if (d.blocked || !s.length) {
        $("ebaySales").innerHTML =
          '<p class="empty">' + (d.blocked
            ? "eBay doesn't let our server read sold prices, so open eBay's sold-only results for this card:"
            : "No eBay sold listings found for this search.") + '</p>' +
          '<a class="ghost-btn wide" target="_blank" rel="noopener noreferrer" href="' + esc(d.url) + '">See eBay sold listings ↗</a>';
        return;
      }
      $("ebaySales").innerHTML = '<ul class="sales">' + s.map(function (x) {
        var t = '<div class="s-top"><span class="s-price">' + esc(x.priceText) + '</span>' +
          '<span class="s-date">Sold ' + esc(x.date) + '</span></div><div class="s-meta">' + esc(x.title) + '</div>';
        return '<li>' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : t) + '</li>';
      }).join("") + '</ul><p class="src">Source: eBay sold &amp; completed listings for “' + esc(d.query) + '”. Titles vary, so check each one matches your card.</p>';
    }).catch(function () {
      if (req !== state.ebayReq) return;
      $("ebaySales").innerHTML = '<p class="empty">eBay is unavailable right now.</p>';
    }).then(function () { if (req === state.ebayReq && cb) cb(); });
  }

  // ---------- popular / recent ----------
  getJSON("/api/popular").then(function (d) {
    var seen = {}, items = [];
    (d.popular || []).concat(d.recent || []).forEach(function (p) {
      if (!seen[p.id] && p.name) { seen[p.id] = 1; items.push(p); }
    });
    if (!items.length || !$("matches").hidden) return;
    $("popular").hidden = false;
    $("popList").innerHTML = items.slice(0, 8).map(function (p, i) {
      return '<li><button type="button" class="pop" data-i="' + i + '"><img src="' + esc(p.image) + '" alt="" width="34" height="48" loading="lazy">' +
        '<span>' + esc(p.name) + '</span></button></li>';
    }).join("");
    $("popList").querySelectorAll(".pop").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = items[Number(b.dataset.i)];
        setGame(p.game || "pokemon");
        var q = p.name.replace(/\s*\([^)]*\)/g, "").replace(/\s+-\s+[\w\/-]+$/, "") + " " + (p.number || "");
        $("q").value = q.trim();
        gated(function () { search(q.trim(), { source: "popular" }); });
      });
    });
  }).catch(function () {});
})();
