(() => {
  const open = document.getElementById("subOpen");
  const form = document.getElementById("subForm");
  const email = document.getElementById("subEmail");
  const msg = document.getElementById("subMsg");
  const go = document.getElementById("subGo");
  if (!open || !form || !email) return;

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.className = "sub-msg" + (kind ? " " + kind : "");
  }

  open.addEventListener("click", () => {
    form.hidden = false;
    open.setAttribute("aria-expanded", "true");
    email.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = email.value.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setMsg("Please enter a valid email address.", "err");
      email.focus();
      return;
    }
    go.disabled = true;
    setMsg("Saving…", "");
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source: "home-subscribe" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(data.error || "Couldn't save that right now. Please try again.", "err");
        go.disabled = false;
        return;
      }
      setMsg(data.message || "You're subscribed. Thanks for joining Elite Trading Club.", "ok");
      email.disabled = true;
      go.disabled = true;
    } catch {
      setMsg("Couldn't save that right now. Please try again.", "err");
      go.disabled = false;
    }
  });
})();
