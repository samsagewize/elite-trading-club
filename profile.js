(() => {
  const $ = (id) => document.getElementById(id);
  const authPanel = $("authPanel");
  const dash = $("dash");
  const authMsg = $("authMsg");
  const logMsg = $("logMsg");
  const registerForm = $("registerForm");
  const loginForm = $("loginForm");

  let game = "pokemon";
  let type = "bought";
  let photoData = "";
  let suggestTimer = 0;

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "sub-msg" + (kind ? " " + kind : "");
  }

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, opts));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function showAuth() {
    authPanel.hidden = false;
    dash.hidden = true;
  }

  function renderUser(user) {
    $("whoName").textContent = user.name || "Member";
    $("whoEmail").textContent = user.email;
    $("whoSub").hidden = !user.subscriber;
    const t = user.tier || { name: "Bronze", id: "bronze", progress: 0 };
    const badge = $("tierBadge");
    badge.textContent = t.name;
    badge.className = "tier-badge " + (t.id || "bronze");
    $("ptsVerified").textContent = String(user.pointsVerified || 0);
    $("ptsPending").textContent = (user.pointsPending || 0) + " points pending review";
    const fill = $("tierFill");
    fill.style.width = Math.round((t.progress || 0) * 100) + "%";
    $("tierNext").textContent = t.next
      ? `${Math.max(0, (t.nextAt || 0) - (user.pointsVerified || 0))} points to ${t.next}`
      : "You're at Gold. Nice work.";
  }

  function statusLabel(s) {
    if (s === "verified") return "Verified";
    if (s === "rejected") return "Not verified";
    return "Pending";
  }

  function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "";
    return "$" + x.toFixed(2);
  }

  function renderHistory(entries) {
    const box = $("history");
    if (!entries || !entries.length) {
      box.innerHTML = '<p class="empty">No cards logged yet.</p>';
      return;
    }
    const groups = { bought: [], sold: [] };
    entries.forEach((e) => (groups[e.type] || groups.bought).push(e));
    box.innerHTML = ["bought", "sold"].map((k) => {
      const list = groups[k];
      if (!list.length) return "";
      const title = k === "bought" ? "Bought from us" : "Sold to us";
      return `<h3 class="set-head">${title}</h3>` + list.map((e) => {
        const meta = [e.set, e.number && ("#" + e.number), e.condition, e.date].filter(Boolean).join(" · ");
        const photo = e.hasPhoto && e.photoUrl
          ? `<img class="hist-photo" src="${e.photoUrl}" alt="">`
          : "";
        return `<article class="hist">
          ${photo}
          <div class="hist-text">
            <p class="m-name">${escapeHtml(e.cardName)}</p>
            <p class="m-sub">${escapeHtml(meta)}</p>
            <p class="m-sub">${money(e.price)}${e.ref ? " · ref " + escapeHtml(e.ref) : ""}</p>
          </div>
          <div class="hist-side">
            <span class="st st-${e.status}">${statusLabel(e.status)}</span>
            <b>+${e.totalPoints}</b>
          </div>
        </article>`;
      }).join("");
    }).join("");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadDash() {
    const data = await api("/api/rewards");
    authPanel.hidden = true;
    dash.hidden = false;
    renderUser(data.user);
    renderHistory(data.entries);
  }

  async function boot() {
    try {
      const me = await api("/api/auth");
      if (me.user) await loadDash();
      else showAuth();
    } catch {
      showAuth();
    }
  }

  document.querySelectorAll(".auth-tabs .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".auth-tabs .chip").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      registerForm.hidden = tab !== "register";
      loginForm.hidden = tab !== "login";
      setMsg(authMsg, "", "");
    });
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth?action=register", {
        method: "POST",
        body: JSON.stringify({
          name: $("regName").value,
          email: $("regEmail").value,
          password: $("regPass").value,
        }),
      });
      await loadDash();
    } catch (err) {
      setMsg(authMsg, err.message, "err");
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth?action=login", {
        method: "POST",
        body: JSON.stringify({
          email: $("loginEmail").value,
          password: $("loginPass").value,
        }),
      });
      await loadDash();
    } catch (err) {
      setMsg(authMsg, err.message, "err");
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try { await api("/api/auth?action=logout", { method: "POST", body: "{}" }); } catch {}
    showAuth();
    setMsg(authMsg, "You're logged out.", "ok");
  });

  document.querySelectorAll("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      type = btn.getAttribute("data-type");
      document.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    });
  });
  document.querySelectorAll("[data-game]").forEach((btn) => {
    btn.addEventListener("click", () => {
      game = btn.getAttribute("data-game");
      document.querySelectorAll("[data-game]").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    });
  });

  const suggest = $("cardSuggest");
  const nameInput = $("cardName");
  nameInput.addEventListener("input", () => {
    $("productId").value = "";
    clearTimeout(suggestTimer);
    const q = nameInput.value.trim();
    if (q.length < 2) { suggest.hidden = true; nameInput.setAttribute("aria-expanded", "false"); return; }
    suggestTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/suggest?game=${encodeURIComponent(game)}&q=${encodeURIComponent(q)}`);
        const data = await r.json();
        const list = data.suggestions || [];
        if (!list.length) { suggest.hidden = true; return; }
        suggest.innerHTML = list.map((p) =>
          `<li><button type="button" class="sug" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-set="${escapeHtml(p.set || "")}" data-number="${escapeHtml(p.number || "")}">
            <img src="${p.image || ""}" alt="">
            <span class="sug-text"><span>${escapeHtml(p.name)}</span><small>${escapeHtml([p.set, p.number].filter(Boolean).join(" · "))}</small></span>
          </button></li>`
        ).join("");
        suggest.hidden = false;
        nameInput.setAttribute("aria-expanded", "true");
        suggest.querySelectorAll(".sug").forEach((b) => b.addEventListener("click", () => {
          nameInput.value = b.getAttribute("data-name");
          $("cardSet").value = b.getAttribute("data-set") || "";
          $("cardNumber").value = b.getAttribute("data-number") || "";
          $("productId").value = b.getAttribute("data-id") || "";
          suggest.hidden = true;
          nameInput.setAttribute("aria-expanded", "false");
        }));
      } catch {
        suggest.hidden = true;
      }
    }, 220);
  });
  document.addEventListener("click", (e) => {
    if (!suggest.contains(e.target) && e.target !== nameInput) suggest.hidden = true;
  });

  async function resizePhoto(file) {
    if (!file) return "";
    if (!/^image\//.test(file.type)) throw new Error("Please attach a photo.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("That photo could not be read."));
        i.src = url;
      });
      const max = 800;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        const s = max / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $("cardPhoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    photoData = "";
    $("photoName").textContent = "";
    if (!file) return;
    try {
      photoData = await resizePhoto(file);
      $("photoName").textContent = "Photo attached.";
    } catch (err) {
      setMsg(logMsg, err.message, "err");
    }
  });

  const dateInput = $("cardDate");
  dateInput.value = new Date().toISOString().slice(0, 10);

  $("logForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg(logMsg, "", "");
    const go = $("logGo");
    go.disabled = true;
    try {
      const data = await api("/api/rewards", {
        method: "POST",
        body: JSON.stringify({
          type,
          game,
          cardName: $("cardName").value,
          set: $("cardSet").value,
          number: $("cardNumber").value,
          condition: $("cardCond").value,
          price: $("cardPrice").value,
          date: $("cardDate").value,
          ref: $("cardRef").value,
          productId: $("productId").value,
          photo: photoData || undefined,
        }),
      });
      renderUser(data.user);
      renderHistory(data.entries);
      $("logForm").reset();
      dateInput.value = new Date().toISOString().slice(0, 10);
      $("productId").value = "";
      photoData = "";
      $("photoName").textContent = "";
      type = "bought";
      document.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-checked", String(b.getAttribute("data-type") === "bought")));
      setMsg(logMsg, `Saved. +${data.entry.totalPoints} points are pending review.`, "ok");
    } catch (err) {
      setMsg(logMsg, err.message, "err");
    } finally {
      go.disabled = false;
    }
  });

  boot();
})();
