/* FPV Bomber — minimal top-down prototype (no deps) */
(() => {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    score: document.getElementById("uiScore"),
    ammo: document.getElementById("uiAmmo"),
    reload: document.getElementById("uiReload"),
    reloadBar: document.getElementById("uiReloadBar"),
    scoreTable: document.getElementById("uiScoreTable"),
    shop: document.getElementById("uiShop"),
    shopMeta: document.getElementById("uiShopMeta"),
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hypot = (x, y) => Math.hypot(x, y);

  const WORLD = { w: 2600, h: 1800 };
  const CAMERA = { x: 0, y: 0 };

  const SCORE_TABLE = [
    { id: "chmonya", name: "Чмоня", points: 10, color: "#a0ff5a", r: 10 },
    { id: "tent", name: "Палатка", points: 20, color: "#ffd166", r: 14 },
    { id: "ammo", name: "Боеприпасы", points: 50, color: "#4cc9f0", r: 12 },
    { id: "vehicle", name: "Техника", points: 100, color: "#ff4d6d", r: 18 },
  ];

  function renderScoreTable() {
    ui.scoreTable.innerHTML = "";
    for (const row of SCORE_TABLE) {
      const li = document.createElement("li");
      li.textContent = `${row.name} — ${row.points} очей`;
      ui.scoreTable.appendChild(li);
    }
  }

  const BASE = {
    speed: 360,
    accel: 1400,
    drag: 7.5,
    bombFuse: 0.45,
    bombRadius: 34,
    maxAmmo: 2,
    reloadTime: 2.2,
  };

  const state = {
    t: 0,
    dt: 0,
    score: 0,
    shopOpen: false,
    floaters: /** @type {Array<{x:number,y:number,txt:string,ttl:number,color:string}>} */ ([]),
  };

  const drone = {
    x: WORLD.w * 0.5,
    y: WORLD.h * 0.5,
    vx: 0,
    vy: 0,
    ammo: BASE.maxAmmo,
    reloading: false,
    reloadT: 0,
    // upgrade levels
    lvlSpeed: 0,
    lvlReload: 0,
    lvlRadius: 0,
    lvlAmmo: 0,
  };

  function derivedStats() {
    const speed = BASE.speed * (1 + 0.12 * drone.lvlSpeed);
    const bombRadius = BASE.bombRadius * (1 + 0.14 * drone.lvlRadius);
    const maxAmmo = BASE.maxAmmo + drone.lvlAmmo;
    const reloadTime = clamp(BASE.reloadTime * Math.pow(0.9, drone.lvlReload), 0.55, 99);
    return { speed, bombRadius, maxAmmo, reloadTime };
  }

  /** @type {Array<{id:string,name:string,desc:(s:ReturnType<typeof derivedStats>)=>string,baseCost:number,costMult:number,maxLevel:number,getLevel:()=>number,incLevel:()=>void}>} */
  const SHOP = [
    {
      id: "speed",
      name: "Скорость",
      desc: (s) => `Макс. скорость: ${Math.round(s.speed)} ( +12%/ур.)`,
      baseCost: 80,
      costMult: 1.55,
      maxLevel: 10,
      getLevel: () => drone.lvlSpeed,
      incLevel: () => (drone.lvlSpeed += 1),
    },
    {
      id: "reload",
      name: "Перезарядка",
      desc: (s) => `Время: ${s.reloadTime.toFixed(2)}с ( -10%/ур.)`,
      baseCost: 120,
      costMult: 1.6,
      maxLevel: 12,
      getLevel: () => drone.lvlReload,
      incLevel: () => (drone.lvlReload += 1),
    },
    {
      id: "radius",
      name: "Радиус урона",
      desc: (s) => `Радиус: ${Math.round(s.bombRadius)} ( +14%/ур.)`,
      baseCost: 100,
      costMult: 1.55,
      maxLevel: 10,
      getLevel: () => drone.lvlRadius,
      incLevel: () => (drone.lvlRadius += 1),
    },
    {
      id: "ammo",
      name: "Боезапас",
      desc: (s) => `Ёмкость: ${s.maxAmmo} ( +1/ур.)`,
      baseCost: 150,
      costMult: 1.7,
      maxLevel: 6,
      getLevel: () => drone.lvlAmmo,
      incLevel: () => (drone.lvlAmmo += 1),
    },
  ];

  function costFor(item) {
    return Math.ceil(item.baseCost * Math.pow(item.costMult, item.getLevel()));
  }

  function renderShop() {
    const s = derivedStats();
    ui.shop.innerHTML = "";
    ui.shopMeta.innerHTML = state.shopOpen
      ? `Магазин открыт. Кликай “Купить” или жми <b>Tab</b> чтобы закрыть.`
      : `Нажми <b>Tab</b>, чтобы открыть`;

    if (!state.shopOpen) return;

    for (const item of SHOP) {
      const level = item.getLevel();
      const cost = costFor(item);
      const canBuy = state.score >= cost && level < item.maxLevel;

      const wrap = document.createElement("div");
      wrap.className = "shopItem";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.name;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = item.desc(s);
      const lvl = document.createElement("div");
      lvl.className = "lvl";
      lvl.textContent = `Уровень: ${level}/${item.maxLevel} · Цена: ${level >= item.maxLevel ? "MAX" : cost}`;
      left.appendChild(title);
      left.appendChild(desc);
      left.appendChild(lvl);

      const btn = document.createElement("button");
      btn.textContent = level >= item.maxLevel ? "MAX" : `Купить (${cost})`;
      btn.disabled = !canBuy;
      btn.addEventListener("click", () => {
        buyUpgrade(item.id);
      });

      wrap.appendChild(left);
      wrap.appendChild(btn);
      ui.shop.appendChild(wrap);
    }
  }

  function buyUpgrade(id) {
    const item = SHOP.find((x) => x.id === id);
    if (!item) return;
    const level = item.getLevel();
    if (level >= item.maxLevel) return;
    const cost = costFor(item);
    if (state.score < cost) return;
    state.score -= cost;
    item.incLevel();

    // Keep ammo within new capacity.
    const s = derivedStats();
    drone.ammo = clamp(drone.ammo, 0, s.maxAmmo);

    state.floaters.push({
      x: drone.x,
      y: drone.y - 24,
      txt: `Апгрейд: ${item.name} +1`,
      ttl: 1.0,
      color: "#b8f2e6",
    });

    renderShop();
  }

  /** @type {Array<{x:number,y:number,typeId:string}>} */
  const targets = [];

  /** @type {Array<{x:number,y:number,fuse:number,t:number,r:number,exploded:boolean}>} */
  const bombs = [];

  /** @type {Array<{x:number,y:number,r:number,t:number,ttl:number}>} */
  const explosions = [];

  function spawnTarget() {
    const t = SCORE_TABLE[(Math.random() * SCORE_TABLE.length) | 0];
    const margin = 60;
    const x = margin + Math.random() * (WORLD.w - margin * 2);
    const y = margin + Math.random() * (WORLD.h - margin * 2);
    targets.push({ x, y, typeId: t.id });
  }

  function ensureTargets() {
    // Keep some density; respawn as you clear.
    const wanted = 22;
    while (targets.length < wanted) spawnTarget();
  }

  function targetDef(typeId) {
    return SCORE_TABLE.find((x) => x.id === typeId) ?? SCORE_TABLE[0];
  }

  function addScore(points, x, y, label) {
    state.score += points;
    state.floaters.push({
      x,
      y,
      txt: `+${points} (${label})`,
      ttl: 0.9,
      color: "#e8eef7",
    });
    renderShop();
  }

  function tryStartReload() {
    if (drone.reloading) return;
    const s = derivedStats();
    if (drone.ammo >= s.maxAmmo) return;
    drone.reloading = true;
    drone.reloadT = 0;
  }

  function tryDropBomb() {
    const s = derivedStats();
    if (drone.reloading) return;
    if (drone.ammo <= 0) {
      tryStartReload();
      return;
    }
    drone.ammo -= 1;
    bombs.push({
      x: drone.x,
      y: drone.y,
      fuse: BASE.bombFuse,
      t: 0,
      r: s.bombRadius,
      exploded: false,
    });
    if (drone.ammo <= 0) {
      // You can still manually delay reload, but default is start it now.
      tryStartReload();
    }
  }

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    const key = e.key;
    if (key === " " && !e.repeat) {
      e.preventDefault();
      tryDropBomb();
      return;
    }
    if ((key === "r" || key === "R") && !e.repeat) {
      tryStartReload();
      return;
    }
    if (key === "Tab" && !e.repeat) {
      e.preventDefault();
      state.shopOpen = !state.shopOpen;
      renderShop();
      return;
    }
    keys.add(key);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  function inputAxis() {
    const up = keys.has("w") || keys.has("W") || keys.has("ArrowUp");
    const down = keys.has("s") || keys.has("S") || keys.has("ArrowDown");
    const left = keys.has("a") || keys.has("A") || keys.has("ArrowLeft");
    const right = keys.has("d") || keys.has("D") || keys.has("ArrowRight");
    let ax = 0;
    let ay = 0;
    if (left) ax -= 1;
    if (right) ax += 1;
    if (up) ay -= 1;
    if (down) ay += 1;
    const len = Math.hypot(ax, ay) || 1;
    return { ax: ax / len, ay: ay / len, raw: Math.hypot(ax, ay) };
  }

  function update(dt) {
    state.t += dt;
    state.dt = dt;

    ensureTargets();

    // reload
    if (drone.reloading) {
      const s = derivedStats();
      drone.reloadT += dt;
      if (drone.reloadT >= s.reloadTime) {
        drone.reloading = false;
        drone.reloadT = 0;
        drone.ammo = s.maxAmmo;
      }
    }

    // movement
    const s = derivedStats();
    const inp = inputAxis();
    const accel = BASE.accel;
    if (inp.raw > 0.01) {
      drone.vx += inp.ax * accel * dt;
      drone.vy += inp.ay * accel * dt;
    }

    // drag & max speed clamp
    drone.vx *= Math.exp(-BASE.drag * dt);
    drone.vy *= Math.exp(-BASE.drag * dt);
    const sp = hypot(drone.vx, drone.vy);
    if (sp > s.speed) {
      const k = s.speed / sp;
      drone.vx *= k;
      drone.vy *= k;
    }

    drone.x += drone.vx * dt;
    drone.y += drone.vy * dt;
    drone.x = clamp(drone.x, 0, WORLD.w);
    drone.y = clamp(drone.y, 0, WORLD.h);

    // camera follow
    const targetCamX = clamp(drone.x - canvas.width / 2, 0, WORLD.w - canvas.width);
    const targetCamY = clamp(drone.y - canvas.height / 2, 0, WORLD.h - canvas.height);
    CAMERA.x = lerp(CAMERA.x, targetCamX, 1 - Math.exp(-10 * dt));
    CAMERA.y = lerp(CAMERA.y, targetCamY, 1 - Math.exp(-10 * dt));

    // bombs
    for (const b of bombs) {
      if (b.exploded) continue;
      b.t += dt;
      if (b.t >= b.fuse) {
        b.exploded = true;
        explosions.push({ x: b.x, y: b.y, r: b.r, t: 0, ttl: 0.35 });

        // hit test
        for (let i = targets.length - 1; i >= 0; i -= 1) {
          const tg = targets[i];
          const def = targetDef(tg.typeId);
          const d = hypot(tg.x - b.x, tg.y - b.y);
          if (d <= b.r + def.r * 0.25) {
            targets.splice(i, 1);
            addScore(def.points, tg.x, tg.y - 12, def.name);
          }
        }
      }
    }

    // explosions animation
    for (let i = explosions.length - 1; i >= 0; i -= 1) {
      const ex = explosions[i];
      ex.t += dt;
      if (ex.t >= ex.ttl) explosions.splice(i, 1);
    }

    // floaters
    for (let i = state.floaters.length - 1; i >= 0; i -= 1) {
      const f = state.floaters[i];
      f.ttl -= dt;
      f.y -= 22 * dt;
      if (f.ttl <= 0) state.floaters.splice(i, 1);
    }

    // UI
    ui.score.textContent = String(state.score);
    ui.ammo.textContent = `${drone.ammo}/${s.maxAmmo}`;
    if (drone.reloading) {
      const p = clamp(drone.reloadT / s.reloadTime, 0, 1);
      ui.reload.textContent = `${(s.reloadTime - drone.reloadT).toFixed(1)}с`;
      ui.reloadBar.style.width = `${Math.round(p * 100)}%`;
    } else {
      ui.reload.textContent = "готово";
      ui.reloadBar.style.width = "0%";
    }
  }

  function drawGrid() {
    const step = 80;
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;

    const x0 = Math.floor(CAMERA.x / step) * step;
    const y0 = Math.floor(CAMERA.y / step) * step;
    const x1 = CAMERA.x + canvas.width + step;
    const y1 = CAMERA.y + canvas.height + step;
    for (let x = x0; x <= x1; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.h);
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTargets() {
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);
    for (const t of targets) {
      const def = targetDef(t.typeId);
      ctx.beginPath();
      ctx.fillStyle = def.color;
      ctx.arc(t.x, t.y, def.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(t.x + 3, t.y + 3, def.r * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawBombs() {
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);
    for (const b of bombs) {
      if (b.exploded) continue;
      const p = clamp(b.t / b.fuse, 0, 1);
      ctx.beginPath();
      ctx.fillStyle = `rgba(124,77,255,${0.15 + 0.55 * p})`;
      ctx.arc(b.x, b.y, 6 + 6 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawExplosions() {
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);
    for (const ex of explosions) {
      const p = clamp(ex.t / ex.ttl, 0, 1);
      const r = ex.r * (0.35 + 0.85 * p);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,77,109,${0.18 * (1 - p)})`;
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDrone() {
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);

    // body
    const heading = Math.atan2(drone.vy, drone.vx);
    const sp = hypot(drone.vx, drone.vy);
    const angle = sp > 12 ? heading : 0;

    ctx.translate(drone.x, drone.y);
    ctx.rotate(angle);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -9);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-12, 9);
    ctx.closePath();
    ctx.fill();

    // arms / rotors hint
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(50,210,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, -14);
    ctx.lineTo(-3, 14);
    ctx.moveTo(-14, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();

    // reload indicator
    if (drone.reloading) {
      const s = derivedStats();
      const p = clamp(drone.reloadT / s.reloadTime, 0, 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawFloaters() {
    ctx.save();
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(-CAMERA.x, -CAMERA.y);
    for (const f of state.floaters) {
      const a = clamp(f.ttl / 0.9, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.restore();
  }

  function drawWorldBounds() {
    ctx.save();
    ctx.translate(-CAMERA.x, -CAMERA.y);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, WORLD.w, WORLD.h);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawWorldBounds();
    drawTargets();
    drawBombs();
    drawExplosions();
    drawDrone();
    drawFloaters();
  }

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.04);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function init() {
    renderScoreTable();
    renderShop();
    ensureTargets();
    requestAnimationFrame(frame);
  }

  init();
})();

