import {
  computePoiPlacements,
  computeSpawnPlacements,
  computeBattleSitePlacements,
  battleSiteName,
  effectiveStats,
  isChampionRetired,
  simulateBattle,
  seedFromStrings,
  clampBoost,
  totalBoostCapRemaining,
  MAX_TRAINING_BOOST_PER_STAT,
  MAX_CHAMPION_DEFENSES,
  CHAMPION_TTL_MS,
  typeMultiplier,
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
const BATTLE_SITE_RANGE_METERS = 100;
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
let battleSitesNode = null;
let battleEventsNode = null;

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

const MOVEMENT_BY_TYPE = {
  Electric: "jump",
  Fire: "jump",
  Bug: "jump",
  Water: "glide",
  Ice: "glide",
  Wind: "fly",
  Cosmic: "fly",
  Spirit: "fly",
  Shadow: "fly",
  Leaf: "walk",
  Rock: "walk",
  Metal: "walk",
};

const MOVEMENT_PROFILES = {
  walk: {
    label: "Walking",
    bandY: [0.6, 0.78],
    speed: [22, 42],
    bobAmp: 3,
    turnInterval: [1.2, 2.2],
    dodgeChance: 0.55,
  },
  glide: {
    label: "Gliding",
    bandY: [0.38, 0.62],
    speed: [55, 95],
    bobAmp: 7,
    turnInterval: [1.4, 2.4],
    weaveAmp: 9,
    weaveSpeed: 1.8,
    dodgeChance: 0.35,
  },
  fly: {
    label: "Flying",
    bandY: [0.2, 0.55],
    speed: [80, 130],
    bobAmp: 4,
    turnInterval: [0.9, 1.7],
    weaveAmp: 18,
    weaveSpeed: 2.6,
    dodgeChance: 0.3,
  },
  jump: {
    label: "Jumping",
    bandY: [0.5, 0.66],
    bobAmp: 2,
    restMin: 0.32,
    restMax: 0.78,
    jumpDur: [0.42, 0.62],
    jumpDist: [60, 140],
    jumpHeight: [55, 115],
    dodgeChance: 0.25,
  },
};

function movementFor(card) {
  return MOVEMENT_BY_TYPE[card?.type] || "walk";
}

function hitsRequired(card) {
  if (card?.rarity === "epic") return 3;
  if (card?.rarity === "rare") return 2;
  return 1;
}

function powerScore(card) {
  if (!card) return 0;
  return (card.hp || 0) + (card.atk || 0) + (card.def || 0) + (card.spd || 0);
}

function powerTier(score) {
  if (score >= 270) return "elite";
  if (score >= 240) return "strong";
  if (score >= 210) return "steady";
  return "rookie";
}

function hitsDotsHtml(total, remaining) {
  let html = "";
  for (let i = 0; i < total; i++) {
    html += `<span class="hit-dot${i < remaining ? "" : " spent"}"></span>`;
  }
  return html;
}

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
const battleSiteMarkers = new Map();
let currentBattleSites = [];
let currentBattleSitesCellKey = null;
const championsBySite = new Map();
const subscribedChampionSites = new Set();

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
  requestAnimationFrame(() => leafletMap?.invalidateSize());
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
    currentBattleSites = [];
    currentBattleSitesCellKey = null;
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
  if (gridKey !== currentBattleSitesCellKey) {
    currentBattleSites = computeBattleSitePlacements(playerLocation.lat, playerLocation.lng, {
      neighborhoodCells: 2,
    });
    currentBattleSitesCellKey = gridKey;
    subscribeChampionUpdates();
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
      const power = powerScore(card);
      const tier = powerTier(power);
      return `
        <div class="gallery-card" data-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Flip ${escapeHtml(card.name)} card">
          <div class="flipper">
            <div class="face front">
              <span class="count-pill" aria-label="Caught ${n} times">&times;${n}</span>
              <canvas class="gallery-art" width="160" height="120" aria-hidden="true"></canvas>
              <div class="gallery-meta">
                <strong>${escapeHtml(card.name)}</strong>
                <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
                <span class="power-chip ${tier}" title="Power level">⚡ ${power}</span>
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
      const power = powerScore(p.card);
      const tier = powerTier(power);
      const motion = MOVEMENT_PROFILES[movementFor(p.card)].label;
      const colors = colorsFor(p.card);
      const typeStyle = `background:${colors.accent};color:#061226;`;
      return `
        <article class="poke-card">
          <div class="poke-card-top">
            <strong>${escapeHtml(p.card.name)}</strong>
            <span class="power-chip ${tier}" title="Power level">⚡ ${power}</span>
          </div>
          <div class="poke-card-mid">
            <span class="type-pill" style="${typeStyle}">${escapeHtml(p.card.type)}</span>
            <span class="motion-tag">${motion}</span>
          </div>
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

function activeChampionFor(siteId) {
  const champion = championsBySite.get(siteId);
  if (!champion) return null;
  if (isChampionRetired(champion)) return null;
  return champion;
}

function siteCatchable(site) {
  if (!playerLocation || !site) return false;
  return distanceMeters(playerLocation, { lat: site.lat, lng: site.lng }) <= BATTLE_SITE_RANGE_METERS;
}

function siteIconSignature(site) {
  const champion = activeChampionFor(site.id);
  const meters = playerLocation
    ? Math.round(distanceMeters(playerLocation, { lat: site.lat, lng: site.lng }))
    : null;
  const near = meters !== null && meters <= BATTLE_SITE_RANGE_METERS;
  const mine = champion && champion.trainer === profile?.name;
  const status = !champion ? "vacant" : mine ? "yours" : "rival";
  const sig = `${status}|${near ? "near" : "far"}|${champion?.cardId || ""}|${champion?.defenses || 0}`;
  return { champion, near, status, sig, meters };
}

function makeBattleSiteIcon(site, info) {
  const L = window.L;
  const name = battleSiteName(site.id);
  const champion = info.champion;
  let label;
  if (champion) {
    const card = cardsById.get(champion.cardId);
    label = card ? `${card.name}` : "Champion";
  } else {
    label = "Vacant";
  }
  const ring = champion ? colorsFor(cardsById.get(champion.cardId) || { type: "Metal" }).accent : "#9aaabd";
  return L.divIcon({
    className: "",
    html: `
      <div class="battle-site-marker ${info.status} ${info.near ? "near" : ""}" style="--ring:${ring}">
        <span class="bs-banner">${escapeHtml(name)}</span>
        <span class="bs-medal"><span class="bs-medal-inner">⚔</span></span>
        <small>${escapeHtml(label)}</small>
      </div>
    `,
    iconSize: [86, 80],
    iconAnchor: [43, 80],
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
    battleSiteMarkers.forEach((m) => m.remove());
    battleSiteMarkers.clear();
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

  const wantedSiteKeys = new Set();
  currentBattleSites.forEach((site) => {
    wantedSiteKeys.add(site.id);
    const info = siteIconSignature(site);
    let marker = battleSiteMarkers.get(site.id);
    const onSiteClick = () => {
      if (!siteCatchable(site)) {
        map.flyTo([site.lat, site.lng], 19, { duration: 0.8 });
        return;
      }
      openBattleSite(site);
    };
    if (!marker) {
      marker = L.marker([site.lat, site.lng], { icon: makeBattleSiteIcon(site, info) }).addTo(map);
      marker._siteSig = info.sig;
      marker.on("click", onSiteClick);
      battleSiteMarkers.set(site.id, marker);
    } else if (marker._siteSig !== info.sig) {
      marker.setIcon(makeBattleSiteIcon(site, info));
      marker._siteSig = info.sig;
    }
  });
  for (const [key, marker] of battleSiteMarkers) {
    if (!wantedSiteKeys.has(key)) {
      marker.remove();
      battleSiteMarkers.delete(key);
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

  const initialHits = hitsRequired(card);
  const power = powerScore(card);
  const tier = powerTier(power);
  const motionLabel = MOVEMENT_PROFILES[movementFor(card)].label;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card" role="dialog" aria-modal="true" aria-label="Catch ${escapeHtml(card.name)}">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${escapeHtml(card.name)}</h3>
      <div class="challenge-meta">
        <span class="power-chip ${tier}" title="Power level">⚡ Power ${power}</span>
        <span class="motion-tag">${motionLabel}</span>
      </div>
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

  const movementMode = movementFor(card);
  const movementProfile = MOVEMENT_PROFILES[movementMode];
  const startBand = movementProfile.bandY || [0.4, 0.55];
  const startY = H * (startBand[0] + (startBand[1] - startBand[0]) * 0.5);

  const fokemon = {
    x: W * (0.55 + Math.random() * 0.3),
    y: startY,
    r: 30,
    bobPhase: Math.random() * Math.PI * 2,
    bobAmp: movementProfile.bobAmp ?? 4,
    caught: false,
    captureScale: 1,
    mode: movementMode,
    profile: movementProfile,
    vx: 0,
    turnCd: 0,
    targetY: startY,
    weavePhase: Math.random() * Math.PI * 2,
    jumpState: "rest",
    restTime: 0.25 + Math.random() * 0.4,
    jumpTime: 0,
    jumpDur: 0,
    jumpFromX: 0,
    jumpToX: 0,
    jumpFromY: 0,
    jumpToY: 0,
    jumpPeakY: 0,
    dodgeVx: 0,
    dodgeTime: 0,
    hitsLeft: initialHits,
    hitsTotal: initialHits,
    flashTime: 0,
  };

  const DODGE_CHANCE = movementProfile.dodgeChance ?? 0.4;
  const DODGE_RANGE = 95;
  const DODGE_SPEED = 360;
  const DODGE_DURATION = 0.26;
  const FOKEMON_MIN_X = Math.max(ANCHOR.x + 120, W * 0.4);

  const OBSTACLE_COUNT_BY_RARITY = { common: 1, rare: 2, epic: 2 };
  const OBSTACLE_HP_BY_RARITY = { common: [1, 1], rare: [1, 1], epic: [1, 2] };

  function makeObstacles() {
    const rarity = card?.rarity || "common";
    const count = OBSTACLE_COUNT_BY_RARITY[rarity] ?? 1;
    const [hpMin, hpMax] = OBSTACLE_HP_BY_RARITY[rarity] ?? [1, 1];
    const arr = [];
    for (let i = 0; i < count; i++) {
      const slotFrac = count === 1 ? 0.5 : i / (count - 1);
      const baseX = W * (0.36 + slotFrac * 0.2);
      const jitterX = (Math.random() - 0.5) * Math.min(36, W * 0.08);
      const w = 34 + Math.random() * 14;
      const h = 36 + Math.random() * 16;
      const hp = hpMin + Math.floor(Math.random() * (hpMax - hpMin + 1));
      arr.push({
        x: baseX + jitterX,
        y: H * (0.38 + Math.random() * 0.32),
        w,
        h,
        hp,
        maxHp: hp,
        broken: false,
        breakTime: 0,
        shakeTime: 0,
      });
    }
    return arr;
  }
  const obstacles = makeObstacles();

  const HIT_WORDS = ["POW!", "BAM!", "WHACK!", "KAPOW!", "BOOM!", "ZAP!", "THWACK!"];
  const FINAL_WORDS = ["GOTCHA!", "K.O.!", "SNARE!", "CAUGHT!"];
  const SMASH_WORDS = ["SMASH!", "CRACK!", "SHATTER!", "KRAKK!"];
  const BLOCK_WORDS = ["THUD!", "BONK!", "KLANG!", "CLUNK!"];
  const COMIC_COLORS = { hit: "#ffe27a", final: "#7cf0c6", smash: "#ff9c70", block: "#cdd6f0" };
  function pickWord(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  const comicTexts = [];
  function popComic(text, x, y, kind = "hit") {
    comicTexts.push({
      text,
      x,
      y,
      vy: -55 - Math.random() * 25,
      life: 0.95,
      maxLife: 0.95,
      color: COMIC_COLORS[kind] ?? "#ffffff",
      rotation: (Math.random() - 0.5) * 0.5,
    });
    if (comicTexts.length > 6) comicTexts.shift();
  }
  function updateComicTexts(dt) {
    for (const t of comicTexts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.93;
    }
    for (let i = comicTexts.length - 1; i >= 0; i--) {
      if (comicTexts[i].life <= 0) comicTexts.splice(i, 1);
    }
  }
  function drawComicTexts() {
    for (const t of comicTexts) {
      const lifeT = t.life / t.maxLife;
      let s = 1;
      let alpha = 1;
      if (lifeT > 0.85) {
        const k = (1 - lifeT) / 0.15;
        s = 0.45 + k * 0.85;
        alpha = k;
      } else if (lifeT < 0.3) {
        const k = lifeT / 0.3;
        s = 1.05;
        alpha = k;
      } else {
        s = 1.1;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.scale(s, s);
      ctx.font = "900 24px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(7, 13, 28, 0.95)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  function obstacleHit(o, px, py, r) {
    const left = o.x - o.w / 2;
    const right = o.x + o.w / 2;
    const top = o.y - o.h / 2;
    const bottom = o.y + o.h / 2;
    const cx = Math.max(left, Math.min(px, right));
    const cy = Math.max(top, Math.min(py, bottom));
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy < r * r;
  }
  function applyObstacleDamage(o) {
    o.hp -= 1;
    o.shakeTime = 0.25;
    if (o.hp <= 0) {
      o.broken = true;
      o.breakTime = 0.55;
      popComic(pickWord(SMASH_WORDS), o.x, o.y - o.h / 2 - 6, "smash");
    } else {
      popComic(pickWord(BLOCK_WORDS), o.x, o.y - o.h / 2 - 6, "block");
    }
  }
  function updateObstacles(dt) {
    for (const o of obstacles) {
      if (o.broken && o.breakTime > 0) o.breakTime = Math.max(0, o.breakTime - dt);
      if (o.shakeTime > 0) o.shakeTime = Math.max(0, o.shakeTime - dt);
    }
  }
  function drawObstacles() {
    for (const o of obstacles) {
      if (o.broken && o.breakTime <= 0) continue;
      drawObstacle(o);
    }
  }
  function drawObstacle(o) {
    const fade = o.broken ? Math.max(0, o.breakTime / 0.55) : 1;
    const rot = o.broken ? (1 - fade) * 0.6 : 0;
    const shakeX = o.shakeTime > 0 ? (Math.random() - 0.5) * 4 * (o.shakeTime / 0.25) : 0;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(o.x + shakeX, o.y);
    ctx.rotate(rot);
    const grad = ctx.createLinearGradient(0, -o.h / 2, 0, o.h / 2);
    grad.addColorStop(0, "#b08148");
    grad.addColorStop(1, "#6b4a23");
    ctx.fillStyle = grad;
    ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-o.w / 2, 0);
    ctx.lineTo(o.w / 2, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.moveTo(-o.w / 2 + 4, -o.h / 2 + 4);
    ctx.lineTo(o.w / 2 - 4, o.h / 2 - 4);
    ctx.moveTo(o.w / 2 - 4, -o.h / 2 + 4);
    ctx.lineTo(-o.w / 2 + 4, o.h / 2 - 4);
    ctx.stroke();
    const damage = 1 - o.hp / o.maxHp;
    if (damage > 0 && !o.broken) {
      ctx.strokeStyle = "rgba(255, 240, 200, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-o.w / 4, -o.h / 3);
      ctx.lineTo(-o.w / 10, -o.h / 12);
      ctx.lineTo(o.w / 5, -o.h / 6);
      if (damage > 0.55) {
        ctx.moveTo(o.w / 8, -o.h / 8);
        ctx.lineTo(0, o.h / 6);
        ctx.lineTo(-o.w / 5, o.h / 4);
      }
      ctx.stroke();
    }
    if (o.maxHp > 1 && !o.broken) {
      const pipR = 2.2;
      const gap = 6;
      const totalW = (o.maxHp - 1) * gap;
      for (let i = 0; i < o.maxHp; i++) {
        ctx.fillStyle = i < o.hp ? "#ffe080" : "rgba(0, 0, 0, 0.55)";
        ctx.beginPath();
        ctx.arc(-totalW / 2 + i * gap, -o.h / 2 - 8, pipR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

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

  function clampX(x) {
    return Math.max(FOKEMON_MIN_X, Math.min(W - fokemon.r - 6, x));
  }

  function pickTargetY() {
    const [lo, hi] = movementProfile.bandY;
    return H * (lo + Math.random() * (hi - lo));
  }

  function pickSpeed() {
    const [lo, hi] = movementProfile.speed;
    return lo + Math.random() * (hi - lo);
  }

  function updateContinuousMotion(dt) {
    fokemon.turnCd -= dt;
    if (fokemon.turnCd <= 0) {
      fokemon.vx = (Math.random() < 0.5 ? -1 : 1) * pickSpeed();
      fokemon.targetY = pickTargetY();
      const [lo, hi] = movementProfile.turnInterval;
      fokemon.turnCd = lo + Math.random() * (hi - lo);
    }
    fokemon.x += fokemon.vx * dt;
    if (fokemon.x < FOKEMON_MIN_X) {
      fokemon.x = FOKEMON_MIN_X;
      fokemon.vx = Math.abs(fokemon.vx);
    } else if (fokemon.x > W - fokemon.r - 6) {
      fokemon.x = W - fokemon.r - 6;
      fokemon.vx = -Math.abs(fokemon.vx);
    }
    let yTarget = fokemon.targetY;
    if (movementProfile.weaveAmp) {
      fokemon.weavePhase += dt * movementProfile.weaveSpeed;
      yTarget += Math.sin(fokemon.weavePhase) * movementProfile.weaveAmp;
    }
    fokemon.y += (yTarget - fokemon.y) * Math.min(1, dt * 2.4);
  }

  function updateJumpMotion(dt) {
    const p = movementProfile;
    if (fokemon.jumpState === "rest") {
      fokemon.restTime -= dt;
      if (fokemon.restTime <= 0) {
        const dist = p.jumpDist[0] + Math.random() * (p.jumpDist[1] - p.jumpDist[0]);
        let dir = Math.random() < 0.5 ? -1 : 1;
        if (fokemon.x < FOKEMON_MIN_X + 40) dir = 1;
        else if (fokemon.x > W * 0.82) dir = -1;
        const dur = p.jumpDur[0] + Math.random() * (p.jumpDur[1] - p.jumpDur[0]);
        const height = p.jumpHeight[0] + Math.random() * (p.jumpHeight[1] - p.jumpHeight[0]);
        fokemon.jumpFromX = fokemon.x;
        fokemon.jumpFromY = fokemon.y;
        fokemon.jumpToX = clampX(fokemon.x + dir * dist);
        fokemon.jumpToY = H * (p.bandY[0] + Math.random() * (p.bandY[1] - p.bandY[0]));
        fokemon.jumpPeakY = Math.min(fokemon.jumpFromY, fokemon.jumpToY) - height;
        fokemon.jumpDur = dur;
        fokemon.jumpTime = 0;
        fokemon.jumpState = "air";
      }
    } else {
      fokemon.jumpTime += dt;
      const t = Math.min(1, fokemon.jumpTime / fokemon.jumpDur);
      const t1 = 1 - t;
      fokemon.x = fokemon.jumpFromX + (fokemon.jumpToX - fokemon.jumpFromX) * t;
      fokemon.y = t1 * t1 * fokemon.jumpFromY + 2 * t1 * t * fokemon.jumpPeakY + t * t * fokemon.jumpToY;
      if (t >= 1) {
        fokemon.jumpState = "rest";
        fokemon.restTime = p.restMin + Math.random() * (p.restMax - p.restMin);
      }
    }
  }

  function updateMovement(dt) {
    if (fokemon.mode === "jump") updateJumpMotion(dt);
    else updateContinuousMotion(dt);
  }

  function relocateAfterHit() {
    const dashDir = (Math.random() < 0.5 ? -1 : 1);
    fokemon.dodgeVx = dashDir * (220 + Math.random() * 80);
    fokemon.dodgeTime = 0.22;
    fokemon.jumpState = "rest";
    fokemon.restTime = 0.18 + Math.random() * 0.2;
    fokemon.turnCd = 0;
  }

  function step(dt) {
    fokemon.bobPhase += dt * 2.4;
    if (fokemon.flashTime > 0) fokemon.flashTime = Math.max(0, fokemon.flashTime - dt);

    if (!fokemon.caught) {
      if (fokemon.dodgeTime > 0) {
        fokemon.x = clampX(fokemon.x + fokemon.dodgeVx * dt);
        fokemon.dodgeTime -= dt;
        if (fokemon.dodgeTime <= 0) fokemon.dodgeVx = 0;
      } else {
        updateMovement(dt);
      }
    } else {
      fokemon.captureScale = Math.max(0, fokemon.captureScale - dt * 2.4);
    }

    if (projectile) {
      netSpin += dt * 8;
      projectile.vy += GRAVITY * dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      const bobY = fokemon.y + Math.sin(fokemon.bobPhase) * fokemon.bobAmp;

      for (const o of obstacles) {
        if (o.broken) continue;
        if (obstacleHit(o, projectile.x, projectile.y, NET_RADIUS - 2)) {
          applyObstacleDamage(o);
          projectile = null;
          if (fokeBalls <= 0) {
            finished = true;
            outcome = "escaped";
            cancel.textContent = "Close";
            setStatus();
            setTimeout(closeChallenge, 1500);
          } else {
            setStatus();
          }
          return;
        }
      }

      if (!fokemon.caught && dodgeArmed && !dodgeTriggered && fokemon.dodgeTime <= 0) {
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
          fokemon.hitsLeft -= 1;
          fokemon.flashTime = 0.45;

          if (fokemon.hitsLeft <= 0) {
            popComic(pickWord(FINAL_WORDS), fokemon.x, bobY - fokemon.r - 6, "final");
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
          popComic(pickWord(HIT_WORDS), fokemon.x, bobY - fokemon.r - 6, "hit");
          projectile = null;
          relocateAfterHit();
          if (fokeBalls <= 0) {
            finished = true;
            outcome = "escaped";
            cancel.textContent = "Close";
            setStatus();
            setTimeout(closeChallenge, 1500);
          } else {
            setStatus();
          }
          return;
        }
      }

      const offscreen = projectile.x < -40 || projectile.x > W + 40 || projectile.y > FLOOR_Y + NET_RADIUS;
      if (offscreen) {
        projectile = null;
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
    const bobY = fokemon.y + Math.sin(fokemon.bobPhase) * fokemon.bobAmp;
    const r = fokemon.r * scale;

    const shadowY = Math.min(FLOOR_Y - 2, bobY + r * 1.4);
    const shadowScale = Math.max(0.25, Math.min(1, 1 - (shadowY - FLOOR_Y) * 0.01));
    ctx.fillStyle = `rgba(0,0,0,${0.18 + 0.22 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(fokemon.x, FLOOR_Y - 2, r * 0.78 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    drawCreature(ctx, card, fokemon.x, bobY, r);

    if (fokemon.flashTime > 0) {
      const alpha = Math.min(1, fokemon.flashTime / 0.45) * 0.6;
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255, 245, 200, ${alpha})`;
      ctx.beginPath();
      ctx.arc(fokemon.x, bobY, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = prev;
    }

    if (!fokemon.caught) {
      ctx.font = "600 12px Outfit, sans-serif";
      ctx.fillStyle = "rgba(245, 247, 255, 0.9)";
      ctx.textAlign = "center";
      const labelWidth = ctx.measureText(card.name).width;
      const labelX = Math.max(labelWidth / 2 + 6, Math.min(W - labelWidth / 2 - 6, fokemon.x));
      ctx.fillText(card.name, labelX, bobY - r - 14);
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
    drawObstacles();
    drawFokemon();

    const netPos = projectile ? projectile : netRestPosition();
    drawSlingshot(netPos, !!projectile);
    drawTrajectory();
    drawNet(netPos, !!projectile);
    drawComicTexts();
  }

  let lastTime = performance.now();
  let rafId = 0;
  function loop(now) {
    if (!document.body.contains(challenge)) return;
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    updateObstacles(dt);
    updateComicTexts(dt);
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

let openSiteId = null;
let openSiteRefresh = null;

function refreshOpenSitePanel(siteId) {
  if (!openSiteId || openSiteId !== siteId) return;
  if (typeof openSiteRefresh === "function") openSiteRefresh();
}

function uniqueCollectionEntries() {
  const counts = new Map();
  for (const c of caught) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ card: cardsById.get(id), count }))
    .filter((e) => e.card)
    .sort((a, b) => (b.card.hp + b.card.atk + b.card.def + b.card.spd) - (a.card.hp + a.card.atk + a.card.def + a.card.spd));
}

function statRowHtml(label, base, boost, max) {
  const total = base + boost;
  const pct = Math.max(4, Math.min(100, (total / max) * 100));
  return `
    <li>
      <span class="stat-label">${label}</span>
      <span class="stat-bar"><span class="stat-fill" style="width:${pct}%"></span></span>
      <span class="stat-val">${total}${boost ? `<span class="stat-boost"> +${boost}</span>` : ""}</span>
    </li>
  `;
}

function championPickerHtml(actionLabel) {
  const entries = uniqueCollectionEntries();
  if (!entries.length) {
    return `<p class="empty-state">Catch some Fokemon first — you can't deploy what you don't have.</p>`;
  }
  return `
    <p class="picker-prompt">Pick your fighter to ${escapeHtml(actionLabel)}:</p>
    <div class="picker-grid">
      ${entries.map(({ card, count }) => {
        const colors = colorsFor(card);
        const total = card.hp + card.atk + card.def + card.spd;
        return `
          <button class="picker-card" data-card="${escapeHtml(card.id)}" style="--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};">
            <span class="picker-power">⚡${total}</span>
            <strong>${escapeHtml(card.name)}</strong>
            <small>${escapeHtml(card.type)} • ×${count}</small>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function openBattleSite(site) {
  if (activeChallenge) return;
  if (openSiteId) return;
  openSiteId = site.id;

  const overlay = document.createElement("div");
  overlay.className = "battle-site-modal";
  overlay.innerHTML = `
    <div class="site-card" role="dialog" aria-modal="true" aria-label="Battle site">
      <header class="site-head">
        <div>
          <p class="eyebrow">Foké Gym</p>
          <h3 class="site-name"></h3>
        </div>
        <button class="ghost site-close" aria-label="Close">Close</button>
      </header>
      <div class="site-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameEl = overlay.querySelector(".site-name");
  const bodyEl = overlay.querySelector(".site-body");
  const closeBtn = overlay.querySelector(".site-close");
  nameEl.textContent = battleSiteName(site.id);

  function close() {
    overlay.remove();
    openSiteId = null;
    openSiteRefresh = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(ev) { if (ev.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  function render() {
    const champion = activeChampionFor(site.id);
    const meters = playerLocation
      ? Math.round(distanceMeters(playerLocation, { lat: site.lat, lng: site.lng }))
      : null;
    const inRange = meters !== null && meters <= BATTLE_SITE_RANGE_METERS;

    if (!champion) {
      bodyEl.innerHTML = `
        <div class="site-state vacant">
          <p class="site-status">⚔ Vacant arena. Be the first to plant a flag here.</p>
          ${inRange ? championPickerHtml("deploy as champion") : `<p class="empty-state">Walk into range (${meters ?? "?"}m / ${BATTLE_SITE_RANGE_METERS}m) to deploy.</p>`}
        </div>
      `;
      if (inRange) {
        bodyEl.querySelectorAll(".picker-card").forEach((btn) => {
          btn.addEventListener("click", () => {
            const cardId = btn.dataset.card;
            const card = cardsById.get(cardId);
            if (!card) return;
            const champ = {
              trainer: profile.name,
              team: profile.team || "mint",
              cardId,
              boosts: { hp: 0, atk: 0, def: 0, spd: 0 },
              defenses: 0,
              placedAt: Date.now(),
              lastBattleAt: 0,
            };
            championsBySite.set(site.id, champ);
            publishChampion(site.id, champ);
            renderMap();
            render();
          });
        });
      }
      return;
    }

    const card = cardsById.get(champion.cardId);
    if (!card) {
      bodyEl.innerHTML = `<p class="empty-state">Champion data corrupted.</p>`;
      return;
    }
    const stats = effectiveStats(card, champion);
    const colors = colorsFor(card);
    const mine = champion.trainer === profile?.name;
    const placedAgo = Math.max(0, Date.now() - champion.placedAt);
    const ttlLeft = Math.max(0, CHAMPION_TTL_MS - placedAgo);
    const hours = Math.floor(ttlLeft / 3_600_000);
    const minutes = Math.floor((ttlLeft % 3_600_000) / 60_000);
    const boostCap = totalBoostCapRemaining(champion.boosts);

    bodyEl.innerHTML = `
      <div class="site-state ${mine ? "yours" : "rival"}">
        <div class="champion-pane" style="--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};">
          <div class="champion-portrait">
            <canvas class="champ-art" width="180" height="160" aria-hidden="true"></canvas>
            <span class="defense-pips" aria-label="Defenses">
              ${Array.from({ length: MAX_CHAMPION_DEFENSES }, (_, i) =>
                `<span class="pip ${i < champion.defenses ? "lit" : ""}"></span>`
              ).join("")}
            </span>
          </div>
          <div class="champion-meta">
            <h4>${escapeHtml(card.name)} <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span></h4>
            <p class="champion-owner">Champion of <strong>${escapeHtml(champion.trainer)}</strong>${mine ? " (you)" : ""}</p>
            <ul class="stats-list">
              ${statRowHtml("HP", card.hp, champion.boosts.hp, 140)}
              ${statRowHtml("ATK", card.atk, champion.boosts.atk, 120)}
              ${statRowHtml("DEF", card.def, champion.boosts.def, 120)}
              ${statRowHtml("SPD", card.spd, champion.boosts.spd, 120)}
            </ul>
            <p class="champion-meta-line">
              <span class="badge">Defenses ${champion.defenses}/${MAX_CHAMPION_DEFENSES}</span>
              <span class="badge">Time left ${hours}h ${minutes}m</span>
              ${champion.defenses > 0 ? `<span class="badge fatigue">Fatigue ${Math.min(45, champion.defenses * 9)}%</span>` : ""}
            </p>
          </div>
        </div>
        ${!inRange ? `<p class="empty-state">Walk into range (${meters ?? "?"}m / ${BATTLE_SITE_RANGE_METERS}m) to interact.</p>` : ""}
        <div class="site-actions"></div>
      </div>
    `;

    const portraitCanvas = bodyEl.querySelector(".champ-art");
    if (portraitCanvas) renderPortrait(portraitCanvas, card);

    if (!inRange) return;

    const actions = bodyEl.querySelector(".site-actions");
    if (mine) {
      actions.innerHTML = `
        <button class="primary action-train">${boostCap > 0 ? "Train in the gym" : "Boost capped — recall to retrain"}</button>
        <button class="ghost action-recall">Recall champion</button>
      `;
      if (boostCap > 0) {
        actions.querySelector(".action-train").addEventListener("click", () => {
          close();
          launchTraining(site, champion);
        });
      } else {
        actions.querySelector(".action-train").disabled = true;
      }
      actions.querySelector(".action-recall").addEventListener("click", () => {
        championsBySite.delete(site.id);
        publishChampionRemoved(site.id);
        renderMap();
        render();
      });
    } else {
      actions.innerHTML = `
        <p class="picker-prompt">Send a challenger to dethrone <strong>${escapeHtml(champion.trainer)}</strong>:</p>
        ${championPickerHtml("send into battle")}
      `;
      actions.querySelectorAll(".picker-card").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cardId = btn.dataset.card;
          const card = cardsById.get(cardId);
          if (!card) return;
          close();
          launchBattle(site, card, champion);
        });
      });
    }
  }
  openSiteRefresh = render;
  render();
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

const TRAINING_STAT_KEYS = ["hp", "atk", "def", "spd"];
const TRAINING_STAT_LABELS = { hp: "HP", atk: "ATK", def: "DEF", spd: "SPD" };

function preferredTrainingStat(card) {
  if (!card) return "atk";
  const movement = MOVEMENT_BY_TYPE[card.type] || "walk";
  if (movement === "fly" || movement === "glide" || card.type === "Wind") return "spd";
  if (card.type === "Metal" || card.type === "Rock" || card.type === "Leaf") return "def";
  if (card.type === "Electric" || card.type === "Fire" || card.type === "Cosmic") return "atk";
  return "hp";
}

function launchTraining(site, champion) {
  if (activeChallenge) return;
  const card = cardsById.get(champion.cardId);
  if (!card) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge training-challenge";
  challenge.innerHTML = `
    <div class="challenge-card" role="dialog" aria-modal="true" aria-label="Training arena">
      <p class="eyebrow">Gym training</p>
      <h3>Dodge drill — <span class="train-name">${escapeHtml(card.name)}</span></h3>
      <div class="challenge-meta">
        <span class="motion-tag">${escapeHtml(card.type)} • ${MOVEMENT_PROFILES[movementFor(card)].label}</span>
        <span class="hits-meter"><span class="meta-label">HP</span><span class="train-hp"></span></span>
        <span class="hits-meter"><span class="meta-label">Reps</span><span class="train-score">0</span></span>
      </div>
      <p class="train-help">Drag your Fokemon to dodge incoming trainer-balls. Survive as long as you can — each near-miss earns training reps. Boost stats when the drill ends.</p>
      <div class="arena training-arena">
        <canvas class="training-canvas" aria-label="Training arena"></canvas>
      </div>
      <p class="status" aria-live="polite">Drag your fighter. Avoid the balls!</p>
      <div class="training-footer">
        <button class="ghost cancel">Stop drill</button>
      </div>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const canvas = challenge.querySelector(".training-canvas");
  const arena = challenge.querySelector(".training-arena");
  const status = challenge.querySelector(".status");
  const cancel = challenge.querySelector(".cancel");
  const scoreEl = challenge.querySelector(".train-score");
  const hpEl = challenge.querySelector(".train-hp");

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

  const PLAYER_R = 26;
  let hpMax = 3;
  let hp = hpMax;
  let score = 0;
  let stopped = false;
  let dragging = false;
  let totalElapsed = 0;
  let nextSpawnIn = 1.4;
  let spawnInterval = 1.4;
  let difficulty = 0;
  let fokePos = { x: W / 2, y: H / 2 };
  const balls = [];
  const sparks = [];
  const comicTexts = [];

  function setHpText() {
    if (hpEl) hpEl.textContent = `${hp}/${hpMax}`;
  }
  setHpText();

  function popComic(text, x, y, color) {
    comicTexts.push({ text, x, y, vy: -50 - Math.random() * 30, life: 0.9, maxLife: 0.9, color, rotation: (Math.random() - 0.5) * 0.4 });
    if (comicTexts.length > 6) comicTexts.shift();
  }
  function popSparks(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 120;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, maxLife: 0.6, color });
    }
  }

  function getPointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function onDown(e) {
    if (stopped) return;
    const p = getPointer(e);
    const dx = p.x - fokePos.x;
    const dy = p.y - fokePos.y;
    if (dx * dx + dy * dy < (PLAYER_R + 10) * (PLAYER_R + 10)) {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      dragging = true;
    } else {
      // Allow grabbing anywhere — pull fokemon toward pointer instead.
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      dragging = true;
      fokePos.x = clamp(p.x, PLAYER_R, W - PLAYER_R);
      fokePos.y = clamp(p.y, PLAYER_R, H - PLAYER_R);
    }
  }
  function onMove(e) {
    if (!dragging || stopped) return;
    e.preventDefault();
    const p = getPointer(e);
    fokePos.x = clamp(p.x, PLAYER_R, W - PLAYER_R);
    fokePos.y = clamp(p.y, PLAYER_R, H - PLAYER_R);
  }
  function onUp() { dragging = false; }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  function spawnBall(dt) {
    nextSpawnIn -= dt;
    if (nextSpawnIn > 0) return;
    nextSpawnIn = spawnInterval;
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0) { x = Math.random() * W; y = -20; }
    else if (edge === 1) { x = W + 20; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = H + 20; }
    else { x = -20; y = Math.random() * H; }
    const targetJitterX = (Math.random() - 0.5) * 90;
    const targetJitterY = (Math.random() - 0.5) * 90;
    const tx = fokePos.x + targetJitterX;
    const ty = fokePos.y + targetJitterY;
    const dx = tx - x;
    const dy = ty - y;
    const dist = Math.hypot(dx, dy);
    const speed = 230 + difficulty * 90 + Math.random() * 80;
    balls.push({
      x, y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      r: 11,
      passed: false,
      spin: Math.random() * Math.PI * 2,
    });
  }

  function updateBalls(dt) {
    for (const b of balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += dt * 8;
      const dx = b.x - fokePos.x;
      const dy = b.y - fokePos.y;
      const dist = Math.hypot(dx, dy);
      if (!b.passed && dist < PLAYER_R + b.r) {
        b.dead = true;
        b.passed = true;
        hp -= 1;
        setHpText();
        popComic("HIT!", fokePos.x, fokePos.y - PLAYER_R - 8, "#ff8ca6");
        popSparks(fokePos.x, fokePos.y, "#ff8ca6");
        if (hp <= 0) endDrill("ko");
      } else if (!b.passed && dist < PLAYER_R + 38 && (b.vx * dx + b.vy * dy) > 0) {
        // ball just whizzed past
        b.passed = true;
        score += 1;
        if (scoreEl) scoreEl.textContent = String(score);
        if (score % 5 === 0) {
          popComic("STREAK!", fokePos.x, fokePos.y - PLAYER_R - 4, "#ffe27a");
        } else {
          popComic("WHIFF!", b.x, b.y, "#7cf0c6");
        }
        popSparks(b.x, b.y, "#7cf0c6");
      }
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.dead || b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60) balls.splice(i, 1);
    }
  }

  function updateFx(dt) {
    for (const s of sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.94;
      s.vy *= 0.94;
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    for (const t of comicTexts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
    for (let i = comicTexts.length - 1; i >= 0; i--) if (comicTexts[i].life <= 0) comicTexts.splice(i, 1);
  }

  function step(dt) {
    if (stopped) return;
    totalElapsed += dt;
    difficulty = Math.min(2.4, totalElapsed / 18);
    spawnInterval = Math.max(0.35, 1.35 - difficulty * 0.32);
    spawnBall(dt);
    updateBalls(dt);
    updateFx(dt);
  }

  function drawBackground() {
    ctx.fillStyle = "rgba(7, 11, 22, 0.6)";
    ctx.fillRect(0, 0, W, H);
    // floor grid lines for cartoon vibe
    ctx.strokeStyle = "rgba(124, 240, 198, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function drawBall(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.fillStyle = "#ff5d6e";
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI, true);
    ctx.fill();
    ctx.fillStyle = "#f5f7ff";
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI, false);
    ctx.fill();
    ctx.strokeStyle = "#0b1226";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-b.r, 0); ctx.lineTo(b.r, 0); ctx.stroke();
    ctx.fillStyle = "#f5f7ff";
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#0b1226"; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawSparks() {
    for (const s of sparks) {
      const t = s.life / s.maxLife;
      ctx.fillStyle = s.color;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2 + (1 - t) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawComicTexts() {
    for (const t of comicTexts) {
      const lifeT = t.life / t.maxLife;
      let s = 1, alpha = 1;
      if (lifeT > 0.85) { const k = (1 - lifeT) / 0.15; s = 0.5 + k * 0.7; alpha = k; }
      else if (lifeT < 0.3) { alpha = lifeT / 0.3; }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.scale(s, s);
      ctx.font = "900 22px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(7, 13, 28, 0.95)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  function drawPlayer() {
    drawCreature(ctx, card, fokePos.x, fokePos.y, PLAYER_R);
    // shadow
    ctx.fillStyle = "rgba(7, 11, 22, 0.35)";
    ctx.beginPath();
    ctx.ellipse(fokePos.x, fokePos.y + PLAYER_R + 3, PLAYER_R * 0.7, PLAYER_R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawSparks();
    for (const b of balls) drawBall(b);
    drawPlayer();
    drawComicTexts();
  }

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

  function endDrill(reason) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    awardTraining(reason);
  }

  function awardTraining(reason) {
    const remaining = totalBoostCapRemaining(champion.boosts);
    const pref = preferredTrainingStat(card);
    const breakdown = { hp: 0, atk: 0, def: 0, spd: 0 };
    // 1 boost per ~3 reps, biased toward preferred stat
    let earned = Math.min(remaining, Math.floor(score / 3));
    if (reason === "stop" && score >= 6) earned = Math.max(earned, Math.floor(score / 4));
    let pool = earned;
    // 60% goes to preferred stat (until capped), rest distributed
    const order = [pref, ...TRAINING_STAT_KEYS.filter((k) => k !== pref)];
    for (const stat of order) {
      const headroom = MAX_TRAINING_BOOST_PER_STAT - (champion.boosts[stat] || 0);
      const share = stat === pref ? Math.ceil(pool * 0.6) : Math.ceil(pool * 0.15);
      const give = Math.min(headroom, share, pool);
      breakdown[stat] = give;
      pool -= give;
      if (pool <= 0) break;
    }
    if (pool > 0) {
      // Spread leftovers wherever room exists.
      for (const stat of TRAINING_STAT_KEYS) {
        while (pool > 0 && champion.boosts[stat] + breakdown[stat] < MAX_TRAINING_BOOST_PER_STAT) {
          breakdown[stat] += 1;
          pool -= 1;
        }
        if (pool <= 0) break;
      }
    }

    const updated = {
      ...champion,
      boosts: {
        hp: clampBoost((champion.boosts.hp || 0) + breakdown.hp),
        atk: clampBoost((champion.boosts.atk || 0) + breakdown.atk),
        def: clampBoost((champion.boosts.def || 0) + breakdown.def),
        spd: clampBoost((champion.boosts.spd || 0) + breakdown.spd),
      },
    };
    championsBySite.set(site.id, updated);
    publishChampion(site.id, updated);
    renderMap();

    const lines = TRAINING_STAT_KEYS
      .filter((k) => breakdown[k] > 0)
      .map((k) => `+${breakdown[k]} ${TRAINING_STAT_LABELS[k]}`)
      .join(" • ");
    const headline = reason === "ko"
      ? `KO'd after ${score} reps`
      : `Drill ended at ${score} reps`;
    const summary = earned > 0
      ? `${headline}. Boosts gained: ${lines}.`
      : `${headline}. Need a few more reps for stat gains — try again!`;
    status.innerHTML = `<span class="success">Training complete.</span> ${escapeHtml(summary)}`;
    // swap stop button for return
    cancel.textContent = "Back to gym";
    cancel.onclick = () => {
      challenge.remove();
      activeChallenge = null;
      document.removeEventListener("keydown", onKey);
      openBattleSite(site);
    };
  }

  function closeChallenge() {
    if (!stopped) { endDrill("stop"); return; }
    challenge.remove();
    activeChallenge = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) { if (ev.key === "Escape") closeChallenge(); }
  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", closeChallenge);
  raf = requestAnimationFrame(loop);
}

const SKILL_NAMES_BY_TYPE = {
  Electric: "Volt Surge",
  Leaf: "Verdant Whip",
  Water: "Tidal Slam",
  Fire: "Ember Blast",
  Shadow: "Umbral Lance",
  Ice: "Frost Shard",
  Wind: "Cyclone Cut",
  Rock: "Boulder Drop",
  Cosmic: "Star Lance",
  Spirit: "Soul Drift",
  Bug: "Buzz Sting",
  Metal: "Iron Press",
};

function skillNameFor(card) {
  return SKILL_NAMES_BY_TYPE[card?.type] || "Power Strike";
}

function launchBattle(site, challengerCard, championBefore) {
  if (activeChallenge) return;
  if (!challengerCard) return;
  const champCard = cardsById.get(championBefore.cardId);
  if (!champCard) return;

  const attackerStats = effectiveStats(challengerCard, null);
  const defenderStats = effectiveStats(champCard, championBefore);
  const seed = seedFromStrings(
    site.id,
    profile?.name || "anon",
    challengerCard.id,
    championBefore.trainer,
    championBefore.cardId,
    String(championBefore.placedAt || 0),
    String(championBefore.defenses || 0),
    String(Date.now())
  );
  const result = simulateBattle({
    attacker: { card: challengerCard, stats: attackerStats },
    defender: { card: champCard, stats: defenderStats },
    seed,
  });

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge battle-challenge";
  challenge.innerHTML = `
    <div class="challenge-card battle-card-wrap" role="dialog" aria-modal="true" aria-label="Battle">
      <p class="eyebrow">Foké Battle</p>
      <h3 class="battle-title">${escapeHtml(challengerCard.name)} vs ${escapeHtml(champCard.name)}</h3>
      <div class="battle-roster">
        <div class="roster-side challenger">
          <p class="roster-label">Challenger • ${escapeHtml(profile?.name || "You")}</p>
          <p class="roster-name">${escapeHtml(challengerCard.name)} <span class="type-pill" style="background:${colorsFor(challengerCard).accent};color:#061226;">${escapeHtml(challengerCard.type)}</span></p>
          <div class="hp-bar"><div class="hp-fill challenger-hp" style="width:100%"></div></div>
          <small class="hp-text challenger-hp-text">${attackerStats.hp} / ${attackerStats.hp}</small>
        </div>
        <span class="vs-pill">VS</span>
        <div class="roster-side defender">
          <p class="roster-label">Champion • ${escapeHtml(championBefore.trainer)}</p>
          <p class="roster-name">${escapeHtml(champCard.name)} <span class="type-pill" style="background:${colorsFor(champCard).accent};color:#061226;">${escapeHtml(champCard.type)}</span></p>
          <div class="hp-bar"><div class="hp-fill defender-hp" style="width:100%"></div></div>
          <small class="hp-text defender-hp-text">${defenderStats.hp} / ${defenderStats.hp}</small>
        </div>
      </div>
      <div class="arena battle-arena">
        <canvas class="battle-canvas" aria-label="Battle stage"></canvas>
      </div>
      <p class="status battle-status" aria-live="polite">Combatants ready…</p>
      <div class="training-footer">
        <button class="ghost cancel">Forfeit</button>
        <button class="primary battle-continue hidden">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const canvas = challenge.querySelector(".battle-canvas");
  const arena = challenge.querySelector(".battle-arena");
  const status = challenge.querySelector(".battle-status");
  const cancel = challenge.querySelector(".cancel");
  const continueBtn = challenge.querySelector(".battle-continue");
  const challengerHpBar = challenge.querySelector(".challenger-hp");
  const defenderHpBar = challenge.querySelector(".defender-hp");
  const challengerHpText = challenge.querySelector(".challenger-hp-text");
  const defenderHpText = challenge.querySelector(".defender-hp-text");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = arena.getBoundingClientRect();
  const W = Math.max(360, Math.floor(rect.width));
  const H = Math.max(280, Math.floor(rect.height));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const FLOOR_Y = H * 0.78;
  const CHALLENGER_HOME = { x: W * 0.22, y: FLOOR_Y - 8 };
  const DEFENDER_HOME = { x: W * 0.78, y: FLOOR_Y - 14 };
  const BODY_R = Math.max(36, Math.min(56, W * 0.07));

  const challenger = {
    home: { ...CHALLENGER_HOME },
    pos: { ...CHALLENGER_HOME },
    card: challengerCard,
    hpMax: attackerStats.hp,
    hp: attackerStats.hp,
    facing: 1,
    flashTime: 0,
    shakeTime: 0,
    knockedOut: false,
    bob: 0,
  };
  const defender = {
    home: { ...DEFENDER_HOME },
    pos: { ...DEFENDER_HOME },
    card: champCard,
    hpMax: defenderStats.hp,
    hp: defenderStats.hp,
    facing: -1,
    flashTime: 0,
    shakeTime: 0,
    knockedOut: false,
    bob: 0,
  };

  const projectiles = [];
  const comicTexts = [];
  const auras = [];
  const sparks = [];
  let screenShake = 0;
  let flashWhole = 0;

  function popComic(text, x, y, color, big = false) {
    comicTexts.push({ text, x, y, vy: -55 - Math.random() * 25, life: big ? 1.4 : 1.0, maxLife: big ? 1.4 : 1.0, color, rotation: (Math.random() - 0.5) * 0.5, scaleBoost: big ? 1.6 : 1 });
    if (comicTexts.length > 8) comicTexts.shift();
  }
  function popSparks(x, y, color, n = 10, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random());
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6, maxLife: 0.6, color });
    }
  }

  // Map a typed skill to a visual effect descriptor.
  function makeSkillProjectile(fromSide, toSide, attackerCard) {
    const from = fromSide.pos;
    const to = toSide.pos;
    const colors = colorsFor(attackerCard);
    const type = attackerCard.type;
    return {
      kind: "skill",
      type,
      colors,
      x: from.x + fromSide.facing * BODY_R * 0.5,
      y: from.y - BODY_R * 0.4,
      tx: to.x,
      ty: to.y - BODY_R * 0.5,
      t: 0,
      dur: 0.55,
      attacker: attackerCard,
      done: false,
      trail: [],
    };
  }
  function makeAttackProjectile(fromSide, toSide, attackerCard) {
    const from = fromSide.pos;
    const to = toSide.pos;
    const colors = colorsFor(attackerCard);
    return {
      kind: "attack",
      type: attackerCard.type,
      colors,
      x: from.x + fromSide.facing * BODY_R * 0.5,
      y: from.y - BODY_R * 0.4,
      tx: to.x,
      ty: to.y - BODY_R * 0.5,
      t: 0,
      dur: 0.38,
      done: false,
      trail: [],
    };
  }

  function drawArc(proj) {
    const t = proj.t / proj.dur;
    const x = proj.x + (proj.tx - proj.x) * t;
    const arcLift = -110 * Math.sin(Math.PI * t) * (proj.kind === "skill" ? 1 : 0.7);
    const y = proj.y + (proj.ty - proj.y) * t + arcLift;
    return { x, y, t };
  }

  function drawProjectile(proj) {
    const { x, y, t } = drawArc(proj);
    proj.trail.push({ x, y, life: 0.25 });
    if (proj.trail.length > 16) proj.trail.shift();
    for (let i = 0; i < proj.trail.length; i++) {
      const tr = proj.trail[i];
      tr.life -= 0.04;
      const alpha = Math.max(0, tr.life / 0.25) * (i / proj.trail.length);
      if (alpha <= 0) continue;
      ctx.fillStyle = proj.colors.accent;
      ctx.globalAlpha = alpha * 0.6;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, (proj.kind === "skill" ? 9 : 6) * (i / proj.trail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (proj.kind === "skill") {
      drawSkillVisual(proj.type, proj.colors, x, y, t);
    } else {
      drawAttackVisual(proj.colors, x, y, t);
    }
  }

  function drawAttackVisual(colors, x, y, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * Math.PI * 4);
    ctx.fillStyle = colors.light;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawSkillVisual(type, colors, x, y, t) {
    ctx.save();
    ctx.translate(x, y);
    const pulse = 1 + Math.sin(t * Math.PI * 6) * 0.1;
    if (type === "Electric") {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      let px = -16, py = -10;
      ctx.moveTo(px, py);
      for (let i = 0; i < 4; i++) {
        px += 9 + Math.random() * 4;
        py += (Math.random() - 0.5) * 14;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = "#fff48a";
      ctx.shadowColor = colors.accent;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (type === "Fire") {
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 22);
      grad.addColorStop(0, "#fff2a8");
      grad.addColorStop(0.6, colors.accent);
      grad.addColorStop(1, "rgba(255, 90, 20, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 8;
        ctx.fillStyle = "rgba(255, 200, 90, 0.7)";
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === "Water" || type === "Ice") {
      ctx.fillStyle = colors.accent;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + t * 4;
        const r = 14 * pulse;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colors.light;
      ctx.beginPath(); ctx.arc(0, 0, 7 * pulse, 0, Math.PI * 2); ctx.fill();
    } else if (type === "Leaf") {
      ctx.fillStyle = colors.accent;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + t * 6;
        ctx.save();
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(14, 0, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (type === "Rock" || type === "Metal") {
      ctx.fillStyle = colors.dark;
      ctx.strokeStyle = "#0b1226";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const ang = (i / sides) * Math.PI * 2 + t * 1.2;
        const r = 14 + Math.sin(t * 8 + i) * 2;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (type === "Wind") {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const r = 8 + i * 6;
        ctx.arc(0, 0, r, t * 4, t * 4 + Math.PI * 1.4);
        ctx.stroke();
      }
    } else if (type === "Cosmic" || type === "Spirit" || type === "Shadow") {
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
      grad.addColorStop(0, "#fff");
      grad.addColorStop(0.4, colors.accent);
      grad.addColorStop(1, "rgba(20, 0, 60, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, 20 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "900 18px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", 0, 0);
    } else if (type === "Bug") {
      ctx.fillStyle = colors.accent;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + t * 10;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * 9, Math.sin(ang) * 9, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = colors.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSideFokemon(side, dt) {
    side.bob += dt;
    let drawX = side.pos.x;
    let drawY = side.pos.y - BODY_R - 4 + Math.sin(side.bob * 3) * 2.5;
    if (side.shakeTime > 0) {
      drawX += (Math.random() - 0.5) * 8;
      drawY += (Math.random() - 0.5) * 4;
    }
    // shadow
    ctx.fillStyle = "rgba(7, 11, 22, 0.45)";
    ctx.beginPath();
    ctx.ellipse(side.pos.x, side.pos.y + 4, BODY_R * 0.75, BODY_R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // KO fade
    let alpha = 1;
    if (side.knockedOut) {
      const t = Math.min(1, side.koTime / 0.9);
      alpha = 1 - t;
      drawY += t * 24;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    if (side.facing < 0) {
      ctx.translate(drawX, drawY);
      ctx.scale(-1, 1);
      drawCreature(ctx, side.card, 0, 0, BODY_R);
    } else {
      drawCreature(ctx, side.card, drawX, drawY, BODY_R);
    }
    ctx.restore();
    // Flash overlay
    if (side.flashTime > 0) {
      const t = side.flashTime / 0.35;
      ctx.fillStyle = `rgba(255, 240, 200, ${t * 0.55})`;
      ctx.beginPath();
      ctx.arc(drawX, drawY, BODY_R * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (side.shakeTime > 0) side.shakeTime = Math.max(0, side.shakeTime - dt);
    if (side.flashTime > 0) side.flashTime = Math.max(0, side.flashTime - dt);
  }

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(80, 70, 160, 0.4)");
    grad.addColorStop(1, "rgba(7, 11, 22, 0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // floor
    const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    floorGrad.addColorStop(0, "rgba(124, 240, 198, 0.25)");
    floorGrad.addColorStop(1, "rgba(7, 11, 22, 0.85)");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    // floor stripe
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(W, FLOOR_Y);
    ctx.stroke();
  }

  function drawAuras(dt) {
    for (const a of auras) {
      a.t += dt;
      const p = a.t / a.dur;
      if (p >= 1) continue;
      const r = a.r * (1 + p * 1.4);
      ctx.strokeStyle = a.color;
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = auras.length - 1; i >= 0; i--) if (auras[i].t >= auras[i].dur) auras.splice(i, 1);
  }

  function drawSparksLayer(dt) {
    for (const s of sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.92;
      s.vy *= 0.92;
      s.vy += 360 * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    for (const s of sparks) {
      const t = s.life / s.maxLife;
      ctx.fillStyle = s.color;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4 + (1 - t) * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawComicTexts(dt) {
    for (const t of comicTexts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
    for (let i = comicTexts.length - 1; i >= 0; i--) if (comicTexts[i].life <= 0) comicTexts.splice(i, 1);
    for (const t of comicTexts) {
      const lifeT = t.life / t.maxLife;
      let s = 1, alpha = 1;
      if (lifeT > 0.85) { const k = (1 - lifeT) / 0.15; s = 0.45 + k * 0.85; alpha = k; }
      else if (lifeT < 0.3) { alpha = lifeT / 0.3; s = 1.05; }
      else s = 1.1;
      s *= t.scaleBoost || 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.scale(s, s);
      ctx.font = "900 22px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(7, 13, 28, 0.95)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  function drawAll(dt) {
    ctx.save();
    if (screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * screenShake * 10, (Math.random() - 0.5) * screenShake * 10);
      screenShake = Math.max(0, screenShake - dt * 4);
    }
    drawBackground();
    drawAuras(dt);
    drawSideFokemon(challenger, dt);
    drawSideFokemon(defender, dt);
    for (const p of projectiles) {
      p.t += dt;
      drawProjectile(p);
    }
    drawSparksLayer(dt);
    drawComicTexts(dt);
    if (flashWhole > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashWhole})`;
      ctx.fillRect(0, 0, W, H);
      flashWhole = Math.max(0, flashWhole - dt * 3);
    }
    ctx.restore();
  }

  function setHpBar(side, kind) {
    const pct = Math.max(0, (side.hp / side.hpMax) * 100);
    const bar = kind === "challenger" ? challengerHpBar : defenderHpBar;
    const txt = kind === "challenger" ? challengerHpText : defenderHpText;
    if (bar) bar.style.width = `${pct}%`;
    if (txt) txt.textContent = `${Math.max(0, Math.round(side.hp))} / ${side.hpMax}`;
    if (bar) bar.classList.toggle("low", pct < 30);
  }

  function attackEntry(entry) {
    const isAttackerChallenger = entry.attacker === "attacker";
    const atkSide = isAttackerChallenger ? challenger : defender;
    const defSide = isAttackerChallenger ? defender : challenger;
    const atkCard = atkSide.card;

    // wind-up: bounce attacker
    const windup = 0.32;
    const recoverAt = windup + (entry.move === "skill" ? 0.55 : 0.4);

    return {
      duration: recoverAt + 0.45,
      atkSide,
      defSide,
      entry,
      started: false,
      projectileSpawned: false,
      hit: false,
    };
  }

  function ensureBodyAt(side, x, y) {
    side.pos.x = x;
    side.pos.y = y;
  }

  function applyHit(state) {
    const { entry, defSide } = state;
    const isAttackerChallenger = entry.attacker === "attacker";
    const newHp = isAttackerChallenger ? result.log[state.idx].defenderHp : result.log[state.idx].defenderHp;
    void newHp;
    if (entry.dodged) {
      defSide.shakeTime = 0.15;
      popComic("MISS!", defSide.pos.x, defSide.pos.y - BODY_R - 16, "#cdd6f0");
      return;
    }
    defSide.hp = entry.defenderHp;
    defSide.flashTime = 0.35;
    defSide.shakeTime = 0.32;
    setHpBar(defSide, defSide === challenger ? "challenger" : "defender");
    popSparks(defSide.pos.x, defSide.pos.y - BODY_R * 0.5, state.atkSide.card.type === "Fire" ? "#ffb185" : colorsFor(state.atkSide.card).accent, entry.crit ? 22 : 14);
    const colors = colorsFor(state.atkSide.card);
    auras.push({ x: defSide.pos.x, y: defSide.pos.y - BODY_R * 0.4, r: BODY_R * 0.9, dur: 0.45, t: 0, color: colors.accent });
    const word = entry.move === "skill"
      ? entry.crit ? "CRIT!" : "ZWAP!"
      : entry.crit ? "CRIT!" : ["POW!", "BAM!", "ZAP!", "WHACK!"][Math.floor(Math.random() * 4)];
    popComic(`${word} -${entry.damage}`, defSide.pos.x, defSide.pos.y - BODY_R - 20, entry.crit ? "#ffe27a" : "#ff8ca6", entry.crit);
    if (entry.effective === "super") popComic("SUPER!", defSide.pos.x, defSide.pos.y - BODY_R - 44, "#7cf0c6");
    if (entry.effective === "weak") popComic("weak…", defSide.pos.x, defSide.pos.y - BODY_R - 44, "#9fb0d9");
    screenShake = entry.crit ? 0.9 : entry.move === "skill" ? 0.65 : 0.35;
    if (entry.move === "skill") flashWhole = 0.35;
    if (defSide.hp <= 0) {
      defSide.knockedOut = true;
      defSide.koTime = 0;
      popComic("K.O.!", defSide.pos.x, defSide.pos.y - BODY_R - 50, "#ffd166", true);
      screenShake = 1.1;
    }
  }

  let queue = [];
  result.log.forEach((entry, idx) => {
    const state = attackEntry(entry);
    state.idx = idx;
    queue.push(state);
  });

  let current = null;
  let phaseT = 0;
  let raf = 0;
  let last = performance.now();
  let battleOver = false;

  function advance() {
    current = queue.shift() || null;
    phaseT = 0;
    if (current) {
      const moveLabel = current.entry.move === "skill" ? skillNameFor(current.atkSide.card) : "Quick Strike";
      const who = current.entry.attacker === "attacker" ? challengerCard.name : champCard.name;
      const effectivenessNote = current.entry.dodged
        ? " — but it missed!"
        : current.entry.effective === "super" ? " — super effective!"
        : current.entry.effective === "weak" ? " — not very effective."
        : "";
      status.innerHTML = `<strong>${escapeHtml(who)}</strong> used <em>${escapeHtml(moveLabel)}</em>${escapeHtml(effectivenessNote)}`;
    } else if (!battleOver) {
      finishBattle();
    }
  }

  function tickPhase(dt) {
    if (!current) return;
    phaseT += dt;
    const entry = current.entry;
    const atkHome = current.atkSide === challenger ? CHALLENGER_HOME : DEFENDER_HOME;

    // wind-up: lunge slightly forward
    const lunge = Math.min(1, phaseT / 0.22);
    const lungeOffset = current.atkSide.facing * 18 * lunge * (1 - lunge);
    ensureBodyAt(current.atkSide, atkHome.x + lungeOffset, atkHome.y);

    if (!current.projectileSpawned && phaseT >= 0.22) {
      current.projectileSpawned = true;
      const proj = entry.move === "skill"
        ? makeSkillProjectile(current.atkSide, current.defSide, current.atkSide.card)
        : makeAttackProjectile(current.atkSide, current.defSide, current.atkSide.card);
      proj.onHit = () => {
        if (current.hit) return;
        current.hit = true;
        applyHit(current);
      };
      projectiles.push(proj);
    }

    // hand off when this turn's projectile is done and a small recovery delay passes
    if (current.hit && phaseT >= 0.22 + 0.55 + 0.35) {
      // small pause before next turn
      if (current.defSide.knockedOut && current.defSide.koTime > 0.8) {
        battleOver = true;
        current = null;
        finishBattle();
        return;
      }
      advance();
    }
  }

  function tickProjectiles(dt) {
    for (const p of projectiles) {
      if (p.done) continue;
      if (p.t >= p.dur && !p.exploded) {
        p.exploded = true;
        p.done = true;
        if (typeof p.onHit === "function") p.onHit();
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (projectiles[i].done && projectiles[i].t > projectiles[i].dur + 0.2) projectiles.splice(i, 1);
    }
  }

  function finishBattle() {
    if (current) return;
    // resolve outcome
    const challengerWon = result.winner === "attacker";
    let summary;
    let winnerName;
    if (challengerWon) {
      winnerName = profile?.name || "Challenger";
      const placedAt = Date.now();
      const newChampion = {
        trainer: profile.name,
        team: profile.team || "mint",
        cardId: challengerCard.id,
        boosts: { hp: 0, atk: 0, def: 0, spd: 0 },
        defenses: 0,
        placedAt,
        lastBattleAt: placedAt,
      };
      championsBySite.set(site.id, newChampion);
      publishChampion(site.id, newChampion);
      summary = `${escapeHtml(challengerCard.name)} dethroned ${escapeHtml(champCard.name)}. ${escapeHtml(profile?.name || "")} is the new champion of ${escapeHtml(battleSiteName(site.id))}!`;
    } else {
      winnerName = championBefore.trainer;
      const updated = {
        ...championBefore,
        defenses: (championBefore.defenses || 0) + 1,
        lastBattleAt: Date.now(),
      };
      // If defending pushes them past the cap, the next champion poll will retire them.
      championsBySite.set(site.id, updated);
      publishChampion(site.id, updated);
      summary = `${escapeHtml(champCard.name)} held their ground. ${escapeHtml(championBefore.trainer)} keeps ${escapeHtml(battleSiteName(site.id))} (defenses: ${updated.defenses}/${MAX_CHAMPION_DEFENSES}).`;
    }
    publishBattleEvent({
      ts: Date.now(),
      site: site.id,
      siteName: battleSiteName(site.id),
      challenger: profile?.name || "anon",
      challengerCard: challengerCard.name,
      defender: championBefore.trainer,
      defenderCard: champCard.name,
      winner: winnerName,
      challengerWon,
    });
    renderMap();
    status.innerHTML = `<span class="${challengerWon ? "success" : "fail"}">${challengerWon ? "Victory!" : "Defeat!"}</span> ${summary}`;
    cancel.classList.add("hidden");
    continueBtn.classList.remove("hidden");
    continueBtn.addEventListener("click", () => {
      challenge.remove();
      activeChallenge = null;
      document.removeEventListener("keydown", onKey);
    });
  }

  function loop(now) {
    if (!document.body.contains(challenge)) return;
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    if (challenger.knockedOut) challenger.koTime = (challenger.koTime || 0) + dt;
    if (defender.knockedOut) defender.koTime = (defender.koTime || 0) + dt;
    tickProjectiles(dt);
    tickPhase(dt);
    drawAll(dt);
    raf = requestAnimationFrame(loop);
  }

  function closeChallenge() {
    cancelAnimationFrame(raf);
    challenge.remove();
    activeChallenge = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(ev) { if (ev.key === "Escape") closeChallenge(); }
  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", closeChallenge);

  // intro pause then kick off
  setHpBar(challenger, "challenger");
  setHpBar(defender, "defender");
  setTimeout(advance, 600);
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
  if (debugLocation) {
    hideLocationModal();
    onPositionUpdate({ coords: { latitude: debugLocation.lat, longitude: debugLocation.lng } });
    updateLocationStatus(`Debug • ${debugLocation.lat.toFixed(5)}, ${debugLocation.lng.toFixed(5)}`, "live");
    return;
  }
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

let debugLocation = safeStorageGet("fokemon_debug_location", null);
function isValidLatLng(v) {
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;
}
if (!isValidLatLng(debugLocation)) debugLocation = null;

function persistDebugLocation() {
  try {
    if (debugLocation) localStorage.setItem("fokemon_debug_location", JSON.stringify(debugLocation));
    else localStorage.removeItem("fokemon_debug_location");
  } catch {}
}

function applyDebugLocation(loc) {
  if (!isValidLatLng(loc)) return;
  debugLocation = { lat: loc.lat, lng: loc.lng };
  persistDebugLocation();
  if (typeof navigator !== "undefined" && navigator.geolocation && watchId !== null) {
    try { navigator.geolocation.clearWatch(watchId); } catch {}
    watchId = null;
  }
  onPositionUpdate({ coords: { latitude: loc.lat, longitude: loc.lng } });
  updateLocationStatus(`Debug • ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`, "live");
  renderDebugChip();
}

function clearDebugLocation() {
  debugLocation = null;
  persistDebugLocation();
  renderDebugChip();
  if (typeof navigator !== "undefined" && navigator.geolocation && locationGranted) {
    startLocationTracking();
  }
}

function renderDebugChip() {
  if (typeof document === "undefined") return;
  let chip = document.getElementById("debugLocChip");
  if (!debugLocation) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement("button");
    chip.id = "debugLocChip";
    chip.className = "debug-loc-chip";
    chip.type = "button";
    chip.title = "Debug location active — click to clear";
    chip.addEventListener("click", clearDebugLocation);
    document.body.appendChild(chip);
  }
  chip.textContent = `🐛 DEBUG LOC ${debugLocation.lat.toFixed(4)}, ${debugLocation.lng.toFixed(4)}`;
}

function openDebugLocationDialog() {
  if (document.getElementById("debugLocDialog")) return;
  const overlay = document.createElement("div");
  overlay.id = "debugLocDialog";
  overlay.className = "modal";
  const current = debugLocation || playerLocation || { lat: 0, lng: 0 };
  overlay.innerHTML = `
    <div class="modal-card">
      <p class="eyebrow">Debug tools</p>
      <h2>Override location</h2>
      <p>Pin yourself to any coordinates for testing. Geolocation is suppressed until you clear it.</p>
      <label style="text-align:left;">Latitude
        <input id="dbgLat" type="number" step="0.0001" value="${current.lat || 0}" />
      </label>
      <label style="text-align:left;">Longitude
        <input id="dbgLng" type="number" step="0.0001" value="${current.lng || 0}" />
      </label>
      <div class="debug-presets">
        <button type="button" class="ghost" data-lat="51.5074" data-lng="-0.1278">London</button>
        <button type="button" class="ghost" data-lat="40.7589" data-lng="-73.9851">NYC</button>
        <button type="button" class="ghost" data-lat="35.6762" data-lng="139.6503">Tokyo</button>
        <button type="button" class="ghost" data-lat="37.7749" data-lng="-122.4194">SF</button>
      </div>
      <div class="debug-actions">
        <button type="button" class="ghost dbg-cancel">Cancel</button>
        ${debugLocation ? `<button type="button" class="ghost dbg-clear">Clear override</button>` : ""}
        <button type="button" class="dbg-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const latInput = overlay.querySelector("#dbgLat");
  const lngInput = overlay.querySelector("#dbgLng");
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(ev) { if (ev.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelectorAll(".debug-presets button").forEach((btn) => {
    btn.addEventListener("click", () => {
      latInput.value = btn.dataset.lat;
      lngInput.value = btn.dataset.lng;
    });
  });
  overlay.querySelector(".dbg-cancel").addEventListener("click", close);
  overlay.querySelector(".dbg-clear")?.addEventListener("click", () => {
    clearDebugLocation();
    close();
  });
  overlay.querySelector(".dbg-apply").addEventListener("click", () => {
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    applyDebugLocation({ lat, lng });
    close();
  });
}

if (typeof window !== "undefined") {
  window.fokeDebug = {
    setLocation(lat, lng) { applyDebugLocation({ lat, lng }); return debugLocation; },
    clearLocation() { clearDebugLocation(); return null; },
    getLocation() { return debugLocation; },
    open() { openDebugLocationDialog(); },
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (ev) => {
    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && ev.shiftKey && (ev.key === "L" || ev.key === "l")) {
      ev.preventDefault();
      openDebugLocationDialog();
    }
  });
}

async function bootstrapLocation() {
  if (debugLocation) {
    hideLocationModal();
    onPositionUpdate({ coords: { latitude: debugLocation.lat, longitude: debugLocation.lng } });
    updateLocationStatus(`Debug • ${debugLocation.lat.toFixed(5)}, ${debugLocation.lng.toFixed(5)}`, "live");
    renderDebugChip();
    return;
  }
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

function normalizeChampion(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.cardId || !raw.trainer || !raw.placedAt) return null;
  const champ = {
    trainer: String(raw.trainer),
    team: raw.team || "mint",
    cardId: String(raw.cardId),
    boosts: {
      hp: clampBoost(raw?.boosts?.hp ?? 0),
      atk: clampBoost(raw?.boosts?.atk ?? 0),
      def: clampBoost(raw?.boosts?.def ?? 0),
      spd: clampBoost(raw?.boosts?.spd ?? 0),
    },
    defenses: Math.max(0, Math.min(MAX_CHAMPION_DEFENSES, Number(raw.defenses) || 0)),
    placedAt: Number(raw.placedAt) || Date.now(),
    lastBattleAt: Number(raw.lastBattleAt) || 0,
  };
  if (!cardsById.has(champ.cardId)) return null;
  return champ;
}

function subscribeChampionUpdates() {
  if (!battleSitesNode) return;
  const wanted = new Set(currentBattleSites.map((s) => s.id));
  for (const id of subscribedChampionSites) {
    if (!wanted.has(id)) {
      try { battleSitesNode.get(id).off(); } catch {}
      subscribedChampionSites.delete(id);
      championsBySite.delete(id);
    }
  }
  currentBattleSites.forEach((site) => {
    if (subscribedChampionSites.has(site.id)) return;
    subscribedChampionSites.add(site.id);
    battleSitesNode.get(site.id).on((raw) => {
      const champ = normalizeChampion(raw);
      if (!champ) {
        if (championsBySite.has(site.id)) {
          championsBySite.delete(site.id);
          renderMap();
          refreshOpenSitePanel(site.id);
        }
        return;
      }
      if (isChampionRetired(champ)) {
        championsBySite.delete(site.id);
        // Auto-clear stale champion record so the site re-opens.
        try { battleSitesNode.get(site.id).put(null); } catch {}
        renderMap();
        refreshOpenSitePanel(site.id);
        return;
      }
      const existing = championsBySite.get(site.id);
      const sig = JSON.stringify(champ);
      const existingSig = existing ? JSON.stringify(existing) : "";
      if (sig === existingSig) return;
      championsBySite.set(site.id, champ);
      renderMap();
      refreshOpenSitePanel(site.id);
    });
  });
}

function publishChampion(siteId, champion) {
  if (!battleSitesNode) return;
  try {
    battleSitesNode.get(siteId).put({
      trainer: champion.trainer,
      team: champion.team,
      cardId: champion.cardId,
      boosts: { ...champion.boosts },
      defenses: champion.defenses,
      placedAt: champion.placedAt,
      lastBattleAt: champion.lastBattleAt || 0,
    });
  } catch {}
}

function publishChampionRemoved(siteId) {
  if (!battleSitesNode) return;
  try { battleSitesNode.get(siteId).put(null); } catch {}
}

function publishBattleEvent(event) {
  if (!battleEventsNode) return;
  try { battleEventsNode.set(event); } catch {}
}

function initGun() {
  if (typeof window === "undefined" || typeof window.Gun !== "function") return;
  try {
    const gun = window.Gun({ peers: GUN_PEERS, localStorage: true });
    const root = gun.get("fokemon");
    eventsNode = root.get("events");
    gridCaughtNode = root.get("caughtByGrid");
    battleSitesNode = root.get("battleSites");
    battleEventsNode = root.get("battleEvents");
    connectFeed();
    connectGridCaught();
    subscribeChampionUpdates();
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
  renderDebugChip();
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
