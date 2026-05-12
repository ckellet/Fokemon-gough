import {
  computePoiPlacements,
  computeSpawnPlacements,
  filterUncaughtSpawns,
  getGridKey,
  isPoiAvailable,
  POI_COOLDOWN_MS,
  SPAWN_CELL_DEGREES,
} from "./app.logic.js";

const SPAWN_INTERVAL_MS = 3 * 60 * 1000;
const MAX_SPAWNS = 4;
const CATCH_RANGE_METERS = 80;
const POI_RANGE_METERS = CATCH_RANGE_METERS;
const STARTING_FOKEBALLS = 5;
const MAX_POI_REWARD = 8;
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
  { id: "voltlynx", name: "VoltLynx", type: "Electric", rarity: "rare",
    body: "tall", ears: "pointy", accent: "lightning",
    hp: 58, atk: 72, def: 44, spd: 88,
    flavor: "Skittish hunter with arc-static fur. Sparks when surprised." },
  { id: "mossaur", name: "Mossaur", type: "Leaf", rarity: "common",
    body: "wide", ears: "horn", accent: "leaf",
    hp: 84, atk: 56, def: 70, spd: 38,
    flavor: "Grazes in tall meadows; sheds fresh sprouts each dawn." },
  { id: "aquaphin", name: "AquaPhin", type: "Water", rarity: "common",
    body: "round", ears: "fin", accent: "droplet",
    hp: 64, atk: 60, def: 58, spd: 70,
    flavor: "Surfs warm rain currents above the asphalt." },
  { id: "emberoo", name: "Emberoo", type: "Fire", rarity: "rare",
    body: "round", ears: "pointy", accent: "flame",
    hp: 54, atk: 80, def: 40, spd: 78,
    flavor: "Hops between sun-baked rooftops, leaving scorch prints." },
  { id: "cryptowl", name: "CryptOwl", type: "Shadow", rarity: "epic",
    body: "tall", ears: "horn", accent: "ghost",
    hp: 50, atk: 86, def: 46, spd: 76,
    flavor: "Stares from places no light is meant to reach." },
  { id: "frostbun", name: "Frostbun", type: "Ice", rarity: "common",
    body: "round", ears: "round", accent: "snowflake",
    hp: 66, atk: 50, def: 70, spd: 60,
    flavor: "Wrapped in a perpetual chilly fog that smells of mint." },
  { id: "gustling", name: "Gustling", type: "Wind", rarity: "rare",
    body: "blob", ears: "antenna", accent: "swirl",
    hp: 48, atk: 64, def: 38, spd: 98,
    flavor: "Zips through alleyways riding the breeze it brewed itself." },
  { id: "pebbloid", name: "Pebbloid", type: "Rock", rarity: "common",
    body: "wide", ears: "none", accent: "pebble",
    hp: 96, atk: 60, def: 92, spd: 26,
    flavor: "Slow but stubbornly unmovable. Disguises itself as scenery." },
  { id: "nebulime", name: "Nebulime", type: "Cosmic", rarity: "epic",
    body: "round", ears: "antenna", accent: "star",
    hp: 60, atk: 78, def: 54, spd: 74,
    flavor: "A whisper of starlight wearing fur. Hums at 432Hz." },
  { id: "spectrip", name: "Spectrip", type: "Spirit", rarity: "rare",
    body: "tall", ears: "none", accent: "ghost",
    hp: 56, atk: 70, def: 50, spd: 72,
    flavor: "Drifts past clocks that have started running slow." },
  { id: "buzzwick", name: "Buzzwick", type: "Bug", rarity: "common",
    body: "round", ears: "antenna", accent: "sparkle",
    hp: 52, atk: 66, def: 44, spd: 86,
    flavor: "Carries embers between flowers without scorching a petal." },
  { id: "chromite", name: "Chromite", type: "Metal", rarity: "epic",
    body: "wide", ears: "horn", accent: "gear",
    hp: 84, atk: 72, def: 96, spd: 38,
    flavor: "A polished little tank with a surprisingly gentle hum." },
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
  locationModal: $("locationModal"),
  modalLocationHelp: $("modalLocationHelp"),
  ballChip: $("ballChip"),
  ballCount: $("ballCount"),
};

let locationGranted = false;

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
let fokeBalls = safeStorageGet("fokemon_balls", STARTING_FOKEBALLS);
if (!Number.isFinite(fokeBalls) || fokeBalls < 0) fokeBalls = STARTING_FOKEBALLS;
const poiSpent = safeStorageGet("fokemon_poi_spent", {}) || {};
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
let currentPois = [];
let currentPoisCellKey = null;

let leafletMap = null;
let playerMarker = null;
let catchCircle = null;
const spawnMarkers = new Map();
const trainerMarkers = new Map();
const poiMarkers = new Map();

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
    localStorage.setItem("fokemon_balls", JSON.stringify(fokeBalls));
    localStorage.setItem("fokemon_poi_spent", JSON.stringify(poiSpent));
  } catch {
    /* private browsing — in-memory only */
  }
}

function renderBallCount() {
  if (el.ballCount) el.ballCount.textContent = fokeBalls;
  if (el.ballChip) el.ballChip.classList.toggle("empty", fokeBalls <= 0);
}

function addFokeBalls(n) {
  fokeBalls = Math.max(0, fokeBalls + n);
  saveLocal();
  renderBallCount();
  renderCards();
}

function consumeFokeBall() {
  if (fokeBalls <= 0) return false;
  fokeBalls -= 1;
  saveLocal();
  renderBallCount();
  renderCards();
  return true;
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
    scrollWheelZoom: false,
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
    currentPois = [];
    currentPoisCellKey = null;
    return;
  }
  const bucket = Math.floor(Date.now() / SPAWN_INTERVAL_MS);
  const key = placementsKey(playerLocation.lat, playerLocation.lng, bucket);
  if (key !== currentPlacementsKey) {
    currentPlacements = computeSpawnPlacements(cards, {
      timeMs: Date.now(),
      lat: playerLocation.lat,
      lon: playerLocation.lng,
      intervalMs: SPAWN_INTERVAL_MS,
      maxSpawns: MAX_SPAWNS,
    });
    currentPlacementsKey = key;
  }

  const gridKey = getGridKey(playerLocation.lat, playerLocation.lng);
  if (gridKey !== currentPoisCellKey) {
    currentPois = computePoiPlacements(playerLocation.lat, playerLocation.lng, {
      neighborhoodCells: 1,
    });
    currentPoisCellKey = gridKey;
  }
}

function poiCatchable(poi) {
  if (!playerLocation || !poi) return false;
  if (!isPoiAvailable(poi, poiSpent)) return false;
  return distanceMeters(playerLocation, { lat: poi.lat, lng: poi.lng }) <= POI_RANGE_METERS;
}

function poiCooldownRemaining(poi) {
  const spent = poiSpent[poi.id];
  if (!spent) return 0;
  return Math.max(0, POI_COOLDOWN_MS - (Date.now() - spent));
}

function poiIconSignature(poi) {
  const available = isPoiAvailable(poi, poiSpent);
  const meters = playerLocation
    ? Math.round(distanceMeters(playerLocation, { lat: poi.lat, lng: poi.lng }))
    : null;
  const near = available && meters !== null && meters <= POI_RANGE_METERS;
  let label = "FokéCache";
  if (!available) {
    const remainingMs = poiCooldownRemaining(poi);
    const mm = Math.floor(remainingMs / 60000);
    const ss = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, "0");
    label = `Refilling ${mm}:${ss}`;
  }
  return { available, near, label, sig: `${available ? "ok" : "cd"}|${near ? "near" : "far"}|${label}` };
}

function makePoiIcon(info) {
  const L = window.L;
  const state = info.available ? "" : "cooldown";
  const near = info.near ? "near" : "";
  return L.divIcon({
    className: "",
    html: `<div class="poi-marker ${state} ${near}"><span class="poi-ball" aria-hidden="true"></span><small>${escapeHtml(info.label)}</small></div>`,
    iconSize: [54, 64],
    iconAnchor: [27, 64],
  });
}

function placementCatchable(p) {
  if (!playerLocation || !p) return false;
  return distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }) <= CATCH_RANGE_METERS;
}

function placementStatus(p) {
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

function statBars(card) {
  const stats = [
    ["HP", card.hp ?? 0, 120],
    ["ATK", card.atk ?? 0, 100],
    ["DEF", card.def ?? 0, 100],
    ["SPD", card.spd ?? 0, 100],
  ];
  return `
    <ul class="stats-list">
      ${stats
        .map(
          ([label, val, max]) => `
        <li>
          <span class="stat-label">${label}</span>
          <span class="stat-bar"><span class="stat-fill" style="width:${Math.max(4, Math.min(100, (val / max) * 100))}%"></span></span>
          <span class="stat-val">${val}</span>
        </li>`
        )
        .join("")}
    </ul>
  `;
}

function renderCollection() {
  if (!el.caughtCount) return;
  el.caughtCount.textContent = caught.length;
  const counts = new Map();
  for (const c of caught) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  el.uniqueCount.textContent = counts.size;

  if (!counts.size) {
    el.collection.innerHTML = `<p class="empty-state">Catch a Fokemon to start your dex — each unique one flips to reveal stats.</p>`;
    return;
  }

  const entries = [...counts].sort((a, b) => b[1] - a[1]);
  el.collection.innerHTML = entries
    .map(([id, n]) => {
      const card = cardsById.get(id);
      if (!card) return "";
      const colors = colorsFor(card);
      return `
        <div class="gallery-card" data-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Flip ${escapeHtml(card.name)} card">
          <div class="flipper">
            <div class="face front">
              <span class="count-pill" aria-label="Caught ${n} times">&times;${n}</span>
              <canvas class="gallery-art" width="160" height="120" aria-hidden="true"></canvas>
              <div class="gallery-meta">
                <strong>${escapeHtml(card.name)}</strong>
                <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
              </div>
              <span class="flip-hint">Tap for stats</span>
            </div>
            <div class="face back">
              <header>
                <strong>${escapeHtml(card.name)}</strong>
                <p class="rarity ${escapeHtml(card.rarity || "common")}">${escapeHtml(card.rarity || "common")} &bull; ${escapeHtml(card.type)}</p>
              </header>
              ${statBars(card)}
              <p class="flavor">${escapeHtml(card.flavor || "")}</p>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  el.collection.querySelectorAll(".gallery-card").forEach((node) => {
    const id = node.dataset.id;
    const card = cardsById.get(id);
    const canvas = node.querySelector(".gallery-art");
    if (canvas && card) renderPortrait(canvas, card);
    const toggle = () => node.classList.toggle("flipped");
    node.addEventListener("click", toggle);
    node.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggle();
      }
    });
  });
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
    (p) => !gridCaughtIds.has(p.card.id)
  );

  if (!availablePlacements.length) {
    el.cardsList.innerHTML = `<p class="empty-state">No Fokemon nearby right now. Walk around or wait for the next spawn cycle.</p>`;
    return;
  }

  const hasBalls = fokeBalls > 0;
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
      const canCatch = inRange && hasBalls;
      const buttonLabel = !inRange
        ? "Out of range"
        : !hasBalls
          ? "Need FokéBalls"
          : "Start catch challenge";
      return `
        <article class="poke-card">
          <strong>${escapeHtml(p.card.name)}</strong>
          <div>${escapeHtml(p.card.type)}</div>
          <small>${distLabel}</small>
          <button data-id="${p.card.id}" ${canCatch ? "" : "disabled"}>${buttonLabel}</button>
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

function flashEmptyInventory() {
  if (!el.ballChip) return;
  el.ballChip.classList.remove("flash");
  void el.ballChip.offsetWidth;
  el.ballChip.classList.add("flash");
  setTimeout(() => el.ballChip && el.ballChip.classList.remove("flash"), 700);
}

function makeSpawnIcon(p) {
  const L = window.L;
  const meters = playerLocation
    ? Math.round(distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }))
    : null;
  const near = meters !== null && meters <= CATCH_RANGE_METERS ? "near" : "";
  const colors = colorsFor(p.card);
  const style = `--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};`;
  return L.divIcon({
    className: "",
    html: `<div class="spawn-marker ${near}" style="${style}"><span>${escapeHtml(p.card.name)}</span>${meters === null ? "" : `<small>${meters}m</small>`}</div>`,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
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
    poiMarkers.forEach((m) => m.remove());
    poiMarkers.clear();
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
  const visiblePlacements = currentPlacements.filter((p) => !gridCaughtIds.has(p.card.id));
  visiblePlacements.forEach((p) => {
    const key = `${currentPlacementsKey}|${p.card.id}`;
    wantedKeys.add(key);
    let marker = spawnMarkers.get(key);
    const icon = makeSpawnIcon(p);
    if (!marker) {
      marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.on("click", () => {
        if (gridCaughtIds.has(p.card.id)) return;
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

  const wantedPoiKeys = new Set();
  currentPois.forEach((poi) => {
    wantedPoiKeys.add(poi.id);
    const info = poiIconSignature(poi);
    let marker = poiMarkers.get(poi.id);
    const onPoiClick = () => {
      if (!isPoiAvailable(poi, poiSpent)) {
        map.flyTo([poi.lat, poi.lng], 19, { duration: 0.8 });
        return;
      }
      if (!poiCatchable(poi)) {
        map.flyTo([poi.lat, poi.lng], 19, { duration: 0.8 });
        return;
      }
      launchPoiSpinner(poi);
    };
    if (!marker) {
      marker = L.marker([poi.lat, poi.lng], { icon: makePoiIcon(info) }).addTo(map);
      marker._poiSig = info.sig;
      marker.on("click", onPoiClick);
      poiMarkers.set(poi.id, marker);
    } else if (marker._poiSig !== info.sig) {
      marker.setIcon(makePoiIcon(info));
      marker._poiSig = info.sig;
    }
  });
  for (const [key, marker] of poiMarkers) {
    if (!wantedPoiKeys.has(key)) {
      marker.remove();
      poiMarkers.delete(key);
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

function currentGridBucketKey() {
  if (!playerLocation) return null;
  const grid = getGridKey(playerLocation.lat, playerLocation.lng);
  if (!grid) return null;
  const bucket = Math.floor(Date.now() / SPAWN_INTERVAL_MS);
  return `${grid}|${bucket}`;
}

function publishGridCatch(card, ts) {
  if (!gridCaughtNode || !playerLocation) return;
  const key = currentGridBucketKey();
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

const TYPE_COLORS = {
  Electric: { light: "#fff48a", dark: "#c98a14", accent: "#ffd966" },
  Leaf:     { light: "#9cf6a8", dark: "#1f7a3a", accent: "#5ed27a" },
  Water:    { light: "#9fdaff", dark: "#1d63b8", accent: "#4ea9ff" },
  Fire:     { light: "#ffb185", dark: "#c43a18", accent: "#ff7a3a" },
  Shadow:   { light: "#b9a2ff", dark: "#3d2778", accent: "#8a6cff" },
  Ice:      { light: "#d6f4ff", dark: "#2c6f9a", accent: "#7fd8f3" },
  Wind:     { light: "#e2f6e8", dark: "#3a7768", accent: "#8ce4c4" },
  Rock:     { light: "#d8c8a8", dark: "#6e553a", accent: "#a8825e" },
  Cosmic:   { light: "#e0c8ff", dark: "#3f1f6d", accent: "#a878ff" },
  Spirit:   { light: "#cfe1ff", dark: "#4a3a78", accent: "#7c8dff" },
  Bug:      { light: "#d4f0a8", dark: "#5a7820", accent: "#9ec74e" },
  Metal:    { light: "#dde4ee", dark: "#4d5a6a", accent: "#9aaabd" },
};

function colorsFor(card) {
  return TYPE_COLORS[card.type] || { light: "#cfd8ff", dark: "#3d4d8a", accent: "#7c8dff" };
}

function drawStar(ctx, cx, cy, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawCreatureBody(ctx, shape, r, colors) {
  const grad = ctx.createRadialGradient(-r * 0.32, -r * 0.4, r * 0.12, 0, 0, r * 1.05);
  grad.addColorStop(0, colors.light);
  grad.addColorStop(1, colors.dark);
  ctx.fillStyle = grad;
  ctx.strokeStyle = "rgba(7, 13, 28, 0.55)";
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath();
  if (shape === "tall") {
    ctx.ellipse(0, 0, r * 0.78, r * 1.08, 0, 0, Math.PI * 2);
  } else if (shape === "wide") {
    ctx.ellipse(0, 0, r * 1.12, r * 0.78, 0, 0, Math.PI * 2);
  } else if (shape === "blob") {
    const points = 14;
    for (let i = 0; i <= points; i++) {
      const ang = (i / points) * Math.PI * 2;
      const wob = 1 + Math.sin(ang * 3) * 0.09 + Math.cos(ang * 2) * 0.05;
      const x = Math.cos(ang) * r * wob;
      const y = Math.sin(ang) * r * wob;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
}

function drawCreatureEars(ctx, kind, r, colors) {
  ctx.strokeStyle = "rgba(7, 13, 28, 0.45)";
  ctx.lineWidth = Math.max(1, r * 0.035);

  if (kind === "pointy") {
    ctx.fillStyle = colors.dark;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.45, -r * 0.55);
      ctx.lineTo(side * r * 0.18, -r * 1.25);
      ctx.lineTo(side * r * 0.7, -r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "round") {
    ctx.fillStyle = colors.dark;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.arc(side * r * 0.55, -r * 0.85, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "fin") {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, -r * 0.95);
    ctx.lineTo(r * 0.25, -r * 1.35);
    ctx.lineTo(r * 0.4, -r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.88, -r * 0.05);
      ctx.lineTo(side * r * 1.2, r * 0.25);
      ctx.lineTo(side * r * 0.65, r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "horn") {
    ctx.fillStyle = colors.accent;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.32, -r * 0.7);
      ctx.lineTo(side * r * 0.6, -r * 1.2);
      ctx.lineTo(side * r * 0.15, -r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "antenna") {
    [-1, 1].forEach((side) => {
      ctx.strokeStyle = colors.dark;
      ctx.lineWidth = Math.max(1.4, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(side * r * 0.22, -r * 0.85);
      ctx.quadraticCurveTo(side * r * 0.55, -r * 1.45, side * r * 0.78, -r * 1.2);
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(side * r * 0.78, -r * 1.2, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawCreatureEyes(ctx, shape, r) {
  const yOff = shape === "tall" ? -r * 0.05 : -r * 0.12;
  const xOff = shape === "wide" ? r * 0.42 : shape === "tall" ? r * 0.28 : r * 0.32;
  ctx.fillStyle = "#0b1226";
  ctx.beginPath();
  ctx.arc(-xOff, yOff, r * 0.12, 0, Math.PI * 2);
  ctx.arc(xOff, yOff, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-xOff + r * 0.05, yOff - r * 0.05, r * 0.045, 0, Math.PI * 2);
  ctx.arc(xOff + r * 0.05, yOff - r * 0.05, r * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // little smile
  ctx.strokeStyle = "rgba(7, 13, 28, 0.65)";
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath();
  ctx.arc(0, yOff + r * 0.35, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function drawCreatureAccent(ctx, kind, r, colors) {
  ctx.save();
  ctx.translate(0, r * 0.32);
  const s = r * 0.42;
  ctx.fillStyle = colors.accent;
  ctx.strokeStyle = "rgba(7, 13, 28, 0.5)";
  ctx.lineWidth = Math.max(0.8, r * 0.03);

  if (kind === "lightning") {
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.6);
    ctx.lineTo(s * 0.18, -s * 0.05);
    ctx.lineTo(-s * 0.05, -s * 0.05);
    ctx.lineTo(s * 0.22, s * 0.65);
    ctx.lineTo(-s * 0.05, s * 0.12);
    ctx.lineTo(s * 0.1, s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "leaf") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.6);
    ctx.quadraticCurveTo(s * 0.55, -s * 0.15, 0, s * 0.55);
    ctx.quadraticCurveTo(-s * 0.55, -s * 0.15, 0, -s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = colors.dark;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.lineTo(0, s * 0.5);
    ctx.stroke();
  } else if (kind === "droplet") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.6);
    ctx.quadraticCurveTo(s * 0.5, 0, 0, s * 0.5);
    ctx.quadraticCurveTo(-s * 0.5, 0, 0, -s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "flame") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.quadraticCurveTo(s * 0.55, -s * 0.05, s * 0.22, s * 0.5);
    ctx.quadraticCurveTo(0, s * 0.18, -s * 0.22, s * 0.5);
    ctx.quadraticCurveTo(-s * 0.55, -s * 0.05, 0, -s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "star") {
    drawStar(ctx, 0, 0, 5, s * 0.6, s * 0.28);
    ctx.fill();
    ctx.stroke();
  } else if (kind === "snowflake") {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(1.2, r * 0.05);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const ex = Math.cos(ang) * s * 0.55;
      const ey = Math.sin(ang) * s * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const bx = ex * 0.65;
      const by = ey * 0.65;
      const px = Math.cos(ang + Math.PI / 2) * s * 0.14;
      const py = Math.sin(ang + Math.PI / 2) * s * 0.14;
      ctx.beginPath();
      ctx.moveTo(bx - px, by - py);
      ctx.lineTo(bx + px, by + py);
      ctx.stroke();
    }
  } else if (kind === "swirl") {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.beginPath();
    for (let i = 0; i < 100; i++) {
      const a = i * 0.2;
      const rad = i * 0.013 * s;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === "pebble") {
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5, s * 0.32, Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.12, -s * 0.1, s * 0.12, s * 0.06, -Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "ghost") {
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, Math.PI, 0);
    ctx.lineTo(s * 0.42, s * 0.35);
    ctx.lineTo(s * 0.22, s * 0.18);
    ctx.lineTo(0, s * 0.4);
    ctx.lineTo(-s * 0.22, s * 0.18);
    ctx.lineTo(-s * 0.42, s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colors.dark;
    ctx.stroke();
  } else if (kind === "sparkle") {
    for (const [dx, dy, size] of [
      [0, 0, s * 0.4],
      [s * 0.6, -s * 0.2, s * 0.18],
      [-s * 0.6, s * 0.2, s * 0.18],
    ]) {
      drawStar(ctx, dx, dy, 4, size, size * 0.4);
      ctx.fill();
    }
  } else if (kind === "gear") {
    const teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const ang = (i / (teeth * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? s * 0.55 : s * 0.38;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(7, 13, 28, 0.65)";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCreature(ctx, card, cx, cy, r) {
  const colors = colorsFor(card);
  ctx.save();
  ctx.translate(cx, cy);
  drawCreatureEars(ctx, card.ears || "round", r, colors);
  drawCreatureBody(ctx, card.body || "round", r, colors);
  drawCreatureEyes(ctx, card.body || "round", r);
  drawCreatureAccent(ctx, card.accent || "sparkle", r, colors);
  ctx.restore();
}

function renderPortrait(canvas, card) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || parseInt(canvas.getAttribute("width") || "120", 10);
  const h = canvas.clientHeight || parseInt(canvas.getAttribute("height") || "100", 10);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const colors = colorsFor(card);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(255,255,255,0.05)");
  bg.addColorStop(1, `rgba(${hexInt(colors.dark, 0)}, ${hexInt(colors.dark, 1)}, ${hexInt(colors.dark, 2)}, 0.4)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  drawCreature(ctx, card, w / 2, h * 0.6, Math.min(w, h) * 0.32);
}

function hexInt(hex, channel) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 60;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255][channel];
}

function launchCatchChallenge(card, placement) {
  if (activeChallenge) return;
  if (fokeBalls <= 0) {
    flashEmptyInventory();
    return;
  }

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card" role="dialog" aria-modal="true" aria-label="Catch ${escapeHtml(card.name)}">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${escapeHtml(card.name)}</h3>
      <p>Pull back the FokéBall, aim with the dotted path, and release to fling it.</p>
      <div class="arena">
        <canvas class="catch-canvas" aria-label="FokéBall slingshot arena"></canvas>
      </div>
      <p class="status" aria-live="polite">FokéBalls: <strong>${fokeBalls}</strong> &bull; Drag the ball to aim</p>
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

  let aiming = null;
  let projectile = null;
  let finished = false;
  let outcome = null;
  let netSpin = 0;
  let dodgeArmed = false;
  let dodgeTriggered = false;

  function statusText() {
    if (finished && outcome === "caught") return `<span class="success">Captured!</span> ${escapeHtml(card.name)} joined your collection.`;
    if (finished && outcome === "escaped") return `<span class="fail">Out of FokéBalls!</span> ${escapeHtml(card.name)} got away.`;
    if (finished && outcome === "fled") return `<span class="fail">Escaped!</span> ${escapeHtml(card.name)} bolted off.`;
    if (aiming) return `FokéBalls: <strong>${fokeBalls}</strong> &bull; Release to fire!`;
    if (projectile) return `FokéBalls: <strong>${fokeBalls}</strong> &bull; Ball in flight…`;
    if (fokeBalls <= 0) return `<span class="fail">Out of FokéBalls!</span> Spin a FokéCache to refill.`;
    return `FokéBalls: <strong>${fokeBalls}</strong> &bull; Drag the ball to aim`;
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
    if (finished || projectile || fokeBalls <= 0) return;
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
    if (!consumeFokeBall()) {
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
            catchCard(card, placement);
            setTimeout(closeChallenge, 700);
          }, 700);
          return;
        }
      }

      const offscreen = projectile.x < -40 || projectile.x > W + 40 || projectile.y > FLOOR_Y + NET_RADIUS;
      if (offscreen) {
        projectile = null;
        if (!fokemon.caught) {
          hopFokemon();
          fokemon.hopCooldown = 2.6;
        }
        if (fokeBalls <= 0) {
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
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(leftTop.x, leftTop.y);
      ctx.quadraticCurveTo(ANCHOR.x, ANCHOR.y - 8, rightTop.x, rightTop.y);
      ctx.stroke();
    } else {
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

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(fokemon.x, FLOOR_Y - 2, r * 0.78, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    drawCreature(ctx, card, fokemon.x, bobY, r);

    if (!fokemon.caught) {
      ctx.font = "600 12px Outfit, sans-serif";
      ctx.fillStyle = "rgba(245, 247, 255, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(card.name, fokemon.x, bobY - r - 14);
    }
  }

  function drawNet(pos, rotate) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (rotate) ctx.rotate(netSpin);

    const r = NET_RADIUS;
    const topGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, -r * 0.1, r);
    topGrad.addColorStop(0, "#ff8d9e");
    topGrad.addColorStop(1, "#c93650");
    ctx.fillStyle = topGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();

    const botGrad = ctx.createRadialGradient(-r * 0.3, r * 0.3, r * 0.15, 0, r * 0.1, r);
    botGrad.addColorStop(0, "#ffffff");
    botGrad.addColorStop(1, "#cdd3e2");
    ctx.fillStyle = botGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#0b1226";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#f5f7ff";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#0b1226";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
    ctx.fill();

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
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) {
    if (ev.key === "Escape") closeChallenge();
  }
  document.addEventListener("keydown", onKey);

  cancel.addEventListener("click", closeChallenge);

  setStatus();
  rafId = requestAnimationFrame(loop);
}

function launchPoiSpinner(poi) {
  if (activeChallenge) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge spin-challenge";
  challenge.innerHTML = `
    <div class="challenge-card" role="dialog" aria-modal="true" aria-label="Spin the FokéCache">
      <p class="eyebrow">FokéCache</p>
      <h3>Spin to collect FokéBalls</h3>
      <p>Flick the dial — drag tangentially or click the rim to push. Keep it spinning above the speed line; each full rotation drops a FokéBall.</p>
      <div class="arena spin-arena">
        <canvas class="spin-canvas" aria-label="FokéCache spinner"></canvas>
        <div class="spin-readout">
          <div class="readout-row"><span class="readout-label">Picked up</span><span class="readout-balls">0</span></div>
          <div class="readout-row small"><span class="readout-label">Bag</span><span class="readout-bag">${fokeBalls}</span></div>
        </div>
      </div>
      <p class="status" aria-live="polite">Drag tangent to spin. Get it above the speed line to collect.</p>
      <button class="ghost cancel">Done</button>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const canvas = challenge.querySelector(".spin-canvas");
  const arena = challenge.querySelector(".spin-arena");
  const status = challenge.querySelector(".status");
  const cancel = challenge.querySelector(".cancel");
  const readoutBalls = challenge.querySelector(".readout-balls");
  const readoutBag = challenge.querySelector(".readout-bag");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = arena.getBoundingClientRect();
  const W = Math.max(320, Math.floor(rect.width));
  const H = Math.max(280, Math.floor(rect.height));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const CX = W / 2;
  const CY = H / 2;
  const R = Math.min(W, H) * 0.42;
  const HANDLE_R = R * 0.18;
  const HANDLE_DIST = R * 0.74;

  const THRESHOLD = 7.2;
  const MAX_OMEGA = 28;
  const DAMPING = 0.65;
  const TAP_IMPULSE = 1.6;

  let theta = 0;
  let omega = 0;
  let dragging = false;
  let lastAngle = 0;
  let lastTime = 0;
  let strokeTangentialAccum = 0;
  let collected = 0;
  let revAccum = 0;
  let aboveSince = 0;
  let lastPointerMoved = false;
  let bursts = [];
  let stopped = false;

  function setStatus(html) {
    if (html !== undefined) status.innerHTML = html;
    else {
      const speed = Math.abs(omega);
      const pct = Math.min(1, speed / THRESHOLD);
      if (collected >= MAX_POI_REWARD) {
        status.innerHTML = `<span class="success">Cache emptied!</span> +${collected} FokéBalls — nice spin.`;
      } else if (speed >= THRESHOLD) {
        status.innerHTML = `<strong>Locked in!</strong> Keep her spinning…`;
      } else if (collected > 0) {
        status.innerHTML = `Speed ${(pct * 100).toFixed(0)}% — back up to the line.`;
      } else {
        status.innerHTML = `Flick tangentially. Get above the speed line.`;
      }
    }
  }

  function getPointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pushBurst() {
    bursts.push({ t: 0, life: 0.8 });
  }

  function awardBall() {
    if (collected >= MAX_POI_REWARD) return;
    collected += 1;
    addFokeBalls(1);
    pushBurst();
    if (readoutBalls) readoutBalls.textContent = String(collected);
    if (readoutBag) readoutBag.textContent = String(fokeBalls);
    if (collected >= MAX_POI_REWARD) {
      // Cache fully drained — mark spent now.
      finalizeSpent();
      setStatus();
    }
  }

  function finalizeSpent() {
    if (stopped) return;
    stopped = true;
    poiSpent[poi.id] = Date.now();
    saveLocal();
    renderMap();
  }

  function onDown(e) {
    if (stopped) return;
    const p = getPointer(e);
    const dx = p.x - CX;
    const dy = p.y - CY;
    const dist = Math.hypot(dx, dy);
    if (dist > R + 12) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    lastAngle = Math.atan2(dy, dx);
    lastTime = performance.now();
    strokeTangentialAccum = 0;
    lastPointerMoved = false;
  }

  function onMove(e) {
    if (!dragging || stopped) return;
    const p = getPointer(e);
    const dx = p.x - CX;
    const dy = p.y - CY;
    const dist = Math.hypot(dx, dy);
    if (dist < R * 0.18) {
      lastAngle = Math.atan2(dy, dx);
      return;
    }
    e.preventDefault();
    const angle = Math.atan2(dy, dx);
    let delta = angle - lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    else if (delta < -Math.PI) delta += Math.PI * 2;
    const now = performance.now();
    const dt = Math.max(0.004, (now - lastTime) / 1000);
    const instantOmega = delta / dt;
    // Inertial transfer — wheel feels heavy, doesn't snap to cursor instantly.
    const blend = Math.min(1, dt * 5.2);
    omega += (instantOmega - omega) * blend;
    omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, omega));
    strokeTangentialAccum += Math.abs(delta);
    lastAngle = angle;
    lastTime = now;
    lastPointerMoved = true;
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    // Tap (no drag) → small directional impulse, helps clicky cadence.
    if (!lastPointerMoved && !stopped) {
      const p = getPointer(e);
      const dx = p.x - CX;
      const dy = p.y - CY;
      const r = Math.hypot(dx, dy);
      if (r > R * 0.2 && r < R + 12) {
        // Tangent CCW direction
        const tx = -dy / r;
        const ty = dx / r;
        // Push in current spin direction if any, else default CCW.
        const sign = Math.abs(omega) > 0.2 ? Math.sign(omega) : 1;
        // Visual cue + impulse magnitude
        const impulse = TAP_IMPULSE;
        omega += sign * impulse;
        omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, omega));
        // Ignore tx/ty—just sign-based scalar impulse keeps things simple.
        void tx; void ty;
      }
    }
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  let last = performance.now();
  let raf = 0;
  function loop(now) {
    if (!document.body.contains(challenge)) return;
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function step(dt) {
    if (!dragging) {
      theta += omega * dt;
      omega -= omega * DAMPING * dt;
      if (Math.abs(omega) < 0.04) omega = 0;
    } else {
      theta += omega * dt;
    }
    const absO = Math.abs(omega);
    if (absO >= THRESHOLD && collected < MAX_POI_REWARD) {
      revAccum += absO * dt;
      aboveSince += dt;
      while (revAccum >= Math.PI * 2 && collected < MAX_POI_REWARD) {
        revAccum -= Math.PI * 2;
        awardBall();
      }
    } else {
      revAccum = Math.max(0, revAccum - dt * Math.PI);
      aboveSince = 0;
    }

    bursts = bursts.filter((b) => {
      b.t += dt;
      return b.t < b.life;
    });

    setStatus();
  }

  function drawWheel() {
    ctx.clearRect(0, 0, W, H);

    // Speed-line indicator ring outside the wheel
    const speedPct = Math.min(1, Math.abs(omega) / (THRESHOLD * 1.6));
    const ringR = R + 14;
    ctx.strokeStyle = "rgba(180, 200, 255, 0.18)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(CX, CY, ringR, 0, Math.PI * 2);
    ctx.stroke();
    if (Math.abs(omega) > 0.01) {
      const arcSweep = speedPct * Math.PI * 2;
      ctx.strokeStyle = Math.abs(omega) >= THRESHOLD ? "#7cf0c6" : "#7c8dff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(CX, CY, ringR, -Math.PI / 2, -Math.PI / 2 + arcSweep, false);
      ctx.stroke();
    }

    // Threshold mark on the speed ring
    const thresholdPct = THRESHOLD / (THRESHOLD * 1.6);
    const ang = -Math.PI / 2 + thresholdPct * Math.PI * 2;
    ctx.strokeStyle = "rgba(124, 240, 198, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(ang) * (ringR - 9), CY + Math.sin(ang) * (ringR - 9));
    ctx.lineTo(CX + Math.cos(ang) * (ringR + 9), CY + Math.sin(ang) * (ringR + 9));
    ctx.stroke();

    // Bursts (rewards anim)
    bursts.forEach((b) => {
      const p = b.t / b.life;
      const rad = R * (1.0 + p * 0.6);
      ctx.strokeStyle = `rgba(124, 240, 198, ${(1 - p) * 0.55})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, rad, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Outer plate
    const plateGrad = ctx.createRadialGradient(CX - R * 0.4, CY - R * 0.4, R * 0.15, CX, CY, R);
    plateGrad.addColorStop(0, "rgba(80, 110, 200, 0.35)");
    plateGrad.addColorStop(1, "rgba(10, 16, 36, 0.85)");
    ctx.fillStyle = plateGrad;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Spokes — rotate with theta
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(theta);

    const spokes = 6;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const cx = Math.cos(a) * HANDLE_DIST;
      const cy = Math.sin(a) * HANDLE_DIST;
      // Stripe
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cx * 1.08, cy * 1.08);
      ctx.stroke();

      // Handle nub (a tiny FokéBall)
      const r = HANDLE_R;
      const topGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.15, cx, cy, r);
      topGrad.addColorStop(0, "#ff8d9e");
      topGrad.addColorStop(1, "#c93650");
      ctx.fillStyle = topGrad;
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();

      const botGrad = ctx.createRadialGradient(cx - r * 0.3, cy + r * 0.3, r * 0.15, cx, cy, r);
      botGrad.addColorStop(0, "#ffffff");
      botGrad.addColorStop(1, "#cdd3e2");
      ctx.fillStyle = botGrad;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI, true);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#0b1226";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#f5f7ff";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0b1226";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hub
    ctx.fillStyle = "#10193a";
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    drawWheel();
  }

  function closeChallenge() {
    cancelAnimationFrame(raf);
    if (!stopped && collected > 0) finalizeSpent();
    challenge.remove();
    activeChallenge = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) {
    if (ev.key === "Escape") closeChallenge();
  }
  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", closeChallenge);

  setStatus();
  raf = requestAnimationFrame(loop);
}

function updateLocationStatus(text, kind = "") {
  if (el.locationStatus) {
    el.locationStatus.textContent = text;
    el.locationStatus.className = `loc-pill${kind ? ` ${kind}` : ""}`;
  }
}

function setModalHelp(text, kind = "") {
  if (!el.modalLocationHelp) return;
  el.modalLocationHelp.textContent = text || "";
  el.modalLocationHelp.className = kind === "error" ? "error" : "";
}

function showLocationModal(body) {
  if (!el.locationModal) return;
  if (body) {
    const bodyNode = document.getElementById("locationModalBody");
    if (bodyNode) bodyNode.textContent = body;
  }
  el.locationModal.classList.remove("hidden");
}

function hideLocationModal() {
  if (!el.locationModal) return;
  el.locationModal.classList.add("hidden");
}

function onPositionUpdate(pos) {
  playerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  locationGranted = true;
  hideLocationModal();
  updateLocationStatus(`Live • ${playerLocation.lat.toFixed(5)}, ${playerLocation.lng.toFixed(5)}`, "live");
  if (el.mapHint) el.mapHint.classList.add("hidden");
  connectGridCaught();
  ensureFreshPlacements();
  renderMap();
  renderCards();
  updateBucketLabel();
}

function onPositionError(err) {
  if (err && err.code === 1) {
    updateLocationStatus("Permission denied", "error");
    showLocationModal("Location was blocked. Please re-enable it in your browser site settings to play.");
    setModalHelp("Tip: refresh the page after granting permission in browser settings.", "error");
  } else {
    updateLocationStatus("Unavailable", "error");
    setModalHelp("Couldn't get a fix — try again outdoors with a clear sky.", "error");
  }
}

function startLocationTracking() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    updateLocationStatus("Geolocation unavailable", "error");
    setModalHelp("Your browser doesn't support geolocation.", "error");
    return;
  }
  updateLocationStatus("Locating…");
  setModalHelp("Requesting your location…");

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    onPositionError,
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

async function bootstrapLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    updateLocationStatus("Geolocation unavailable", "error");
    showLocationModal("Your browser doesn't support geolocation.");
    return;
  }
  let state = null;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: "geolocation" });
      state = status.state;
      if (typeof status.addEventListener === "function") {
        status.addEventListener("change", () => {
          if (status.state === "granted" && !locationGranted) startLocationTracking();
        });
      }
    }
  } catch {
    state = null;
  }

  if (state === "granted") {
    hideLocationModal();
    startLocationTracking();
  } else if (state === "denied") {
    updateLocationStatus("Permission denied", "error");
    showLocationModal("Location is blocked. Please re-enable it in your browser site settings to play.");
  } else {
    showLocationModal();
  }
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
  const key = currentGridBucketKey();
  if (!key) return;
  if (key === lastGridKey) return;
  if (lastGridKey) {
    try { gridCaughtNode.get(lastGridKey).off(); } catch {}
  }
  gridCaughtIds.clear();
  lastGridKey = key;
  gridCaughtNode.get(key).map().on((entry) => {
    if (!entry?.cardId) return;
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
  renderBallCount();
  renderCards();
  renderMap();
  renderCollection();
  connectFeed();
  updateBucketLabel();
  bootstrapLocation();
}

if (el.form) {
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) return;
    profile = { name, team: el.team.value };
    saveLocal();
    enterGame();
  });
}

if (el.reset) {
  el.reset.addEventListener("click", () => {
    try { localStorage.removeItem("fokemon_profile"); } catch {}
    location.reload();
  });
}

if (el.enableLocation) {
  el.enableLocation.addEventListener("click", () => {
    setModalHelp("Requesting your location…");
    startLocationTracking();
  });
}


initGun();

if (profile?.name) enterGame();

if (typeof setInterval === "function") {
  setInterval(() => {
    const prevKey = currentPlacementsKey;
    ensureFreshPlacements();
    if (prevKey !== currentPlacementsKey) {
      gridCaughtIds.clear();
      connectGridCaught();
      renderCards();
      renderMap();
    } else if (poiMarkers.size && currentPois.length) {
      const now = Date.now();
      let anyChange = false;
      currentPois.forEach((poi) => {
        const spent = poiSpent[poi.id];
        if (spent && now - spent < POI_COOLDOWN_MS) anyChange = true;
      });
      if (anyChange) renderMap();
    }
    updateBucketLabel();
  }, 1000);
}
