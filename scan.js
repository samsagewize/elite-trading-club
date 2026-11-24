/* On-device card reader for Pokémon and One Piece cards.
 * Uses Tesseract.js (open source, runs in the browser, no API key).
 * It OCRs several preprocessed regions of the photo (grayscale, contrast,
 * upscaled, plus inverted / thresholded retries), pulls out collector numbers
 * with misread fixes (O/0, I/1, S/5, B/8), and returns the raw text so the
 * server can match the card name against TCGplayer's catalog.
 */
(function () {
  "use strict";
  var TESS_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var workerPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Tesseract) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Could not load the card reader.")); };
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = loadScript(TESS_SRC).then(function () {
        return window.Tesseract.createWorker("eng", 1);
      }).catch(function (e) { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not open that photo.")); };
      img.src = src;
    });
  }

  // Crop a region (fractions of the image) and preprocess it for OCR.
  function dims(img) { return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }; }
  function region(img, fx, fy, fw, fh, targetW, mode) {
    var D = dims(img);
    var sx = Math.round(D.w * fx), sy = Math.round(D.h * fy);
    var sw = Math.round(D.w * fw), sh = Math.round(D.h * fh);
    var scale = Math.min(3, targetW / sw);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    var g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, i, v;
    var hist = new Array(256).fill(0), n = p.length / 4;
    for (i = 0; i < p.length; i += 4) {
      v = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]);
      p[i] = v; hist[v]++;
    }
    // contrast stretch between the 2nd and 98th percentile
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
    var range = Math.max(1, hi - lo), thr = 128;
    if (mode === "threshold") thr = otsu(hist, n);
    for (i = 0; i < p.length; i += 4) {
      v = p[i];
      if (mode === "threshold") v = v > thr ? 255 : 0;
      else v = Math.max(0, Math.min(255, ((v - lo) * 255) / range));
      if (mode === "invert") v = 255 - v;
      if (mode === "white") v = p[i] > Math.max(180, hi - 40) ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  function otsu(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, max = 0, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = i; }
    }
    return thr;
  }


  // Find the card in a phone photo: the card is busy (lots of edges) and the
  // table behind it is usually plain. Returns a crop box in pixels.
  function findCard(img) {
    var D = dims(img), W = 240, H = Math.max(1, Math.round((D.h / D.w) * W));
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    var p = g.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H), x, y, i;
    for (i = 0; i < W * H; i++) gray[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
    var mag = new Float32Array(W * H), sum = 0;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      mag[i] = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + W] - gray[i - W]);
      sum += mag[i];
    }
    var mean = sum / (W * H), thr = Math.max(12, mean * 1.2);
    var rows = new Float32Array(H), cols = new Float32Array(W);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (mag[y * W + x] > thr) { rows[y]++; cols[x]++; }
    function span(arr, len, other) {
      var lim = other * 0.12, a = 0, b = len - 1;
      while (a < len && arr[a] < lim) a++;
      while (b > a && arr[b] < lim) b--;
      return [a, b];
    }
    var ys = span(rows, H, W), xs = span(cols, W, H);
    var bx = xs[0] / W, by = ys[0] / H, bw = (xs[1] - xs[0] + 1) / W, bh = (ys[1] - ys[0] + 1) / H;
    if (bw < 0.25 || bh < 0.25 || bw * bh > 0.9) return { x: 0, y: 0, w: D.w, h: D.h, found: false };
    var m = 0.02;
    bx = Math.max(0, bx - m); by = Math.max(0, by - m);
    bw = Math.min(1 - bx, bw + 2 * m); bh = Math.min(1 - by, bh + 2 * m);
    return { x: Math.round(bx * D.w), y: Math.round(by * D.h), w: Math.round(bw * D.w), h: Math.round(bh * D.h), found: true };
  }

  function cropRotate(img, box, radians) {
    var c = document.createElement("canvas");
    var cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
    c.width = Math.round(box.w * cos + box.h * sin);
    c.height = Math.round(box.w * sin + box.h * cos);
    var g = c.getContext("2d");
    g.fillStyle = "#808080"; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2);
    g.rotate(radians);
    g.drawImage(img, box.x, box.y, box.w, box.h, -box.w / 2, -box.h / 2, box.w, box.h);
    return c;
  }

  // Straighten a tilted card: try small rotations and keep the one where the
  // card's bounding box is tightest (a straight rectangle has the smallest box).
  function findAngle(img) {
    var D = dims(img), W = 300, H = Math.round((D.h / D.w) * W);
    var small = document.createElement("canvas"); small.width = W; small.height = H;
    small.getContext("2d").drawImage(img, 0, 0, W, H);
    function area(deg) {
      var r = cropRotate(small, { x: 0, y: 0, w: W, h: H }, (deg * Math.PI) / 180);
      var b = findCard(r);
      return b.found ? b.w * b.h : Infinity;
    }
    var best = 0, bestA = area(0), d, a;
    for (d = -14; d <= 14; d += 2) { if (!d) continue; a = area(d); if (a < bestA * 0.985) { bestA = a; best = d; } }
    var center = best;
    for (d = center - 1.5; d <= center + 1.5; d += 0.5) { a = area(d); if (a < bestA * 0.995) { bestA = a; best = d; } }
    return (best * Math.PI) / 180;
  }

  var DIGIT_FIX = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", i: "1", "|": "1", "!": "1", L: "1", S: "5", s: "5", B: "8", b: "6", Z: "2", z: "2", G: "6", T: "7" };
  function fixDigits(s) {
    return s.split("").map(function (ch) { return DIGIT_FIX[ch] || ch; }).join("");
  }

  // Pull collector-number candidates out of OCR text.
  function findNumbers(text) {
    var out = [], seen = {};
    function add(game, number, raw, weight) {
      var k = game + "|" + number;
      if (seen[k]) { seen[k].weight += weight; return; }
      seen[k] = { game: game, number: number, raw: raw, weight: weight };
      out.push(seen[k]);
    }
    var t = String(text || "").replace(/[\u2010-\u2015\u2212~_]/g, "-");
    var m, re;
    // One Piece: OP05-119, ST10-010, EB01-012, PRB01-001 (also "P01-025" with
    // the O dropped, and "opo1ozs" with letters read for digits)
    re = /(^|[^A-Za-z])([O0Q]?P|ST|EB|PRB)\s?([0-9OoIlSsBZz|]{2})\s?[-.]?\s?([0-9OoIlSsBZz|]{3})/gi;
    while ((m = re.exec(t))) {
      var digits = (m[3] + m[4]).replace(/[^0-9]/g, "").length;
      if (digits < 1) continue; // every candidate is checked against TCGplayer later
      var pre = m[2].toUpperCase().replace(/^[0Q]/, "O").replace(/^P$/, "OP");
      if (pre === "OP" && !/^[O0Q]/i.test(m[2]) && /-/.test(t.slice(m.index + m[1].length + 1, m.index + m[1].length + 2))) continue; // "P-001" promo style
      var num = pre + fixDigits(m[3]) + "-" + fixDigits(m[4]);
      if (/^[A-Z]+\d{2}-\d{3}$/.test(num)) add("onepiece", num, m[0].trim(), m[2].length === 1 ? 2 : 3);
    }
    re = /\bP\s?-\s?([0-9OoIl]{3})\b/g;
    while ((m = re.exec(t))) add("onepiece", "P-" + fixDigits(m[1]), m[0], 1);
    // Pokémon: 223/197, 004/102, 4/102, TG05/TG30, GG35/GG70
    re = /(?:^|[^0-9A-Za-z])([0-9OoIlSBZ|]{1,3})\s?\/\s?([0-9OoIlSBZ|]{2,3})([0-9]?)/g;
    while ((m = re.exec(t))) {
      re.lastIndex = m.index + 1; // allow overlapping reads like "2 / 238/191"
      if (!/[0-9]/.test(m[1]) || !/[0-9]/.test(m[2])) continue;
      var a = String(Number(fixDigits(m[1]))), b = fixDigits(m[2]);
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
      var tot = Number(b);
      if (tot < 20 || tot > 400 || Number(a) > 500) continue;
      // "238/1918": digits run on, so it is a weaker read
      add("pokemon", a + "/" + b, m[0].trim(), (m[3] ? 1 : 2) + (/\s/.test(m[0].trim()) ? -0.5 : 0));
    }
    re = /\b(TG|GG|RC|SV)\s?([0-9OoIl]{2,3})\s?\/\s?(TG|GG|RC|SV)\s?([0-9OoIl]{2,3})\b/gi;
    while ((m = re.exec(t))) add("pokemon", m[1].toUpperCase() + fixDigits(m[2]) + "/" + m[3].toUpperCase() + fixDigits(m[4]), m[0], 3);
    re = /\b(SVP|SWSH|SM|XY)\s?([0-9OoIl]{2,3})\b/g;
    while ((m = re.exec(t))) add("pokemon", m[1] + " " + fixDigits(m[2]), m[0], 1);
    return out;
  }

  // Steps, in order. 1) OCR the cropped, straightened card.
  // 2) Straighten it and OCR enlarged strips along the bottom edge, where the
  // collector number is, in normal, bright-text, inverted and thresholded
  // versions. 3) Fall back to bands of the whole photo.
  function cardSteps() {
    var s = [];
    s.push({ name: "bottom", fx: 0, fy: 0.84, fw: 1, fh: 0.16, w: 2400, mode: "normal" });
    s.push({ name: "digits-left", fx: 0, fy: 0.88, fw: 0.62, fh: 0.11, w: 1500, mode: "normal", psm: "6", digits: true });
    s.push({ name: "digits-right", fx: 0.4, fy: 0.88, fw: 0.6, fh: 0.11, w: 1500, mode: "normal", psm: "6", digits: true });
    s.push({ name: "code-right", fx: 0.45, fy: 0.88, fw: 0.55, fh: 0.11, w: 1500, mode: "normal", psm: "6", chars: "OPSTEBR0123456789-" });
    s.push({ name: "bottom-left-white", fx: 0, fy: 0.85, fw: 0.62, fh: 0.15, w: 2000, mode: "white" });
    s.push({ name: "bottom-right", fx: 0.45, fy: 0.84, fw: 0.55, fh: 0.16, w: 2000, mode: "normal" });
    s.push({ name: "bottom-right-white", fx: 0.45, fy: 0.84, fw: 0.55, fh: 0.16, w: 2000, mode: "white" });
    s.push({ name: "bottom-left", fx: 0, fy: 0.85, fw: 0.62, fh: 0.15, w: 2000, mode: "normal" });
    s.push({ name: "bottom-thr", fx: 0, fy: 0.84, fw: 1, fh: 0.16, w: 2400, mode: "threshold" });
    s.push({ name: "bottom-inv", fx: 0, fy: 0.84, fw: 1, fh: 0.16, w: 2400, mode: "invert" });
    s.push({ name: "lower", fx: 0, fy: 0.7, fw: 1, fh: 0.3, w: 2200, mode: "normal" });
    return s;
  }
  function photoSteps() {
    return [[0.78, 0.22], [0.62, 0.24], [0.48, 0.24]].map(function (b, i) {
      return { name: "photo-band" + i, fx: 0, fy: b[0], fw: 1, fh: b[1], w: 2200, mode: "normal" };
    });
  }

  function scan(dataUrl, opts) {
    opts = opts || {};
    var progress = opts.onProgress || function () {};
    var texts = [], numbers = [], tried = [], worker, img, card, total = 15, n = 0;
    function merge(found, bonus) {
      found.forEach(function (f) {
        f.weight += bonus || 0;
        var ex = numbers.filter(function (x) { return x.game === f.game && x.number === f.number; })[0];
        if (ex) ex.weight += f.weight; else numbers.push(f);
      });
    }
    function ocr(source, name, opt, step) {
      progress(Math.min(95, Math.round((++n / total) * 100)));
      return worker.setParameters({
        tessedit_pageseg_mode: (step && step.psm) || "11",
        tessedit_char_whitelist: step && step.digits ? "0123456789/" : (step && step.chars) || ""
      }).then(function () {
        return worker.recognize(source, opt || {});
      }).then(function (res) {
        tried.push(name);
        var data = (res && res.data) || {};
        texts.push(data.text || "");
        return data;
      });
    }
    function runSteps(source, steps, bonus) {
      var i = 0;
      function next() {
        if (i >= steps.length) return Promise.resolve();
        if (numbers.length) return Promise.resolve(); // got a number: stop early
        var s = steps[i++];
        var cv = region(source, s.fx, s.fy, s.fw, s.fh, s.w, s.mode);
        if (opts.debug) (window.__regions = window.__regions || []).push([s.name, cv.toDataURL("image/png")]);
        return ocr(cv, s.name, null, s).then(function (d) {
          merge(findNumbers(d.text), bonus);
          return next();
        });
      }
      return next();
    }
    return Promise.all([getWorker(), loadImage(dataUrl)]).then(function (r) {
      worker = r[0]; img = r[1];
      var box = findCard(img);
      var angle = box.found ? findAngle(cropRotate(img, box, 0)) : 0;
      card = cropRotate(img, box, angle);
      if (angle) {
        var b2 = findCard(card); // re-tighten the crop after straightening
        if (b2.found) card = cropRotate(card, b2, 0);
      }
      return ocr(region(card, 0, 0, 1, 1, 1600, "normal"), box.found ? "card" : "full").then(function (d) {
        merge(findNumbers(d.text), 1);
        return runSteps(card, cardSteps(), 1);
      });
    }).then(function () {
      if (!numbers.length && img) return runSteps(img, photoSteps(), 0);
    }).then(function () {
      if (opts.wantName && card) {
        return ocr(region(card, 0, 0, 1, 0.22, 1800, "normal"), "name").then(function () {});
      }
    }).then(function () {
      progress(100);
      numbers.sort(function (a, b) { return b.weight - a.weight; });
      return {
        numbers: numbers.slice(0, 6),
        text: texts.join("\n").replace(/[ \t]+/g, " ").slice(0, 3000),
        tried: tried,
        cardPreview: opts.debug && card ? card.toDataURL("image/jpeg", 0.6) : undefined
      };
    });
  }

  window.CardScan = { scan: scan, findNumbers: findNumbers, warmUp: getWorker };
})();
