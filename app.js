import { computeSpawnSlots, filterUncaughtSpawns, getGridKey } from './app.logic.js';

const FALLBACK_EVENTS_NODE = {
  set() {},
  map() {
    return { on() {} };
  },
};

let eventsNode = FALLBACK_EVENTS_NODE;
let gridCaughtNode = null;

async function initGun() {
  try {
    const { default: Gun } = await import("https://cdn.jsdelivr.net/npm/gun/gun.js");
    const gun = Gun({
      peers: ["https://relay.peer.ooo/gun", "https://gun.o8.is/gun"],
      localStorage: true,
    });
    const root = gun.get("fokemon");
    eventsNode = root.get("events");
    gridCaughtNode = root.get("caughtByGrid");
    connectFeed();
    connectGridCaught();
  } catch {
    // Keep local gameplay working even when public peers or CDN are unavailable.
    eventsNode = FALLBACK_EVENTS_NODE;
  }
}

initGun();

const cards = [
  { id: "voltlynx", name: "VoltLynx", type: "Electric", latOffset: 0.001, lngOffset: -0.0002 },
  { id: "mossaur", name: "Mossaur", type: "Leaf", latOffset: -0.0006, lngOffset: 0.0008 },
  { id: "aquaphin", name: "AquaPhin", type: "Water", latOffset: 0.0004, lngOffset: 0.0011 },
  { id: "emberoo", name: "Emberoo", type: "Fire", latOffset: -0.001, lngOffset: -0.0007 },
  { id: "cryptowl", name: "CryptOwl", type: "Shadow", latOffset: 0.0002, lngOffset: -0.0012 },
];

const el = {
  auth: document.getElementById("authCard"),
  game: document.getElementById("gameCard"),
  form: document.getElementById("signupForm"),
  name: document.getElementById("trainerName"),
  team: document.getElementById("teamColor"),
  welcome: document.getElementById("welcome"),
  cardsList: document.getElementById("cardsList"),
  nearbyMap: document.getElementById("nearbyMap"),
  enableLocation: document.getElementById("enableLocation"),
  locationStatus: document.getElementById("locationStatus"),
  feedList: document.getElementById("feedList"),
  caughtCount: document.getElementById("caughtCount"),
  uniqueCount: document.getElementById("uniqueCount"),
  collection: document.getElementById("collection"),
  reset: document.getElementById("resetProfile"),
};

let profile = JSON.parse(localStorage.getItem("fokemon_profile") || "null");
let caught = JSON.parse(localStorage.getItem("fokemon_caught") || "[]");
const recentEvents = [];
const caughtIds = new Set(caught.map((c) => c.id));
let feedConnected = false;
let activeChallenge = null;
let currentCoords = { lat: 0, lon: 0 };

function saveLocal() {
  localStorage.setItem("fokemon_profile", JSON.stringify(profile));
  localStorage.setItem("fokemon_caught", JSON.stringify(caught));
}

function renderCollection() {
  el.caughtCount.textContent = caught.length;
  const unique = [...new Set(caught.map((c) => c.id))];
  el.uniqueCount.textContent = unique.length;
  el.collection.innerHTML = unique
    .map((id) => `<span class="chip">${cards.find((c) => c.id === id)?.name || id}</span>`)
    .join("");
}

function renderFeed() {
  const ordered = [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, 20);
  el.feedList.innerHTML = ordered.map((e) => `<li><strong>${e.trainer}</strong> caught ${e.card}</li>`).join("");
}

function publishGridCatch(card, ts) {
  if (!gridCaughtNode) return;
  const key = getGridKey(currentCoords.lat, currentCoords.lon);
  if (!key) return;
  gridCaughtNode.get(key).get(card.id).put({ cardId: card.id, ts });
}

function catchCard(card) {
  const event = {
    trainer: profile.name,
    card: card.name,
    ts: Date.now(),
    lat: playerLocation?.lat ?? null,
    lng: playerLocation?.lng ?? null,
  };

  caught.push({ id: card.id, ts: event.ts });
  caughtIds.add(card.id);
  saveLocal();
  renderCollection();
  refreshCoordsAndCards();
  eventsNode.set(event);
  publishGridCatch(card, event.ts);
}

const TYPE_COLORS = {
  Electric: { light: "#fff48a", dark: "#c98a14" },
  Leaf: { light: "#9cf6a8", dark: "#1f7a3a" },
  Water: { light: "#9fdaff", dark: "#1d63b8" },
  Fire: { light: "#ffb185", dark: "#c43a18" },
  Shadow: { light: "#b9a2ff", dark: "#3d2778" },
};

function launchCatchChallenge(card) {
  if (activeChallenge) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${card.name}</h3>
      <p>Pull back the foke-net, aim with the dotted path, and release to fling it.</p>
      <div class="arena">
        <canvas class="catch-canvas" aria-label="Foke-net slingshot arena"></canvas>
      </div>
      <p class="status">Nets left: <strong>3</strong> • Drag the net to aim</p>
      <button class="ghost cancel">Run away</button>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const canvas = challenge.querySelector(".catch-canvas");
  const status = challenge.querySelector(".status");
  const cancel = challenge.querySelector(".cancel");
  const arena = challenge.querySelector(".arena");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = arena.getBoundingClientRect();
  const W = Math.max(320, Math.floor(rect.width));
  const H = Math.max(240, Math.floor(rect.height));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const ANCHOR = { x: W * 0.18, y: H * 0.72 };
  const NET_RADIUS = 18;
  const GRAVITY = 950;
  const FLOOR_Y = H - 14;
  const MAX_PULL = Math.min(120, FLOOR_Y - ANCHOR.y - NET_RADIUS - 4);
  const POWER = 14;
  const REST_OFFSET = { x: 0, y: -(NET_RADIUS + 8) };
  const RESTING = { x: ANCHOR.x + REST_OFFSET.x, y: ANCHOR.y + REST_OFFSET.y };
  const colors = TYPE_COLORS[card.type] || { light: "#cfd8ff", dark: "#3d4d8a" };

  const fokemon = {
    x: W * 0.74,
    y: H * 0.45,
    r: 30,
    bobPhase: Math.random() * Math.PI * 2,
    hopCooldown: 3.2,
    caught: false,
    captureScale: 1,
    dodgeVx: 0,
    dodgeTime: 0,
  };

  const DODGE_CHANCE = 0.45;
  const DODGE_RANGE = 95;
  const DODGE_SPEED = 360;
  const DODGE_DURATION = 0.26;

  let nets = 3;
  let aiming = null;
  let projectile = null;
  let finished = false;
  let outcome = null;
  let netSpin = 0;
  let dodgeArmed = false;
  let dodgeTriggered = false;

  function statusText() {
    if (finished && outcome === "caught") return `<span class="success">Captured!</span> ${card.name} joined your collection.`;
    if (finished && outcome === "escaped") return `<span class="fail">Escaped!</span> ${card.name} got away.`;
    if (aiming) return `Nets left: <strong>${nets}</strong> • Release to fire!`;
    if (projectile) return `Nets left: <strong>${nets}</strong> • Net in flight…`;
    return `Nets left: <strong>${nets}</strong> • Drag the net to aim`;
  }

  function setStatus() {
    status.innerHTML = statusText();
  }

  function getPointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function netRestPosition() {
    if (aiming) return aiming;
    return RESTING;
  }

  function onDown(e) {
    if (finished || projectile || nets <= 0) return;
    const p = getPointer(e);
    const dx = p.x - RESTING.x;
    const dy = p.y - RESTING.y;
    if (dx * dx + dy * dy > 70 * 70) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    aiming = { x: RESTING.x, y: RESTING.y };
    setStatus();
  }

  function onMove(e) {
    if (!aiming) return;
    e.preventDefault();
    const p = getPointer(e);
    let dx = p.x - ANCHOR.x;
    let dy = p.y - ANCHOR.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_PULL) {
      dx = (dx / dist) * MAX_PULL;
      dy = (dy / dist) * MAX_PULL;
    }
    // Keep the aim point onscreen so the net + trajectory stay visible.
    let aimX = ANCHOR.x + dx;
    let aimY = ANCHOR.y + dy;
    aimX = Math.max(NET_RADIUS, Math.min(W - NET_RADIUS, aimX));
    aimY = Math.max(NET_RADIUS, Math.min(FLOOR_Y - NET_RADIUS, aimY));
    aiming = { x: aimX, y: aimY };
  }

  function onUp(e) {
    if (!aiming) return;
    e.preventDefault();
    const pullDx = ANCHOR.x - aiming.x;
    const pullDy = ANCHOR.y - aiming.y;
    const pullMag = Math.hypot(pullDx, pullDy);
    if (pullMag < 10) {
      aiming = null;
      setStatus();
      return;
    }
    projectile = {
      x: aiming.x,
      y: aiming.y,
      vx: pullDx * POWER,
      vy: pullDy * POWER,
    };
    aiming = null;
    nets -= 1;
    dodgeArmed = !fokemon.caught && Math.random() < DODGE_CHANCE;
    dodgeTriggered = false;
    setStatus();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  function hopFokemon() {
    fokemon.x = W * (0.55 + Math.random() * 0.32);
    fokemon.y = H * (0.28 + Math.random() * 0.42);
  }

  function step(dt) {
    fokemon.bobPhase += dt * 2.4;
    if (!fokemon.caught) {
      fokemon.hopCooldown -= dt;
      if (fokemon.hopCooldown <= 0) {
        hopFokemon();
        fokemon.hopCooldown = 2.4 + Math.random() * 1.6;
      }
    } else {
      fokemon.captureScale = Math.max(0, fokemon.captureScale - dt * 2.4);
    }

    if (fokemon.dodgeTime > 0) {
      fokemon.x += fokemon.dodgeVx * dt;
      fokemon.dodgeTime -= dt;
      if (fokemon.dodgeTime <= 0) {
        fokemon.dodgeVx = 0;
      }
      fokemon.x = Math.max(fokemon.r + 4, Math.min(W - fokemon.r - 4, fokemon.x));
    }

    if (projectile) {
      netSpin += dt * 8;
      projectile.vy += GRAVITY * dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      const bobY = fokemon.y + Math.sin(fokemon.bobPhase) * 5;

      if (!fokemon.caught && dodgeArmed && !dodgeTriggered) {
        const adx = projectile.x - fokemon.x;
        const ady = projectile.y - bobY;
        if (Math.hypot(adx, ady) < DODGE_RANGE) {
          // Slide away from incoming net horizontally, biased so we slide off-screen-safe
          let direction = adx > 0 ? -1 : 1;
          if (fokemon.x < fokemon.r * 2) direction = 1;
          else if (fokemon.x > W - fokemon.r * 2) direction = -1;
          fokemon.dodgeVx = direction * DODGE_SPEED;
          fokemon.dodgeTime = DODGE_DURATION;
          dodgeTriggered = true;
        }
      }

      if (!fokemon.caught) {
        const ddx = projectile.x - fokemon.x;
        const ddy = projectile.y - bobY;
        if (Math.hypot(ddx, ddy) < fokemon.r + NET_RADIUS - 4) {
          fokemon.caught = true;
          finished = true;
          outcome = "caught";
          projectile = null;
          cancel.textContent = "Awesome!";
          setStatus();
          setTimeout(() => {
            catchCard(card);
            setTimeout(closeChallenge, 700);
          }, 700);
          return;
        }
      }

      const offscreen = projectile.x < -40 || projectile.x > W + 40 || projectile.y > FLOOR_Y + NET_RADIUS;
      if (offscreen) {
        projectile = null;
        // Make the Fokemon dart after a near miss for extra challenge
        if (!fokemon.caught) {
          hopFokemon();
          fokemon.hopCooldown = 2.6;
        }
        if (nets <= 0) {
          finished = true;
          outcome = "escaped";
          cancel.textContent = "Close";
          setStatus();
          setTimeout(closeChallenge, 1500);
        } else {
          setStatus();
        }
      }
    }
  }

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);

    // ground band
    const grad = ctx.createLinearGradient(0, FLOOR_Y - 20, 0, H);
    grad.addColorStop(0, "rgba(124, 240, 198, 0.05)");
    grad.addColorStop(1, "rgba(124, 240, 198, 0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, FLOOR_Y - 4, W, H - FLOOR_Y + 4);

    ctx.strokeStyle = "rgba(143, 171, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(W, FLOOR_Y);
    ctx.stroke();
  }

  function drawSlingshot(netPos, inFlight) {
    // Y posts
    ctx.fillStyle = "#5a3a22";
    ctx.beginPath();
    ctx.moveTo(ANCHOR.x - 7, ANCHOR.y + 28);
    ctx.lineTo(ANCHOR.x + 7, ANCHOR.y + 28);
    ctx.lineTo(ANCHOR.x + 3, ANCHOR.y - 6);
    ctx.lineTo(ANCHOR.x - 3, ANCHOR.y - 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#7a5230";
    ctx.beginPath();
    ctx.moveTo(ANCHOR.x - 4, ANCHOR.y - 6);
    ctx.quadraticCurveTo(ANCHOR.x - 22, ANCHOR.y - 18, ANCHOR.x - 18, ANCHOR.y - 30);
    ctx.lineTo(ANCHOR.x - 13, ANCHOR.y - 30);
    ctx.quadraticCurveTo(ANCHOR.x - 16, ANCHOR.y - 20, ANCHOR.x - 4, ANCHOR.y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ANCHOR.x + 4, ANCHOR.y - 6);
    ctx.quadraticCurveTo(ANCHOR.x + 22, ANCHOR.y - 18, ANCHOR.x + 18, ANCHOR.y - 30);
    ctx.lineTo(ANCHOR.x + 13, ANCHOR.y - 30);
    ctx.quadraticCurveTo(ANCHOR.x + 16, ANCHOR.y - 20, ANCHOR.x + 4, ANCHOR.y - 12);
    ctx.closePath();
    ctx.fill();

    const leftTop = { x: ANCHOR.x - 16, y: ANCHOR.y - 26 };
    const rightTop = { x: ANCHOR.x + 16, y: ANCHOR.y - 26 };
    ctx.strokeStyle = "#d3a36b";
    ctx.lineCap = "round";

    if (inFlight) {
      // Bands snap back across the fork while a net is in flight.
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(leftTop.x, leftTop.y);
      ctx.quadraticCurveTo(ANCHOR.x, ANCHOR.y - 8, rightTop.x, rightTop.y);
      ctx.stroke();
    } else {
      // Bands stretched to wherever the net currently sits.
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(leftTop.x, leftTop.y);
      ctx.lineTo(netPos.x - 2, netPos.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightTop.x, rightTop.y);
      ctx.lineTo(netPos.x + 2, netPos.y);
      ctx.stroke();
    }
  }

  function drawTrajectory() {
    if (!aiming) return;
    const vx = (ANCHOR.x - aiming.x) * POWER;
    const vy = (ANCHOR.y - aiming.y) * POWER;
    const pullMag = Math.hypot(ANCHOR.x - aiming.x, ANCHOR.y - aiming.y);
    const tints = pullMag / MAX_PULL;
    ctx.fillStyle = `rgba(124, 240, 198, ${0.35 + tints * 0.5})`;
    let crossedFloor = false;
    for (let t = 0.04; t < 2.4; t += 0.06) {
      const px = aiming.x + vx * t;
      const py = aiming.y + vy * t + 0.5 * GRAVITY * t * t;
      if (px < -20 || px > W + 20) break;
      if (py > FLOOR_Y) {
        if (crossedFloor) break;
        continue;
      }
      if (py < 0) continue;
      crossedFloor = true;
      const size = 2.2 + (1 - t / 2.4) * 1.8;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFokemon() {
    if (fokemon.caught && fokemon.captureScale <= 0) return;
    const scale = fokemon.caught ? fokemon.captureScale : 1;
    const bobY = fokemon.y + Math.sin(fokemon.bobPhase) * 5;
    const r = fokemon.r * scale;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(fokemon.x, FLOOR_Y - 2, r * 0.75, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    const grad = ctx.createRadialGradient(fokemon.x - r * 0.3, bobY - r * 0.4, r * 0.15, fokemon.x, bobY, r);
    grad.addColorStop(0, colors.light);
    grad.addColorStop(1, colors.dark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fokemon.x, bobY, r, 0, Math.PI * 2);
    ctx.fill();

    if (!fokemon.caught) {
      // eyes
      ctx.fillStyle = "#0b1226";
      ctx.beginPath();
      ctx.arc(fokemon.x - r * 0.28, bobY - r * 0.12, r * 0.11, 0, Math.PI * 2);
      ctx.arc(fokemon.x + r * 0.28, bobY - r * 0.12, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(fokemon.x - r * 0.24, bobY - r * 0.16, r * 0.04, 0, Math.PI * 2);
      ctx.arc(fokemon.x + r * 0.32, bobY - r * 0.16, r * 0.04, 0, Math.PI * 2);
      ctx.fill();

      // name label above
      ctx.font = "600 12px Outfit, sans-serif";
      ctx.fillStyle = "rgba(245, 247, 255, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(card.name, fokemon.x, bobY - r - 8);
    }
  }

  function drawNet(pos, rotate) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (rotate) ctx.rotate(netSpin);

    ctx.fillStyle = "rgba(124, 240, 198, 0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, NET_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#7cf0c6";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, NET_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(124, 240, 198, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const off = i * (NET_RADIUS / 2.6);
      const w = Math.sqrt(Math.max(0, NET_RADIUS * NET_RADIUS - off * off));
      ctx.moveTo(-w, off);
      ctx.lineTo(w, off);
      ctx.moveTo(off, -w);
      ctx.lineTo(off, w);
    }
    ctx.stroke();

    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawFokemon();

    const netPos = projectile ? projectile : netRestPosition();
    drawSlingshot(netPos, !!projectile);
    drawTrajectory();
    drawNet(netPos, !!projectile);
  }

  let lastTime = performance.now();
  let rafId = 0;
  function loop(now) {
    if (!document.body.contains(challenge)) return;
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (!finished || (fokemon.caught && fokemon.captureScale > 0)) step(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function closeChallenge() {
    cancelAnimationFrame(rafId);
    challenge.remove();
    activeChallenge = null;
  }

  cancel.addEventListener("click", closeChallenge);

  setStatus();
  rafId = requestAnimationFrame(loop);
}

function renderCards() {
  const spawns = computeSpawnSlots(cards, {
    timeMs: Date.now(),
    lat: currentCoords.lat,
    lon: currentCoords.lon,
    intervalMs: 3 * 60 * 1000,
    maxSpawns: 3,
  });
  const availableCards = filterUncaughtSpawns(spawns, caughtIds);

  if (!availableCards.length) {
    el.cardsList.innerHTML = `<p class="empty-state">You caught every nearby Fokemon. Check back later for new spawns.</p>`;
    return;
  }

  el.cardsList.innerHTML = availableCards
    .map(
      (card) => `
    <article class="poke-card">
      <strong>${card.name}</strong>
      <div>${card.type}</div>
      <button data-id="${card.id}">Start catch challenge</button>
    </article>
  `
    )
    .join("");

  el.cardsList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = cards.find((c) => c.id === btn.dataset.id);
      launchCatchChallenge(card);
    });
  });
}

function renderMap() {
  const availableCards = cards.filter((card) => isSpawnAvailable(card));
  const points = availableCards
    .map((card) => {
      const meters = playerLocation ? Math.round(distanceMeters(playerLocation, getCardLocation(card))) : null;
      return `<div class="map-point ${meters !== null && meters <= catchRangeMeters ? "near" : ""}" style="left:${Math.min(92, Math.max(8, 50 + card.lngOffset * 22000))}%;top:${Math.min(90, Math.max(10, 50 - card.latOffset * 22000))}%">
          <span>${card.name}</span>
          <small>${meters === null ? "distance unknown" : `${meters}m`}</small>
        </div>`;
    })
    .join("");

  const playerMarkers = playerLocation
    ? [...trainerLocations.entries()]
    .filter(([name, pos]) => name !== profile?.name && Date.now() - pos.ts < 30 * 60 * 1000)
    .map(([name, pos]) => {
      const deltaLng = pos.lng - playerLocation.lng;
      const deltaLat = pos.lat - playerLocation.lat;
      const left = Math.min(95, Math.max(5, 50 + deltaLng * 22000));
      const top = Math.min(95, Math.max(5, 50 - deltaLat * 22000));
      return `<div class="trainer-dot" style="left:${left}%;top:${top}%">${name.slice(0, 2).toUpperCase()}</div>`;
    })
    .join("")
    : "";

  el.nearbyMap.innerHTML = `${playerLocation ? `<div class="player-dot">You</div>` : `<div class="map-hint">Enable location for live distance + proximity catching.</div>`}${playerMarkers}${points}`;
}

function updateLocationStatus(text) {
  el.locationStatus.textContent = text;
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    updateLocationStatus("Geolocation unavailable in this browser.");
    return;
  }
  updateLocationStatus("Requesting location…");

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      playerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateLocationStatus(`Live • ${playerLocation.lat.toFixed(4)}, ${playerLocation.lng.toFixed(4)}`);
      renderMap();
      renderCards();
    },
    () => updateLocationStatus("Location permission denied or unavailable."),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
  );
}

function connectFeed() {
  if (feedConnected) return;
  feedConnected = true;

  eventsNode.map().on((event) => {
    if (!event || !event.ts || !event.trainer || !event.card) return;
    const alreadyThere = recentEvents.some((e) => e.ts === event.ts && e.trainer === event.trainer && e.card === event.card);
    if (alreadyThere) return;
    recentEvents.push(event);
    if (event.lat && event.lng) {
      trainerLocations.set(event.trainer, { lat: event.lat, lng: event.lng, ts: event.ts });
    }
    if (recentEvents.length > 100) recentEvents.shift();
    renderFeed();
    renderMap();
  });
}

function connectGridCaught() {
  if (!gridCaughtNode) return;
  const key = getGridKey(currentCoords.lat, currentCoords.lon);
  if (!key) return;
  gridCaughtNode.get(key).map().on((entry) => {
    if (!entry?.cardId) return;
    if (!caughtIds.has(entry.cardId)) {
      caughtIds.add(entry.cardId);
      refreshCoordsAndCards();
    }
  });
}

function refreshCoordsAndCards() {
  if (!navigator.geolocation) {
    renderCards();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      connectGridCaught();
      renderCards();
    },
    () => renderCards(),
    { maximumAge: 120000, timeout: 3000 }
  );
}

function enterGame() {
  el.auth.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.welcome.textContent = `Welcome, ${profile.name}`;
  document.documentElement.style.setProperty(
    "--accent",
    profile.team === "violet" ? "#ca90ff" : profile.team === "sun" ? "#ffd173" : "#7cf0c6"
  );
  refreshCoordsAndCards();
  renderCards();
  renderMap();
  renderCollection();
  connectFeed();
  if (!playerLocation) startLocationTracking();
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  profile = { name: el.name.value.trim(), team: el.team.value };
  if (!profile.name) return;
  saveLocal();
  enterGame();
});

el.reset.addEventListener("click", () => {
  localStorage.removeItem("fokemon_profile");
  location.reload();
});
el.enableLocation.addEventListener("click", startLocationTracking);

if (profile?.name) enterGame();
setInterval(() => {
  renderCards();
  renderMap();
}, 1000);
