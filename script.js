(() => {
  const root = document.documentElement;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineQuery = window.matchMedia("(pointer: fine)");
  let gentle = motionQuery.matches;
  let finePointer = fineQuery.matches;

  const progressBar = document.querySelector(".progress-bar");
  const arrow = document.querySelector(".draw-arrow-path");
  const heroArt = document.querySelector(".hero-art");
  const stage = document.querySelector(".hero-stage");
  const sparkleRoot = document.querySelector(".sparkles");
  const binder = document.querySelector(".binder");
  const coverBtn = document.querySelector(".binder-cover");
  const skipBtn = document.querySelector(".binder-skip");

  const setProgress = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (progressBar) progressBar.style.transform = `scaleX(${p})`;
    if (arrow && typeof arrow.getTotalLength === "function") {
      const length = arrow.getTotalLength();
      const drawn = Math.min(1, p / 0.38);
      arrow.style.strokeDasharray = `${length}`;
      arrow.style.strokeDashoffset = `${length * (1 - drawn)}`;
    }
  };

  const revealInView = (el) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    return r.bottom > 8 && r.top < vh - 8;
  };

  const setupReveals = () => {
    const items = [
      ...document.querySelectorAll(".reveal"),
      ...document.querySelectorAll(".page"),
    ];

    items.forEach((el, i) => {
      if (el.classList.contains("sleeve")) {
        const sleeveIndex = [...document.querySelectorAll(".sleeve")].indexOf(el);
        el.style.transitionDelay = `${Math.max(0, sleeveIndex) * 90}ms`;
      } else if (el.classList.contains("reveal")) {
        el.style.transitionDelay = `${(i % 5) * 40}ms`;
      }
    });

    const io = "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting || entry.intersectionRatio > 0) {
                entry.target.classList.add("in");
                io.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.01, rootMargin: "20% 0px 20% 0px" }
        )
      : null;

    const arm = () => {
      items.forEach((el) => {
        if (revealInView(el)) el.classList.add("in");
        else if (io) io.observe(el);
        else el.classList.add("in");
      });
    };

    if (root.classList.contains("binder-closed")) {
      document.querySelectorAll(".hero-intro").forEach((el) => el.classList.remove("in"));
    } else {
      arm();
    }

    window.addEventListener("etc:opened", arm, { once: true });

    // Safety: never leave copy hidden if IO misses (short screens, odd toolbars)
    setTimeout(() => {
      items.forEach((el) => {
        if (!el.classList.contains("in") && revealInView(el)) el.classList.add("in");
      });
    }, 700);
    setTimeout(() => {
      items.forEach((el) => el.classList.add("in"));
      document.querySelectorAll(".hero-intro").forEach((el) => el.classList.add("in"));
    }, 2200);
  };

  const setupSparkles = () => {
    if (!sparkleRoot) return;
    sparkleRoot.replaceChildren();
    const count = finePointer ? 16 : 10;
    for (let i = 0; i < count; i += 1) {
      const s = document.createElement("span");
      s.className = `sparkle${i % 3 === 0 ? " cyan" : ""}`;
      s.style.left = `${8 + Math.random() * 84}%`;
      s.style.top = `${6 + Math.random() * 70}%`;
      s.style.animationDelay = `${(Math.random() * 3.6).toFixed(2)}s`;
      s.style.animationDuration = `${(3 + Math.random() * 2.4).toFixed(2)}s`;
      sparkleRoot.appendChild(s);
    }
  };

  let pointerX = 0;
  let pointerY = 0;
  let currentX = 0;
  let currentY = 0;
  let scrollTilt = 0;
  let orientX = 0;
  let orientY = 0;
  let rafId = 0;
  let ticking = false;

  const heroTick = (time) => {
    if (!heroArt) return;
    const amp = gentle ? 4 : 8;
    const bob = Math.sin(time / 900) * amp;
    const sway = Math.sin(time / 1300) * (gentle ? 0.5 : 1.1);
    currentX += (pointerX + orientX - currentX) * 0.08;
    currentY += (pointerY + orientY + scrollTilt - currentY) * 0.08;
    const rotY = currentX * (finePointer ? 8 : 6);
    const rotX = -currentY * (finePointer ? 6 : 5);
    heroArt.style.transform = `translateY(${bob}px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotate(${sway + currentX * 1.2}deg)`;
    rafId = requestAnimationFrame(heroTick);
  };

  const updateScrollTilt = () => {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const viewMid = window.innerHeight / 2;
    scrollTilt = Math.max(-1, Math.min(1, (viewMid - mid) / (window.innerHeight || 1)));
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      setProgress();
      updateScrollTilt();
      ticking = false;
    });
  };

  const setupHeroMotion = () => {
    if (!heroArt || !stage) return;
    if (finePointer) {
      stage.addEventListener("mousemove", (e) => {
        const r = stage.getBoundingClientRect();
        pointerX = ((e.clientX - r.left) / r.width - 0.5) * 2;
        pointerY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      });
      stage.addEventListener("mouseleave", () => {
        pointerX = 0;
        pointerY = 0;
      });
    }

    window.addEventListener("deviceorientation", (e) => {
      if (e.gamma == null || e.beta == null) return;
      orientX = Math.max(-1, Math.min(1, e.gamma / 30));
      orientY = Math.max(-1, Math.min(1, (e.beta - 45) / 40));
    }, { passive: true });

    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(heroTick);
  };

  const setupTaps = () => {
    document.querySelectorAll(".sleeve .card, .card").forEach((card) => {
      const press = () => card.classList.add("is-pressed");
      const release = () => {
        card.classList.remove("is-pressed");
        card.style.transform = "";
      };
      card.addEventListener("pointerdown", (e) => {
        press();
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const rotY = (x - 0.5) * 8;
        const rotX = (0.5 - y) * 6;
        card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-3px)`;
      });
      card.addEventListener("pointerup", release);
      card.addEventListener("pointerleave", release);
      card.addEventListener("pointercancel", release);
    });

    if (finePointer) {
      document.querySelectorAll(".ig-btn").forEach((el) => {
        el.addEventListener("mousemove", (e) => {
          const r = el.getBoundingClientRect();
          const x = e.clientX - (r.left + r.width / 2);
          const y = e.clientY - (r.top + r.height / 2);
          el.style.transform = `translate(${x * 0.22}px, ${y * 0.28}px)`;
        });
        el.addEventListener("mouseleave", () => {
          el.style.transform = "";
        });
      });
    }
  };

  let opening = false;
  const unlockBinder = () => {
    root.classList.remove("binder-closed", "binder-opening");
    if (binder) {
      binder.setAttribute("hidden", "");
      binder.setAttribute("aria-hidden", "true");
    }
    document.body.style.removeProperty("overflow");
    window.dispatchEvent(new Event("etc:opened"));
    setProgress();
  };

  const openBinder = (immediate) => {
    if (opening || !root.classList.contains("binder-closed")) {
      if (!root.classList.contains("binder-closed")) unlockBinder();
      return;
    }
    opening = true;
    try { sessionStorage.setItem("etc-binder-open", "1"); } catch (e) { /* ignore */ }

    if (immediate || gentle) {
      unlockBinder();
      return;
    }

    root.classList.add("binder-opening");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unlockBinder();
    };
    if (coverBtn) {
      coverBtn.addEventListener("transitionend", finish, { once: true });
    }
    setTimeout(finish, 1400);
  };

  const setupBinder = () => {
    root.classList.add("binder-ready");
    if (!binder) {
      root.classList.remove("binder-closed");
      return;
    }

    if (!root.classList.contains("binder-closed")) {
      binder.setAttribute("hidden", "");
      binder.setAttribute("aria-hidden", "true");
      return;
    }

    binder.hidden = false;
    binder.removeAttribute("hidden");
    binder.setAttribute("aria-hidden", "false");
    if (coverBtn) coverBtn.focus({ preventScroll: true });

    const onOpen = (e) => {
      if (e) e.preventDefault();
      openBinder(false);
    };
    if (coverBtn) coverBtn.addEventListener("click", onOpen);
    if (skipBtn) skipBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBinder(true);
    });

    binder.addEventListener("click", (e) => {
      if (e.target === binder) openBinder(false);
    });

    window.addEventListener("keydown", (e) => {
      if (!root.classList.contains("binder-closed")) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        openBinder(e.key === "Escape");
      }
    });

    let touchStartY = 0;
    binder.addEventListener("touchstart", (e) => {
      touchStartY = e.changedTouches[0] ? e.changedTouches[0].clientY : 0;
    }, { passive: true });
    binder.addEventListener("touchend", (e) => {
      const y = e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
      if (touchStartY - y > 40) openBinder(false);
    }, { passive: true });
  };

  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", (e) => { gentle = e.matches; });
  }
  if (fineQuery.addEventListener) {
    fineQuery.addEventListener("change", (e) => { finePointer = e.matches; });
  }

  setupBinder();
  setupReveals();
  setupSparkles();
  setupHeroMotion();
  setupTaps();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => { setProgress(); updateScrollTilt(); });
  window.addEventListener("pagehide", () => cancelAnimationFrame(rafId));
  setProgress();
  updateScrollTilt();
})();
