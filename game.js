/* Tap The Drone - simple Flappy-like game (Canvas) */

(() => {
  "use strict";

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /** @type {HTMLCanvasElement} */
  const canvas = /** @type {HTMLCanvasElement} */ ($("game"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

  const ui = {
    overlay: $("overlay"),
    overlayTitle: $("overlayTitle"),
    overlayText: $("overlayText"),
    btnStart: $("btnStart"),
    btnMute: $("btnMute"),
    levelSelect: /** @type {HTMLSelectElement} */ ($("levelSelect")),
    score: $("score"),
    best: $("best"),
  };

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  function fitCanvasToCSSSize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(180, Math.floor(rect.height));
    const pxW = Math.floor(w * DPR);
    const pxH = Math.floor(h * DPR);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // --- Audio (optional)
  const audio = {
    enabled: false,
    ctx: /** @type {AudioContext | null} */ (null),
    master: /** @type {GainNode | null} */ (null),
  };

  function ensureAudio() {
    if (audio.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.05;
    audio.master.connect(audio.ctx.destination);
  }

  function beep(freq, durationMs, type = "sine") {
    if (!audio.enabled) return;
    ensureAudio();
    if (!audio.ctx || !audio.master) return;
    const now = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = /** @type {OscillatorType} */ (type);
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    o.connect(g);
    g.connect(audio.master);
    o.start(now);
    o.stop(now + durationMs / 1000 + 0.02);
  }

  // --- Levels (difficulty + style)
  const LEVELS = {
    city_easy: {
      id: "city_easy",
      name: "Город (легко)",
      gravity: 1550,
      flapV: 560,
      baseSpeed: 260,
      speedUpPerScore: 2.6,
      spawnEvery: 1.55,
      pipeWidth: 78,
      gapMin: 185,
      gapMax: 235,
      theme: {
        skyTop: "#0c1836",
        skyBottom: "#060910",
        glow: "#6ee7ff",
        pipeA: "#2bd5ff",
        pipeB: "#0aa3c9",
        floorA: "#0b1a26",
        floorB: "#061018",
      },
    },
    desert_normal: {
      id: "desert_normal",
      name: "Пустыня (норм)",
      gravity: 1700,
      flapV: 585,
      baseSpeed: 305,
      speedUpPerScore: 3.2,
      spawnEvery: 1.4,
      pipeWidth: 84,
      gapMin: 155,
      gapMax: 205,
      theme: {
        skyTop: "#45210e",
        skyBottom: "#0b0710",
        glow: "#ffd37a",
        pipeA: "#ffb454",
        pipeB: "#e57a2e",
        floorA: "#2a140a",
        floorB: "#14090a",
      },
    },
    arctic_hard: {
      id: "arctic_hard",
      name: "Арктика (хард)",
      gravity: 1900,
      flapV: 605,
      baseSpeed: 345,
      speedUpPerScore: 4.0,
      spawnEvery: 1.28,
      pipeWidth: 88,
      gapMin: 132,
      gapMax: 178,
      theme: {
        skyTop: "#0d2a2b",
        skyBottom: "#05070b",
        glow: "#7afcff",
        pipeA: "#a8f7ff",
        pipeB: "#3bd3e6",
        floorA: "#07181c",
        floorB: "#041014",
      },
    },
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function roundRect(ctx2, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + rr, y);
    ctx2.arcTo(x + w, y, x + w, y + h, rr);
    ctx2.arcTo(x + w, y + h, x, y + h, rr);
    ctx2.arcTo(x, y + h, x, y, rr);
    ctx2.arcTo(x, y, x + w, y, rr);
    ctx2.closePath();
  }

  // --- Game state
  const state = {
    mode: /** @type {"menu"|"running"|"paused"|"dead"} */ ("menu"),
    t: 0,
    lastTs: 0,
    score: 0,
    best: 0,
    level: LEVELS.city_easy,
    startedOnce: false,
  };

  const world = {
    w: 0,
    h: 0,
    floorH: 70,
    drone: {
      x: 190,
      y: 210,
      r: 18,
      vy: 0,
      tilt: 0,
      flapFlash: 0,
    },
    pipes: /** @type {Array<{x:number,w:number,gapY:number,gapH:number,scored:boolean}>} */ ([]),
    spawnTimer: 0,
    shake: 0,
  };

  function storageKeyForBest(levelId) {
    return `tap_the_drone_best__${levelId}`;
  }

  function loadBest(levelId) {
    try {
      const raw = localStorage.getItem(storageKeyForBest(levelId));
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    } catch {
      return 0;
    }
  }

  function saveBest(levelId, best) {
    try {
      localStorage.setItem(storageKeyForBest(levelId), String(best));
    } catch {
      // ignore
    }
  }

  function setLevel(levelId) {
    state.level = LEVELS[levelId] || LEVELS.city_easy;
    state.best = loadBest(state.level.id);
    ui.best.textContent = String(state.best);
  }

  function resetRun() {
    fitCanvasToCSSSize();
    const rect = canvas.getBoundingClientRect();
    world.w = Math.max(320, Math.floor(rect.width));
    world.h = Math.max(180, Math.floor(rect.height));
    world.floorH = Math.max(56, Math.min(92, Math.floor(world.h * 0.14)));

    world.pipes.length = 0;
    world.spawnTimer = 0;
    world.shake = 0;

    state.score = 0;
    ui.score.textContent = "0";

    const d = world.drone;
    d.x = Math.max(150, Math.floor(world.w * 0.22));
    d.y = Math.floor(world.h * 0.46);
    d.vy = 0;
    d.tilt = 0;
    d.flapFlash = 0;
  }

  function setOverlayVisible(visible) {
    ui.overlay.classList.toggle("hidden", !visible);
  }

  function showMenu() {
    state.mode = "menu";
    setOverlayVisible(true);
    ui.overlayTitle.textContent = "Tap The Drone";
    ui.overlayText.innerHTML =
      "Клик/тап или <kbd>Space</kbd> — импульс вверх. Пролети через окна между препятствиями.";
    ui.btnStart.textContent = "Старт";
  }

  function showGameOver() {
    state.mode = "dead";
    setOverlayVisible(true);
    ui.overlayTitle.textContent = "Поражение";
    ui.overlayText.innerHTML =
      `Счёт: <b>${state.score}</b>. ` +
      `Рекорд (${state.level.name}): <b>${state.best}</b>. ` +
      "Нажми <kbd>R</kbd> или кнопку ниже.";
    ui.btnStart.textContent = "Рестарт";
  }

  function startRun() {
    resetRun();
    state.mode = "running";
    state.lastTs = performance.now();
    setOverlayVisible(false);
    state.startedOnce = true;
  }

  function togglePause() {
    if (state.mode === "running") {
      state.mode = "paused";
      setOverlayVisible(true);
      ui.overlayTitle.textContent = "Пауза";
      ui.overlayText.innerHTML = "Продолжить: <kbd>P</kbd> или кнопка «Старт».";
      ui.btnStart.textContent = "Продолжить";
    } else if (state.mode === "paused") {
      state.mode = "running";
      setOverlayVisible(false);
      state.lastTs = performance.now();
    }
  }

  function doFlap() {
    if (state.mode === "menu") startRun();
    if (state.mode === "dead") startRun();
    if (state.mode !== "running") return;
    const d = world.drone;
    d.vy = -state.level.flapV;
    d.flapFlash = 1;
    beep(440, 45, "triangle");
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
  }

  // --- Obstacles
  function spawnPipe() {
    const lv = state.level;
    const marginTop = 22;
    const marginBottom = world.floorH + 22;
    const gapH = rand(lv.gapMin, lv.gapMax);
    const gapY = rand(marginTop + gapH / 2, world.h - marginBottom - gapH / 2);
    world.pipes.push({
      x: world.w + 20,
      w: lv.pipeWidth,
      gapY,
      gapH,
      scored: false,
    });
  }

  function currentSpeed() {
    return state.level.baseSpeed + state.score * state.level.speedUpPerScore;
  }

  function circlesRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= cr * cr;
  }

  function checkCollisions() {
    const d = world.drone;
    if (d.y - d.r < 0) return true;
    if (d.y + d.r > world.h - world.floorH) return true;
    for (const p of world.pipes) {
      const x = p.x;
      const w = p.w;
      const topH = p.gapY - p.gapH / 2;
      const bottomY = p.gapY + p.gapH / 2;
      const bottomH = world.h - world.floorH - bottomY;
      if (circlesRectOverlap(d.x, d.y, d.r, x, 0, w, topH)) return true;
      if (circlesRectOverlap(d.x, d.y, d.r, x, bottomY, w, bottomH)) return true;
    }
    return false;
  }

  // --- Drawing
  function drawBackground(t) {
    const theme = state.level.theme;
    const g = ctx.createLinearGradient(0, 0, 0, world.h);
    g.addColorStop(0, theme.skyTop);
    g.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);

    // Glow / aurora / haze band
    ctx.save();
    ctx.globalAlpha = 0.22;
    const haze = ctx.createRadialGradient(
      world.w * 0.35,
      world.h * 0.18,
      30,
      world.w * 0.35,
      world.h * 0.18,
      world.w * 0.9,
    );
    haze.addColorStop(0, theme.glow);
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.restore();

    // Parallax silhouettes
    const layers = [
      { y: world.h * 0.78, amp: 16, alpha: 0.16, speed: 10 },
      { y: world.h * 0.82, amp: 22, alpha: 0.12, speed: 16 },
    ];
    for (const L of layers) {
      ctx.save();
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.moveTo(0, world.h);
      const baseY = L.y;
      const step = 70;
      for (let x = 0; x <= world.w + step; x += step) {
        const yy = baseY + Math.sin((x + t * L.speed) / 140) * L.amp;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(world.w, world.h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloor(t) {
    const theme = state.level.theme;
    const y = world.h - world.floorH;
    const g = ctx.createLinearGradient(0, y, 0, world.h);
    g.addColorStop(0, theme.floorA);
    g.addColorStop(1, theme.floorB);
    ctx.fillStyle = g;
    ctx.fillRect(0, y, world.w, world.floorH);

    // scrolling stripes
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    const stripeW = 34;
    const off = ((t * currentSpeed()) / 3) % stripeW;
    for (let x = -stripeW; x < world.w + stripeW; x += stripeW) {
      ctx.fillRect(Math.floor(x - off), y + 12, 16, 4);
    }
    ctx.restore();
  }

  function drawPipe(x, topH, bottomY, bottomH, w) {
    const theme = state.level.theme;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, theme.pipeB);
    grad.addColorStop(0.5, theme.pipeA);
    grad.addColorStop(1, theme.pipeB);
    ctx.fillStyle = grad;

    // top
    roundRect(ctx, x, -2, w, topH + 2, 12);
    ctx.fill();
    // bottom
    roundRect(ctx, x, bottomY, w, bottomH + 2, 12);
    ctx.fill();

    // shine
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + w * 0.18, 0, Math.max(2, w * 0.08), topH);
    ctx.fillRect(x + w * 0.18, bottomY, Math.max(2, w * 0.08), bottomH);
    ctx.restore();
  }

  function drawDrone() {
    const d = world.drone;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.tilt);

    // body glow
    ctx.save();
    ctx.globalAlpha = 0.35 * d.flapFlash + 0.1;
    ctx.fillStyle = state.level.theme.glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    const body = ctx.createLinearGradient(-24, -16, 24, 16);
    body.addColorStop(0, "rgba(255,255,255,0.92)");
    body.addColorStop(1, "rgba(160,210,255,0.72)");
    ctx.fillStyle = body;
    roundRect(ctx, -22, -14, 44, 28, 10);
    ctx.fill();

    // “ЗСУ” label
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = "700 11px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ЗСУ", 0, 1);
    ctx.restore();

    // rotors
    const rotorAlpha = 0.6 + 0.35 * (1 - Math.abs(Math.sin(state.t * 14)));
    ctx.save();
    ctx.globalAlpha = rotorAlpha;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-18, -18);
    ctx.lineTo(-34, -24);
    ctx.moveTo(18, -18);
    ctx.lineTo(34, -24);
    ctx.stroke();
    ctx.restore();

    // eye/cam
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.beginPath();
    ctx.arc(13, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = state.level.theme.glow;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(13, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function render(t) {
    ctx.save();
    if (world.shake > 0.001) {
      const s = world.shake;
      const dx = (Math.random() - 0.5) * 10 * s;
      const dy = (Math.random() - 0.5) * 10 * s;
      ctx.translate(dx, dy);
    }
    drawBackground(t);

    // pipes
    for (const p of world.pipes) {
      const topH = p.gapY - p.gapH / 2;
      const bottomY = p.gapY + p.gapH / 2;
      const bottomH = world.h - world.floorH - bottomY;
      drawPipe(p.x, topH, bottomY, bottomH, p.w);
    }

    drawFloor(t);
    drawDrone();
    ctx.restore();

    // paused overlay hint (canvas-level)
    if (state.mode === "paused") {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, world.w, world.h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#fff";
      ctx.font = "700 18px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Пауза", world.w / 2, world.h / 2 - 10);
      ctx.font = "500 13px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Нажми P чтобы продолжить", world.w / 2, world.h / 2 + 14);
      ctx.restore();
    }
  }

  // --- Update loop
  function step(ts) {
    requestAnimationFrame(step);
    if (!ctx) return;
    fitCanvasToCSSSize();

    const dtRaw = (ts - (state.lastTs || ts)) / 1000;
    state.lastTs = ts;
    const dt = clamp(dtRaw, 0, 0.033); // cap to keep physics stable

    const rect = canvas.getBoundingClientRect();
    world.w = Math.max(320, Math.floor(rect.width));
    world.h = Math.max(180, Math.floor(rect.height));

    if (state.mode === "running") {
      state.t += dt;
      const d = world.drone;
      const lv = state.level;

      // physics
      d.vy += lv.gravity * dt;
      d.y += d.vy * dt;
      d.flapFlash = Math.max(0, d.flapFlash - dt * 2.8);
      d.tilt = lerp(d.tilt, clamp(d.vy / 900, -0.55, 0.95), 0.12);

      // spawn pipes
      world.spawnTimer -= dt;
      if (world.spawnTimer <= 0) {
        spawnPipe();
        world.spawnTimer = lv.spawnEvery;
      }

      // move pipes
      const spd = currentSpeed();
      for (const p of world.pipes) p.x -= spd * dt;
      while (world.pipes.length && world.pipes[0].x + world.pipes[0].w < -40) {
        world.pipes.shift();
      }

      // score
      for (const p of world.pipes) {
        if (!p.scored && p.x + p.w < d.x) {
          p.scored = true;
          state.score += 1;
          ui.score.textContent = String(state.score);
          beep(880, 55, "sine");
          if (state.score > state.best) {
            state.best = state.score;
            ui.best.textContent = String(state.best);
            saveBest(lv.id, state.best);
          }
        }
      }

      // collisions
      if (checkCollisions()) {
        world.shake = 1;
        beep(180, 140, "sawtooth");
        showGameOver();
      }

      // decay shake
      world.shake = Math.max(0, world.shake - dt * 2.5);
    } else {
      // small idle animation
      if (state.mode === "menu" || state.mode === "dead") {
        state.t += dt * 0.7;
        const d = world.drone;
        d.y = lerp(d.y, world.h * 0.46 + Math.sin(state.t * 2.2) * 8, 0.06);
        d.tilt = lerp(d.tilt, Math.sin(state.t * 2) * 0.08, 0.06);
      }
      world.shake = Math.max(0, world.shake - dt * 3.5);
    }

    render(state.t);
  }

  // --- Input wiring
  function onPointerDown(ev) {
    // prevent accidental page scroll on mobile
    ev.preventDefault?.();
    doFlap();
  }

  function onKeyDown(ev) {
    const key = ev.key.toLowerCase();
    if (key === " " || key === "spacebar" || key === "w" || key === "arrowup") {
      ev.preventDefault();
      doFlap();
      return;
    }
    if (key === "p") {
      ev.preventDefault();
      if (state.mode === "running" || state.mode === "paused") togglePause();
      return;
    }
    if (key === "r") {
      ev.preventDefault();
      startRun();
      return;
    }
    if (key === "escape") {
      ev.preventDefault();
      showMenu();
      return;
    }
  }

  function initUI() {
    ui.btnStart.addEventListener("click", () => {
      if (state.mode === "paused") togglePause();
      else startRun();
    });

    ui.btnMute.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      ui.btnMute.setAttribute("aria-pressed", audio.enabled ? "true" : "false");
      ui.btnMute.textContent = audio.enabled ? "Звук: вкл" : "Звук: выкл";
      if (audio.enabled) {
        ensureAudio();
        if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
        beep(660, 40, "triangle");
      }
    });

    ui.levelSelect.addEventListener("change", () => {
      setLevel(ui.levelSelect.value);
      resetRun();
      showMenu();
    });

    // allow start with click anywhere on canvas (but not when paused)
    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    // touch fallback for older browsers
    canvas.addEventListener(
      "touchstart",
      (ev) => {
        ev.preventDefault();
        doFlap();
      },
      { passive: false },
    );
    window.addEventListener("keydown", onKeyDown);

    window.addEventListener("resize", () => {
      resetRun();
    });
  }

  // --- Boot
  function boot() {
    // default selection
    setLevel(ui.levelSelect.value || "city_easy");
    resetRun();
    showMenu();
    requestAnimationFrame(step);
  }

  initUI();
  boot();
})();

