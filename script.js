(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const progressBar = document.querySelector(".progress-bar");
  const arrow = document.querySelector(".draw-arrow-path");
  const heroArt = document.querySelector(".hero-art");
  const stage = document.querySelector(".hero-stage");
  const sparkleRoot = document.querySelector(".sparkles");

  const setProgress = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (progressBar) progressBar.style.transform = `scaleX(${p})`;
    if (arrow) {
      const length = arrow.getTotalLength();
      const drawn = Math.min(1, p / 0.38);
      arrow.style.strokeDasharray = `${length}`;
      arrow.style.strokeDashoffset = `${length * (1 - drawn)}`;
    }
  };

  if (!reduce) {
    let cardIndex = 0;
    document.querySelectorAll(".reveal").forEach((el) => {
      if (el.classList.contains("card")) {
        el.style.transitionDelay = `${cardIndex * 90}ms`;
        cardIndex += 1;
      }
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );

    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }

  if (!reduce && sparkleRoot) {
    const count = finePointer ? 16 : 8;
    for (let i = 0; i < count; i += 1) {
      const s = document.createElement("span");
      s.className = `sparkle${i % 3 === 0 ? " cyan" : ""}`;
      s.style.left = `${8 + Math.random() * 84}%`;
      s.style.top = `${6 + Math.random() * 70}%`;
      s.style.animationDelay = `${(Math.random() * 3.6).toFixed(2)}s`;
      s.style.animationDuration = `${(2.8 + Math.random() * 2.2).toFixed(2)}s`;
      sparkleRoot.appendChild(s);
    }
  }

  let pointerX = 0;
  let pointerY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = 0;
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      setProgress();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", setProgress);
  setProgress();

  if (!reduce && finePointer && heroArt && stage) {
    stage.addEventListener("mousemove", (e) => {
      const r = stage.getBoundingClientRect();
      pointerX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointerY = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });
    stage.addEventListener("mouseleave", () => {
      pointerX = 0;
      pointerY = 0;
    });

    const tick = (time) => {
      const bob = Math.sin(time / 900) * 8;
      const sway = Math.sin(time / 1300) * 1.1;
      currentX += (pointerX - currentX) * 0.08;
      currentY += (pointerY - currentY) * 0.08;
      const rotY = currentX * 8;
      const rotX = -currentY * 6;
      heroArt.style.transform = `translateY(${bob}px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotate(${sway + currentX * 1.4}deg)`;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    window.addEventListener("pagehide", () => cancelAnimationFrame(rafId));
  }

  if (!reduce && finePointer) {
    document.querySelectorAll(".magnetic").forEach((el) => {
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

    document.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const rotY = (x - 0.5) * 10;
        const rotX = (0.5 - y) * 8;
        card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }
})();
