(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = { game: "pokemon", products: [], selected: null, tcgReq: 0, ebayReq: 0 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    return typeof n === "number" && isFinite(n) ? "$" + n.toFixed(2) : "—";
  }
  function shortDate(v) {
    var d = new Date(v);
    if (isNaN(d)) return esc(v);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
      if ($("q").value.trim()) search($("q").value.trim());
    });
  });

  function getJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Request failed"); e.data = d; throw e; }
        return d;
      });
    });
  }

  // ---- Photo -> downscaled JPEG -> /api/identify ----
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight;
        var s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not open that photo.")); };
      img.src = url;
    });
  }

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("preview").hidden = false;
    $("idStatus").className = "status busy";
    $("idStatus").textContent = "Reading your card…";
    shrink(file).then(function (dataUrl) {
      $("previewImg").src = dataUrl;
      return getJSON("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl })
      });
    }).then(function (d) {
      var c = d.card || {};
      if (c.game === "pokemon" || c.game === "onepiece") {
        setGame(c.game);
        var bits = [c.name, c.number, c.set, c.variant].filter(Boolean).join(" · ");
        $("idStatus").className = "status ok";
        $("idStatus").textContent = "Looks like: " + bits + ". Fix the search below if it's off.";
        $("q").value = d.query || c.name || "";
        if ($("q").value) search($("q").value);
      } else {
        $("idStatus").className = "status warn";
        $("idStatus").textContent = c.game === "other"
          ? "That doesn't look like a Pokémon or One Piece card. Type the name instead."
          : "Couldn't find a card in that photo. Try again closer, with less glare, or type the name.";
      }
    }).catch(function (err) {
      $("idStatus").className = "status warn";
      $("idStatus").textContent = (err && err.message) || "Couldn't read the card. Type the name instead.";
    });
  }
  $("camera").addEventListener("change", onFile);
  $("upload").addEventListener("change", onFile);

  // ---- Search TCGplayer products ----
  $("searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("q").value.trim();
    if (q) { $("q").blur(); search(q); }
  });

  function search(q) {
    $("matches").hidden = false;
    $("tcg").hidden = true;
    $("ebay").hidden = true;
    $("matchList").innerHTML = '<li class="loading">Searching TCGplayer…</li>';
    getJSON("/api/tcgplayer?game=" + state.game + "&q=" + encodeURIComponent(q)).then(function (d) {
      state.products = d.products || [];
      if (!state.products.length) {
        $("matchList").innerHTML = '<li class="empty">No TCGplayer match. Try just the name, or the number like 223/197 or OP01-024.</li>';
        loadEbay(q);
        return;
      }
      renderMatches();
      select(0);
    }).catch(function (err) {
      $("matchList").innerHTML = '<li class="empty">TCGplayer search is unavailable right now (' + esc(err.message) + ').</li>';
      loadEbay(q);
    });
  }

  function renderMatches() {
    $("matchList").innerHTML = state.products.map(function (p, i) {
      return '<li><button type="button" class="match" data-i="' + i + '" aria-pressed="false">' +
        '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="56" height="78">' +
        '<span class="m-text"><span class="m-name">' + esc(p.name) + '</span>' +
        '<span class="m-sub">' + esc([p.set, p.rarity].filter(Boolean).join(" · ")) + '</span></span>' +
        '<span class="m-price">' + money(p.marketPrice) + '<small>market</small></span>' +
        '</button></li>';
    }).join("");
    $("matchList").querySelectorAll(".match").forEach(function (b) {
      b.addEventListener("click", function () { select(Number(b.dataset.i), true); });
    });
  }

  function ebayQuery(p) {
    var base = p.name.replace(/\s*\([^)]*\)/g, "").replace(/\s+-\s+[\w\/-]+$/, "").trim();
    var extra = (p.name.match(/\((Alternate Art|Manga|Parallel|SP|Reprint)\)/i) || [])[1] || "";
    return [base, p.number, extra].filter(Boolean).join(" ");
  }

  function select(i, scroll) {
    var p = state.products[i];
    if (!p) return;
    state.selected = p;
    $("matchList").querySelectorAll(".match").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.i) === i));
    });
    loadTcg(p);
    loadEbay(ebayQuery(p));
    if (scroll) $("tcg").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- TCGplayer latest sales ----
  function loadTcg(p) {
    var req = ++state.tcgReq;
    $("tcg").hidden = false;
    $("tcgLink").href = p.url;
    $("tcgSummary").innerHTML =
      '<div class="sum-name">' + esc(p.name) + '</div>' +
      '<div class="sum-row"><span>Market price</span><b>' + money(p.marketPrice) + '</b></div>' +
      '<div class="sum-row"><span>Lowest listed</span><b>' + money(p.lowestPrice) + '</b></div>';
    $("tcgSales").innerHTML = '<p class="loading">Loading latest sales…</p>';
    getJSON("/api/tcgplayer?id=" + p.id).then(function (d) {
      if (req !== state.tcgReq) return;
      var s = d.sales || [];
      if (!s.length) {
        $("tcgSales").innerHTML = '<p class="empty">No recent TCGplayer sales recorded for this printing.</p>';
        return;
      }
      $("tcgSales").innerHTML = '<ul class="sales">' + s.map(function (x) {
        return '<li><div class="s-top"><span class="s-price">' + money(x.price) + '</span>' +
          '<span class="s-date">' + shortDate(x.date) + '</span></div>' +
          '<div class="s-meta">' + esc([x.condition, x.variant, x.language !== "English" ? x.language : "", "Qty " + x.quantity].filter(Boolean).join(" · ")) + '</div></li>';
      }).join("") + '</ul><p class="src">Source: TCGplayer latest sales (price excludes shipping).</p>';
    }).catch(function () {
      if (req !== state.tcgReq) return;
      $("tcgSales").innerHTML = '<p class="empty">Couldn\'t load TCGplayer sales right now. Market price above is from TCGplayer search.</p>';
    });
  }

  // ---- eBay sold ----
  function loadEbay(q) {
    var req = ++state.ebayReq;
    $("ebay").hidden = false;
    $("ebaySales").innerHTML = '<p class="loading">Checking eBay sold listings…</p>';
    getJSON("/api/ebay?game=" + state.game + "&q=" + encodeURIComponent(q)).then(function (d) {
      if (req !== state.ebayReq) return;
      $("ebayLink").href = d.url;
      var s = d.sales || [];
      if (d.blocked || !s.length) {
        $("ebaySales").innerHTML =
          '<p class="empty">' + (d.blocked
            ? "eBay didn't let us read sold listings automatically just now."
            : "No eBay sold listings found for this search.") + '</p>' +
          '<a class="ghost-btn wide" target="_blank" rel="noopener noreferrer" href="' + esc(d.url) + '">See eBay sold listings</a>';
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
    });
  }
})();
