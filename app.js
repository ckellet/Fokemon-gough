import {
  computeSpawnPlacements,
  filterUncaughtSpawns,
  getGridKey,
  SPAWN_CELL_DEGREES,
} from "./app.logic.js";

const SPAWN_INTERVAL_MS = 3 * 60 * 1000;
const MAX_SPAWNS = 4;
const CATCH_RANGE_METERS = 80;
const GUN_PEERS = ["https://relay.peer.ooo/gun", "https://gun.o8.is/gun"];

const FALLBACK_EVENTS_NODE = {
  set() {},
  map() {
    return { on() {} };
  },
};

let eventsNode = FALLBACK_EVENTS_NODE;
let gridCaughtNode = null;
let lastGridKey = null;

const cards = [
  { id: "voltlynx", name: "VoltLynx", type: "Electric" },
  { id: "mossaur", name: "Mossaur", type: "Leaf" },
  { id: "aquaphin", name: "AquaPhin", type: "Water" },
  { id: "emberoo", name: "Emberoo", type: "Fire" },
  { id: "cryptowl", name: "CryptOwl", type: "Shadow" },
];
const cardsById = new Map(cards.map((c) => [c.id, c]));

function $(id) {
  return typeof document === "undefined" ? null : document.getElementById(id);
}

const el = {
  auth: $("authCard"),
  game: $("gameCard"),
  form: $("signupForm"),
  name: $("trainerName"),
  team: $("teamColor"),
  welcome: $("welcome"),
  cardsList: $("cardsList"),
  nearbyMap: $("nearbyMap"),
  mapHint: $("mapHint"),
  mapBucket: $("mapBucket"),
  enableLocation: $("enableLocation"),
  locationStatus: $("locationStatus"),
  feedList: $("feedList"),
  caughtCount: $("caughtCount"),
  uniqueCount: $("uniqueCount"),
  collection: $("collection"),
  reset: $("resetProfile"),
};

function safeStorageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

let profile = safeStorageGet("fokemon_profile", null);
let caught = safeStorageGet("fokemon_caught", []);
const recentEvents = [];
const caughtIds = new Set(caught.map((c) => c.id));
const gridCaughtIds = new Set();
const trainerLocations = new Map();
let playerLocation = null;
let watchId = null;
let feedConnected = false;
let activeChallenge = null;
let currentPlacements = [];
let currentPlacementsKey = null;

let leafletMap = null;
let playerMarker = null;
let catchCircle = null;
const spawnMarkers = new Map();
const trainerMarkers = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad((b.lng ?? b.lon) - (a.lng ?? a.lon));
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function saveLocal() {
  try {
    localStorage.setItem("fokemon_profile", JSON.stringify(profile));
    localStorage.setItem("fokemon_caught", JSON.stringify(caught));
  } catch {
    /* private browsing — in-memory only */
  }
}

function leafletReady() {
  return typeof window !== "undefined" && typeof window.L !== "undefined";
}

function ensureMap() {
  if (leafletMap || !leafletReady() || !el.nearbyMap) return leafletMap;
  const L = window.L;
  leafletMap = L.map(el.nearbyMap, {
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  }).setView([0, 0], 2);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  el.nearbyMap.classList.add("leaflet-active");
  return leafletMap;
}

function placementsKey(lat, lon, bucket) {
  return `${getGridKey(lat, lon)}|${bucket}`;
}

function ensureFreshPlacements() {
  if (!playerLocation) {
    currentPlacements = [];
    currentPlacementsKey = null;
    return;
  }
  const bucket = Math.floor(Date.now() / SPAWN_INTERVAL_MS);
  const key = placementsKey(playerLocation.lat, playerLocation.lng, bucket);
  if (key === currentPlacementsKey) return;

  currentPlacements = computeSpawnPlacements(cards, {
    timeMs: Date.now(),
    lat: playerLocation.lat,
    lon: playerLocation.lng,
    intervalMs: SPAWN_INTERVAL_MS,
    maxSpawns: MAX_SPAWNS,
  });
  currentPlacementsKey = key;
}

function placementCatchable(p) {
  if (!playerLocation || !p) return false;
  return distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }) <= CATCH_RANGE_METERS;
}

function placementStatus(p) {
  if (caughtIds.has(p.card.id)) return "owned";
  if (gridCaughtIds.has(p.card.id)) return "taken";
  return "available";
}

function updateBucketLabel() {
  if (!el.mapBucket) return;
  if (!playerLocation || !currentPlacements.length) {
    el.mapBucket.textContent = "";
    return;
  }
  const expires = (Math.floor(Date.now() / SPAWN_INTERVAL_MS) + 1) * SPAWN_INTERVAL_MS;
  const remainingMs = Math.max(0, expires - Date.now());
  const mm = Math.floor(remainingMs / 60000);
  const ss = Math.floor((remainingMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  el.mapBucket.textContent = `Refresh in ${mm}:${ss}`;
}

function renderCollection() {
  if (!el.caughtCount) return;
  el.caughtCount.textContent = caught.length;
  const unique = [...new Set(caught.map((c) => c.id))];
  el.uniqueCount.textContent = unique.length;
  el.collection.innerHTML = unique
    .map((id) => `<span class="chip">${escapeHtml(cardsById.get(id)?.name || id)}</span>`)
    .join("");
}

function renderFeed() {
  if (!el.feedList) return;
  const ordered = [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, 20);
  el.feedList.innerHTML = ordered
    .map((e) => `<li><strong>${escapeHtml(e.trainer)}</strong> caught ${escapeHtml(e.card)}</li>`)
    .join("");
}

function renderCards() {
  if (!el.cardsList) return;
  ensureFreshPlacements();
  const availablePlacements = currentPlacements.filter(
    (p) => !caughtIds.has(p.card.id) && !gridCaughtIds.has(p.card.id)
  );

  if (!availablePlacements.length) {
    el.cardsList.innerHTML = `<p class="empty-state">No Fokemon nearby right now. Walk around or wait for the next spawn cycle.</p>`;
    return;
  }

  el.cardsList.innerHTML = availablePlacements
    .map((p) => {
      const meters = playerLocation
        ? Math.round(distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }))
        : null;
      const inRange = meters !== null && meters <= CATCH_RANGE_METERS;
      const distLabel = meters === null
        ? "Enable location to see distance"
        : inRange
          ? `In range • ${meters}m`
          : `${meters}m away — walk closer`;
      return `
        <article class="poke-card">
          <strong>${escapeHtml(p.card.name)}</strong>
          <div>${escapeHtml(p.card.type)}</div>
          <small>${distLabel}</small>
          <button data-id="${p.card.id}" ${inRange ? "" : "disabled"}>${inRange ? "Start catch challenge" : "Out of range"}</button>
        </article>
      `;
    })
    .join("");

  el.cardsList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = cardsById.get(btn.dataset.id);
      const placement = currentPlacements.find((p) => p.card.id === btn.dataset.id);
      if (!card || !placement || !placementCatchable(placement)) return;
      launchCatchChallenge(card, placement);
    });
  });
}

function makeSpawnIcon(p) {
  const L = window.L;
  const status = placementStatus(p);
  const meters = playerLocation
    ? Math.round(distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }))
    : null;
  const near = meters !== null && meters <= CATCH_RANGE_METERS ? "near" : "";
  const taken = status === "taken" ? "taken" : "";
  return L.divIcon({
    className: "",
    html: `<div class="spawn-marker ${near} ${taken}"><span>${escapeHtml(p.card.name)}</span>${meters === null ? "" : `<small>${meters}m</small>`}</div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

function makePlayerIcon(label) {
  const L = window.L;
  return L.divIcon({
    className: "",
    html: `<div class="player-marker">${escapeHtml(label)}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function makeTrainerIcon(name) {
  const L = window.L;
  return L.divIcon({
    className: "",
    html: `<div class="trainer-marker">${escapeHtml(String(name).slice(0, 2).toUpperCase())}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function renderMap() {
  if (!el.mapHint) return;

  if (el.mapHint) el.mapHint.classList.toggle("hidden", Boolean(playerLocation));

  if (!playerLocation) {
    spawnMarkers.forEach((m) => m.remove());
    spawnMarkers.clear();
    trainerMarkers.forEach((m) => m.remove());
    trainerMarkers.clear();
    if (playerMarker) {
      playerMarker.remove();
      playerMarker = null;
    }
    if (catchCircle) {
      catchCircle.remove();
      catchCircle = null;
    }
    return;
  }

  const L = window.L;
  if (!L) return;

  const map = ensureMap();
  if (!map) return;
  ensureFreshPlacements();

  const center = [playerLocation.lat, playerLocation.lng];
  if (!playerMarker) {
    playerMarker = L.marker(center, { icon: makePlayerIcon("YOU"), zIndexOffset: 1000 }).addTo(map);
    map.setView(center, 18);
  } else {
    playerMarker.setLatLng(center);
  }

  if (!catchCircle) {
    catchCircle = L.circle(center, {
      radius: CATCH_RANGE_METERS,
      className: "catch-ring",
      color: "#7cf0c6",
      weight: 1,
      opacity: 0.65,
      fillColor: "#7cf0c6",
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    catchCircle.setLatLng(center);
  }

  const wantedKeys = new Set();
  currentPlacements.forEach((p) => {
    const key = `${currentPlacementsKey}|${p.card.id}`;
    wantedKeys.add(key);
    let marker = spawnMarkers.get(key);
    const icon = makeSpawnIcon(p);
    if (!marker) {
      marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.on("click", () => {
        if (caughtIds.has(p.card.id) || gridCaughtIds.has(p.card.id)) return;
        if (!placementCatchable(p)) {
          map.flyTo([p.lat, p.lng], 19, { duration: 0.8 });
          return;
        }
        launchCatchChallenge(p.card, p);
      });
      spawnMarkers.set(key, marker);
    } else {
      marker.setIcon(icon);
      marker.setLatLng([p.lat, p.lng]);
    }
  });
  for (const [key, marker] of spawnMarkers) {
    if (!wantedKeys.has(key)) {
      marker.remove();
      spawnMarkers.delete(key);
    }
  }

  const seenTrainers = new Set();
  for (const [name, pos] of trainerLocations) {
    if (name === profile?.name) continue;
    if (Date.now() - pos.ts > 30 * 60 * 1000) continue;
    seenTrainers.add(name);
    let marker = trainerMarkers.get(name);
    if (!marker) {
      marker = L.marker([pos.lat, pos.lng], { icon: makeTrainerIcon(name) }).addTo(map);
      trainerMarkers.set(name, marker);
    } else {
      marker.setLatLng([pos.lat, pos.lng]);
    }
  }
  for (const [name, marker] of trainerMarkers) {
    if (!seenTrainers.has(name)) {
      marker.remove();
      trainerMarkers.delete(name);
    }
  }
}

function publishGridCatch(card, ts) {
  if (!gridCaughtNode || !playerLocation) return;
  const key = getGridKey(playerLocation.lat, playerLocation.lng);
  if (!key) return;
  gridCaughtNode.get(key).get(card.id).put({ cardId: card.id, ts });
}

function catchCard(card, placement) {
  const event = {
    trainer: profile.name,
    card: card.name,
    ts: Date.now(),
    lat: placement?.lat ?? playerLocation?.lat ?? null,
    lng: placement?.lng ?? playerLocation?.lng ?? null,
  };

  caught.push({ id: card.id, ts: event.ts });
  caughtIds.add(card.id);
  gridCaughtIds.add(card.id);
  saveLocal();
  renderCollection();
  renderCards();
  renderMap();
  eventsNode.set(event);
  publishGridCatch(card, event.ts);
}

function launchCatchChallenge(card, placement) {
  if (activeChallenge) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card" role="dialog" aria-modal="true" aria-label="Catch ${escapeHtml(card.name)}">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${escapeHtml(card.name)}</h3>
      <p>Click the glowing core while it moves. You need 3 hits in 6 seconds.</p>
      <div class="arena">
        <button class="target" aria-label="Catch target"></button>
      </div>
      <p class="status" aria-live="polite">Hits: <strong>0/3</strong> &bull; Time left: <strong>6.0s</strong></p>
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
    target.style.left = `${Math.random() * 75 + 5}%`;
    target.style.top = `${Math.random() * 70 + 8}%`;
  }

  function closeChallenge() {
    challenge.remove();
    activeChallenge = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) {
    if (ev.key === "Escape") {
      clearInterval(mover);
      closeChallenge();
    }
  }
  document.addEventListener("keydown", onKey);

  function updateStatus(timeLeftMs) {
    status.innerHTML = `Hits: <strong>${hits}/${totalHits}</strong> &bull; Time left: <strong>${(timeLeftMs / 1000).toFixed(1)}s</strong>`;
  }

  function tick() {
    const elapsed = performance.now() - started;
    const left = Math.max(0, duration - elapsed);
    updateStatus(left);
    if (left <= 0) {
      status.innerHTML = `<span class="fail">escaped!</span> ${escapeHtml(card.name)} slipped away.`;
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
      status.innerHTML = `<span class="success">Captured!</span> ${escapeHtml(card.name)} joined your collection.`;
      catchCard(card, placement);
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

function updateLocationStatus(text) {
  if (el.locationStatus) el.locationStatus.textContent = text;
}

function onPositionUpdate(pos) {
  playerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  updateLocationStatus(`Live • ${playerLocation.lat.toFixed(5)}, ${playerLocation.lng.toFixed(5)}`);
  connectGridCaught();
  ensureFreshPlacements();
  renderMap();
  renderCards();
  updateBucketLabel();
}

function startLocationTracking() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    updateLocationStatus("Geolocation unavailable in this browser.");
    return;
  }
  updateLocationStatus("Requesting location…");

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    (err) => {
      if (err && err.code === 1) {
        updateLocationStatus("Location permission denied. Enable it in browser settings.");
      } else {
        updateLocationStatus("Location unavailable. Try again outdoors.");
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function connectFeed() {
  if (feedConnected) return;
  feedConnected = true;

  eventsNode.map().on((event) => {
    if (!event || !event.ts || !event.trainer || !event.card) return;
    const alreadyThere = recentEvents.some(
      (e) => e.ts === event.ts && e.trainer === event.trainer && e.card === event.card
    );
    if (alreadyThere) return;
    recentEvents.push(event);
    if (event.lat && event.lng && event.trainer !== profile?.name) {
      trainerLocations.set(event.trainer, { lat: event.lat, lng: event.lng, ts: event.ts });
    }
    if (recentEvents.length > 100) recentEvents.shift();
    renderFeed();
    renderMap();
  });
}

function connectGridCaught() {
  if (!gridCaughtNode || !playerLocation) return;
  const key = getGridKey(playerLocation.lat, playerLocation.lng);
  if (!key) return;
  if (key === lastGridKey) return;
  if (lastGridKey) {
    try { gridCaughtNode.get(lastGridKey).off(); } catch {}
  }
  gridCaughtIds.clear();
  lastGridKey = key;
  gridCaughtNode.get(key).map().on((entry) => {
    if (!entry?.cardId) return;
    if (caughtIds.has(entry.cardId)) return;
    if (!gridCaughtIds.has(entry.cardId)) {
      gridCaughtIds.add(entry.cardId);
      renderCards();
      renderMap();
    }
  });
}

function initGun() {
  if (typeof window === "undefined" || typeof window.Gun !== "function") return;
  try {
    const gun = window.Gun({ peers: GUN_PEERS, localStorage: true });
    const root = gun.get("fokemon");
    eventsNode = root.get("events");
    gridCaughtNode = root.get("caughtByGrid");
    connectFeed();
    connectGridCaught();
  } catch {
    eventsNode = FALLBACK_EVENTS_NODE;
  }
}

function enterGame() {
  if (!el.auth || !el.game) return;
  el.auth.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.welcome.textContent = `Welcome, ${profile.name}`;
  document.documentElement.style.setProperty(
    "--accent",
    profile.team === "violet" ? "#ca90ff" : profile.team === "sun" ? "#ffd173" : "#7cf0c6"
  );
  ensureMap();
  ensureFreshPlacements();
  renderCards();
  renderMap();
  renderCollection();
  connectFeed();
  updateBucketLabel();
}

if (el.form) {
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) return;
    profile = { name, team: el.team.value };
    saveLocal();
    enterGame();
    startLocationTracking();
  });
}

if (el.reset) {
  el.reset.addEventListener("click", () => {
    try { localStorage.removeItem("fokemon_profile"); } catch {}
    location.reload();
  });
}

if (el.enableLocation) {
  el.enableLocation.addEventListener("click", startLocationTracking);
}

initGun();

if (profile?.name) enterGame();

if (typeof setInterval === "function") {
  setInterval(() => {
    const prevKey = currentPlacementsKey;
    ensureFreshPlacements();
    if (prevKey !== currentPlacementsKey) {
      gridCaughtIds.clear();
      renderCards();
      renderMap();
    }
    updateBucketLabel();
  }, 1000);
}
