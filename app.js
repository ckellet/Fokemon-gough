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

function launchCatchChallenge(card) {
  if (activeChallenge) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${card.name}</h3>
      <p>Hold your focus and click the glowing core while it moves.</p>
      <div class="arena">
        <button class="target" aria-label="Catch target"></button>
      </div>
      <p class="status">Hits: <strong>0/3</strong> • Time left: <strong>6.0s</strong></p>
      <button class="ghost cancel">Run away</button>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const target = challenge.querySelector(".target");
  const status = challenge.querySelector(".status");
  const cancel = challenge.querySelector(".cancel");

  let hits = 0;
  const totalHits = 3;
  const duration = 6000;
  const started = performance.now();

  function moveTarget() {
    const x = Math.random() * 75 + 5;
    const y = Math.random() * 70 + 8;
    target.style.left = `${x}%`;
    target.style.top = `${y}%`;
  }

  function closeChallenge() {
    challenge.remove();
    activeChallenge = null;
  }

  function updateStatus(timeLeftMs) {
    status.innerHTML = `Hits: <strong>${hits}/${totalHits}</strong> • Time left: <strong>${(timeLeftMs / 1000).toFixed(1)}s</strong>`;
  }

  function tick() {
    const elapsed = performance.now() - started;
    const left = Math.max(0, duration - elapsed);
    updateStatus(left);
    if (left <= 0) {
      status.innerHTML = `<span class="fail">escaped!</span> ${card.name} slipped away.`;
      setTimeout(closeChallenge, 900);
      return;
    }
    requestAnimationFrame(tick);
  }

  const mover = setInterval(moveTarget, 500);
  moveTarget();
  tick();

  target.addEventListener("click", () => {
    hits += 1;
    target.classList.add("hit");
    setTimeout(() => target.classList.remove("hit"), 140);
    if (hits >= totalHits) {
      clearInterval(mover);
      status.innerHTML = `<span class="success">Captured!</span> ${card.name} joined your collection.`;
      catchCard(card);
      setTimeout(closeChallenge, 800);
      return;
    }
    moveTarget();
  });

  cancel.addEventListener("click", () => {
    clearInterval(mover);
    closeChallenge();
  });
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
