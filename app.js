import {
  computePoiPlacements,
  computeSpawnPlacements,
  computeBattleSitePlacements,
  battleSiteName,
  siteTheme,
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
  makeInstanceUid,
  migrateCaughtEntries,
  availableInstances,
  deployedInstanceAtSite,
  mergeBoosts,
  normalizeBoosts,
  serializeTradeOffer,
  parseTradeOffer,
  COLLECTION_SORTS,
  groupCollection,
  flattenCollectionGroups,
  mergeTrainerLocation,
  TRADE_DISCOVERY_TTL_MS,
  PRESENCE_TTL_MS,
} from "./app.logic.js";

const TRADE_RANGE_METERS = 200;
const TRADE_REQUEST_TTL_MS = 5 * 60 * 1000;
// Idle trainers publish a lightweight {lat,lng,ts} heartbeat this often so
// they stay discoverable for trading even when not catching anything. One
// node per trainer, written with .put() (overwrite, not .set()/append), so
// presence never grows the datastore the way the events feed would.
const PRESENCE_HEARTBEAT_MS = 45 * 1000;

const SPAWN_INTERVAL_MS = 3 * 60 * 1000;
const MAX_SPAWNS = 4;
const CATCH_RANGE_METERS = 80;
const POI_RANGE_METERS = CATCH_RANGE_METERS;
const BATTLE_SITE_RANGE_METERS = 100;
const STARTING_FOKEBALLS = 5;
const MAX_POI_REWARD = 8;
// Below this zoom level the map shows only the world + player marker — too many
// entities to draw otherwise. 15 is street-level (a few hundred meters across).
const NEARBY_ZOOM_THRESHOLD = 15;
const RECENTER_ZOOM = 18;
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
let presenceNode = null;
let lastPresenceSentAt = 0;

const cards = [
  // Electric ----------------------------------------------------------------
  { id: "voltlynx", name: "VoltLynx", type: "Electric", rarity: "rare",
    body: "tall", ears: "pointy", accent: "lightning",
    markings: "stripes", expression: "fierce",
    hp: 58, atk: 72, def: 44, spd: 88,
    flavor: "Skittish hunter with arc-static fur. Sparks when surprised." },
  { id: "sparkit", name: "Sparkit", type: "Electric", rarity: "common",
    body: "round", ears: "tufted", accent: "lightning",
    markings: "blush", expression: "happy",
    hp: 46, atk: 58, def: 38, spd: 80,
    flavor: "Cheeky pocket-sized live wire. Stores static in fluffy cheeks." },
  { id: "thundake", name: "Thundake", type: "Electric", rarity: "epic",
    body: "tall", ears: "crest", accent: "wings",
    markings: "mask", expression: "grin",
    hp: 68, atk: 90, def: 52, spd: 92,
    flavor: "Rides storm fronts and re-routes lightning for fun." },
  // Leaf --------------------------------------------------------------------
  { id: "mossaur", name: "Mossaur", type: "Leaf", rarity: "common",
    body: "wide", ears: "horn", accent: "leaf",
    markings: "belly", expression: "calm",
    hp: 84, atk: 56, def: 70, spd: 38,
    flavor: "Grazes in tall meadows; sheds fresh sprouts each dawn." },
  { id: "petalune", name: "Petalune", type: "Leaf", rarity: "common",
    body: "round", ears: "round", accent: "petal",
    markings: "blush", expression: "happy",
    hp: 60, atk: 48, def: 58, spd: 66,
    flavor: "Carries a single perfect petal it refuses to drop." },
  { id: "boscarapod", name: "Boscarapod", type: "Leaf", rarity: "epic",
    body: "stocky", ears: "crest", accent: "vines",
    markings: "stripes", expression: "smirk",
    hp: 92, atk: 78, def: 88, spd: 32,
    flavor: "An old grove walking. Birds nest between its shoulders." },
  // Water -------------------------------------------------------------------
  { id: "aquaphin", name: "AquaPhin", type: "Water", rarity: "common",
    body: "round", ears: "fin", accent: "droplet",
    markings: "belly", expression: "smile",
    hp: 64, atk: 60, def: 58, spd: 70,
    flavor: "Surfs warm rain currents above the asphalt." },
  { id: "tideroe", name: "Tideroe", type: "Water", rarity: "common",
    body: "blob", ears: "fin", accent: "bubble",
    markings: "spots", expression: "happy",
    hp: 70, atk: 52, def: 64, spd: 58,
    flavor: "Bobs along gutter rivers, blowing perfect glass bubbles." },
  { id: "marlumi", name: "Marlumi", type: "Water", rarity: "rare",
    body: "long", ears: "antenna", accent: "lantern",
    markings: "spots", expression: "grin",
    hp: 62, atk: 76, def: 50, spd: 68,
    flavor: "Dangles its lure-light in dark drains, fishing for moths." },
  // Fire --------------------------------------------------------------------
  { id: "emberoo", name: "Emberoo", type: "Fire", rarity: "rare",
    body: "round", ears: "pointy", accent: "flame",
    markings: "blush", expression: "grin",
    hp: 54, atk: 80, def: 40, spd: 78,
    flavor: "Hops between sun-baked rooftops, leaving scorch prints." },
  { id: "cindash", name: "Cindash", type: "Fire", rarity: "common",
    body: "tall", ears: "tufted", accent: "ember-trail",
    markings: "stripes", expression: "fierce",
    hp: 50, atk: 70, def: 36, spd: 84,
    flavor: "A quick-step pup that leaves a wake of glowing embers." },
  { id: "vulpyre", name: "Vulpyre", type: "Fire", rarity: "epic",
    body: "tall", ears: "pointy", accent: "tail-curl",
    markings: "mask", expression: "smirk",
    hp: 62, atk: 92, def: 50, spd: 86,
    flavor: "Nine-tongued flame fox. Bows once before it scorches you." },
  // Shadow ------------------------------------------------------------------
  { id: "cryptowl", name: "CryptOwl", type: "Shadow", rarity: "epic",
    body: "tall", ears: "horn", accent: "ghost",
    markings: "mask", expression: "fierce",
    hp: 50, atk: 86, def: 46, spd: 76,
    flavor: "Stares from places no light is meant to reach." },
  { id: "umbrette", name: "Umbrette", type: "Shadow", rarity: "common",
    body: "blob", ears: "none", accent: "third-eye",
    markings: "spots", expression: "sleepy",
    hp: 58, atk: 60, def: 54, spd: 56,
    flavor: "Pools under streetlamps. Blinks once, slow, when watched." },
  { id: "nightwing", name: "Nightwing", type: "Shadow", rarity: "rare",
    body: "tall", ears: "swept", accent: "wings",
    markings: "mask", expression: "smirk",
    hp: 54, atk: 78, def: 48, spd: 82,
    flavor: "Folds itself into alley shadows; pops out two blocks later." },
  // Ice ---------------------------------------------------------------------
  { id: "frostbun", name: "Frostbun", type: "Ice", rarity: "common",
    body: "round", ears: "round", accent: "snowflake",
    markings: "belly", expression: "happy",
    hp: 66, atk: 50, def: 70, spd: 60,
    flavor: "Wrapped in a perpetual chilly fog that smells of mint." },
  { id: "glaceel", name: "Glaceel", type: "Ice", rarity: "rare",
    body: "long", ears: "fin", accent: "shard",
    markings: "stripes", expression: "calm",
    hp: 60, atk: 72, def: 56, spd: 74,
    flavor: "Glides between frost patches like a ribbon of cold light." },
  { id: "crystag", name: "Crystag", type: "Ice", rarity: "epic",
    body: "tall", ears: "horn", accent: "crystal",
    markings: "belly", expression: "fierce",
    hp: 80, atk: 84, def: 78, spd: 64,
    flavor: "Antlers grow new crystals overnight. Drops them at dawn." },
  // Wind --------------------------------------------------------------------
  { id: "gustling", name: "Gustling", type: "Wind", rarity: "rare",
    body: "blob", ears: "antenna", accent: "swirl",
    markings: "none", expression: "grin",
    hp: 48, atk: 64, def: 38, spd: 98,
    flavor: "Zips through alleyways riding the breeze it brewed itself." },
  { id: "cumulurr", name: "Cumulurr", type: "Wind", rarity: "common",
    body: "blob", ears: "none", accent: "cloud",
    markings: "blush", expression: "sleepy",
    hp: 64, atk: 44, def: 52, spd: 72,
    flavor: "A drifting cloud nap. Drizzles when startled." },
  { id: "zephyrm", name: "Zephyrm", type: "Wind", rarity: "epic",
    body: "tall", ears: "swept", accent: "wings",
    markings: "stripes", expression: "grin",
    hp: 56, atk: 80, def: 48, spd: 96,
    flavor: "Outruns its own shadow. Sometimes courteously waits up." },
  // Rock --------------------------------------------------------------------
  { id: "pebbloid", name: "Pebbloid", type: "Rock", rarity: "common",
    body: "wide", ears: "none", accent: "pebble",
    markings: "spots", expression: "calm",
    hp: 96, atk: 60, def: 92, spd: 26,
    flavor: "Slow but stubbornly unmovable. Disguises itself as scenery." },
  { id: "boulderp", name: "Boulderp", type: "Rock", rarity: "common",
    body: "stocky", ears: "horn", accent: "spike-back",
    markings: "stripes", expression: "smirk",
    hp: 88, atk: 70, def: 84, spd: 30,
    flavor: "Headbutts first, considers consequences later. Maybe." },
  { id: "magmatar", name: "Magmatar", type: "Rock", rarity: "rare",
    body: "wide", ears: "horn", accent: "ember-trail",
    markings: "stripes", expression: "fierce",
    hp: 92, atk: 84, def: 80, spd: 36,
    flavor: "Half rock, half lava. Heats its bedroom rock all winter." },
  // Cosmic ------------------------------------------------------------------
  { id: "nebulime", name: "Nebulime", type: "Cosmic", rarity: "epic",
    body: "round", ears: "antenna", accent: "star",
    markings: "spots", expression: "calm",
    hp: 60, atk: 78, def: 54, spd: 74,
    flavor: "A whisper of starlight wearing fur. Hums at 432Hz." },
  { id: "nebleek", name: "Nebleek", type: "Cosmic", rarity: "common",
    body: "round", ears: "round", accent: "crescent",
    markings: "spots", expression: "sleepy",
    hp: 54, atk: 58, def: 52, spd: 64,
    flavor: "Naps in skylight beams. Sneezes faint comets." },
  { id: "astralope", name: "Astralope", type: "Cosmic", rarity: "epic",
    body: "tall", ears: "horn", accent: "halo",
    markings: "stripes", expression: "smirk",
    hp: 72, atk: 84, def: 60, spd: 88,
    flavor: "Leaps between constellations. Sometimes lands in your yard." },
  // Spirit ------------------------------------------------------------------
  { id: "spectrip", name: "Spectrip", type: "Spirit", rarity: "rare",
    body: "tall", ears: "none", accent: "ghost",
    markings: "none", expression: "sleepy",
    hp: 56, atk: 70, def: 50, spd: 72,
    flavor: "Drifts past clocks that have started running slow." },
  { id: "wispette", name: "Wispette", type: "Spirit", rarity: "common",
    body: "blob", ears: "none", accent: "halo",
    markings: "none", expression: "happy",
    hp: 44, atk: 58, def: 42, spd: 70,
    flavor: "A friendly will-o'-the-wisp who hates being alone." },
  { id: "halofly", name: "Halofly", type: "Spirit", rarity: "rare",
    body: "round", ears: "antenna", accent: "halo",
    markings: "blush", expression: "grin",
    hp: 52, atk: 72, def: 48, spd: 80,
    flavor: "Tiny seraph moth. Its halo doubles as a nightlight." },
  // Bug ---------------------------------------------------------------------
  { id: "buzzwick", name: "Buzzwick", type: "Bug", rarity: "common",
    body: "round", ears: "antenna", accent: "sparkle",
    markings: "stripes", expression: "happy",
    hp: 52, atk: 66, def: 44, spd: 86,
    flavor: "Carries embers between flowers without scorching a petal." },
  { id: "pollybit", name: "Pollybit", type: "Bug", rarity: "common",
    body: "round", ears: "antenna", accent: "petal",
    markings: "spots", expression: "happy",
    hp: 50, atk: 56, def: 48, spd: 80,
    flavor: "Dusted in golden pollen. Sneezes summon dandelions." },
  { id: "mantazz", name: "Mantazz", type: "Bug", rarity: "rare",
    body: "tall", ears: "antenna", accent: "claw",
    markings: "stripes", expression: "fierce",
    hp: 56, atk: 84, def: 50, spd: 78,
    flavor: "Folds two scythes politely behind its back. Until it doesn't." },
  // Metal -------------------------------------------------------------------
  { id: "chromite", name: "Chromite", type: "Metal", rarity: "epic",
    body: "wide", ears: "horn", accent: "gear",
    markings: "stripes", expression: "smirk",
    hp: 84, atk: 72, def: 96, spd: 38,
    flavor: "A polished little tank with a surprisingly gentle hum." },
  { id: "cogwarm", name: "Cogwarm", type: "Metal", rarity: "common",
    body: "round", ears: "antenna", accent: "gear",
    markings: "spots", expression: "happy",
    hp: 60, atk: 54, def: 78, spd: 42,
    flavor: "Hums like a clockwork heart. Polishes itself when bored." },
  { id: "aegismite", name: "Aegismite", type: "Metal", rarity: "epic",
    body: "stocky", ears: "crest", accent: "shield",
    markings: "stripes", expression: "fierce",
    hp: 96, atk: 70, def: 104, spd: 30,
    flavor: "Born from an old knight's shield. Takes its job very seriously." },
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
  recenterBtn: $("recenterBtn"),
  mapFarHint: $("mapFarHint"),
  enableLocation: $("enableLocation"),
  locationStatus: $("locationStatus"),
  feedList: $("feedList"),
  caughtCount: $("caughtCount"),
  uniqueCount: $("uniqueCount"),
  collection: $("collection"),
  collectionSort: $("collectionSort"),
  expandAllBtn: $("expandAllBtn"),
  cardViewer: $("cardViewer"),
  cvStage: $("cvStage"),
  cvPrev: $("cvPrev"),
  cvNext: $("cvNext"),
  cvClose: $("cvClose"),
  cvCounter: $("cvCounter"),
  cvMotion: $("cvMotion"),
  reset: $("resetProfile"),
  locationModal: $("locationModal"),
  modalLocationHelp: $("modalLocationHelp"),
  ballChip: $("ballChip"),
  ballCount: $("ballCount"),
  tradeBtn: $("tradeBtn"),
  tradeBadge: $("tradeIncomingBadge"),
  feedTicker: $("feedTicker"),
  feedTickerTrack: $("feedTickerTrack"),
  catchBadge: $("catchBadge"),
  sheetScrim: $("sheetScrim"),
};

let locationGranted = false;

// Collection view state
const COLLECTION_SORT_KEY = "fokemon_collection_sort";
const VALID_SORTS = new Set(COLLECTION_SORTS.map((s) => s.key));
let collectionSort = "recent";
try {
  const stored = localStorage.getItem(COLLECTION_SORT_KEY);
  if (stored && VALID_SORTS.has(stored)) collectionSort = stored;
} catch {}
const expandedSpecies = new Set(); // species ids whose duplicates are revealed
let viewerOrder = []; // [{ entry, speciesId, indexInGroup, groupCount }]
let viewerIndex = 0;
let viewerFlipped = false;

function safeStorageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

let profile = safeStorageGet("fokemon_profile", null);
let caught = migrateCaughtEntries(safeStorageGet("fokemon_caught", []));
let fokeBalls = safeStorageGet("fokemon_balls", STARTING_FOKEBALLS);
if (!Number.isFinite(fokeBalls) || fokeBalls < 0) fokeBalls = STARTING_FOKEBALLS;
const poiSpent = safeStorageGet("fokemon_poi_spent", {}) || {};
const recentEvents = [];
const caughtIds = new Set(caught.map((c) => c.id));
const caughtByUid = new Map(caught.map((c) => [c.uid, c]));
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
    scrollWheelZoom: true,
    minZoom: 2,
  }).setView([0, 0], 2);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  // Recompute placements + redraw when the user pans or zooms — this is how
  // exploration shows POIs/battle sites for whatever area is in view.
  leafletMap.on("moveend zoomend", () => {
    ensureFreshPlacements();
    renderMap();
  });

  if (el.recenterBtn) {
    el.recenterBtn.addEventListener("click", recenterOnPlayer);
  }

  el.nearbyMap.classList.add("leaflet-active");
  requestAnimationFrame(() => leafletMap?.invalidateSize());
  return leafletMap;
}

function recenterOnPlayer() {
  if (!leafletMap || !playerLocation) return;
  leafletMap.flyTo([playerLocation.lat, playerLocation.lng], RECENTER_ZOOM, { duration: 0.7 });
}

function mapAnchor() {
  // Anchor used to compute which POIs / battle sites to render. When the user
  // pans away while zoomed in, the anchor follows the viewport so they can see
  // content in whatever area they're exploring. Falls back to the player.
  if (leafletMap && leafletMap.getZoom() >= NEARBY_ZOOM_THRESHOLD) {
    const c = leafletMap.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
  return playerLocation;
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

  // POIs and battle sites follow the map's viewport center when zoomed in, so
  // exploration reveals locations elsewhere. Spawn Fokemon stay anchored to the
  // player's cell since they're explicitly "wild around you".
  const anchor = mapAnchor() || playerLocation;
  const anchorGridKey = getGridKey(anchor.lat, anchor.lng);
  if (anchorGridKey !== currentPoisCellKey) {
    currentPois = computePoiPlacements(anchor.lat, anchor.lng, {
      neighborhoodCells: 1,
    });
    currentPoisCellKey = anchorGridKey;
  }
  if (anchorGridKey !== currentBattleSitesCellKey) {
    currentBattleSites = computeBattleSitePlacements(anchor.lat, anchor.lng, {
      neighborhoodCells: 2,
    });
    currentBattleSitesCellKey = anchorGridKey;
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

function instanceStatRowsHtml(card, boosts) {
  const rows = [
    ["HP", card.hp ?? 0, boosts?.hp || 0, 140],
    ["ATK", card.atk ?? 0, boosts?.atk || 0, 120],
    ["DEF", card.def ?? 0, boosts?.def || 0, 120],
    ["SPD", card.spd ?? 0, boosts?.spd || 0, 120],
  ];
  return `
    <ul class="stats-list">
      ${rows.map(([label, base, boost, max]) => {
        const total = base + boost;
        const pct = Math.max(4, Math.min(100, (total / max) * 100));
        return `
          <li>
            <span class="stat-label">${label}</span>
            <span class="stat-bar"><span class="stat-fill" style="width:${pct}%"></span></span>
            <span class="stat-val">${total}${boost ? `<span class="stat-boost"> +${boost}</span>` : ""}</span>
          </li>`;
      }).join("")}
    </ul>
  `;
}

function formatCaughtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return "";
  }
}

function syncCollectionToolbar(multiSpeciesIds) {
  if (el.collectionSort && !el.collectionSort.options.length) {
    el.collectionSort.innerHTML = COLLECTION_SORTS
      .map((s) => `<option value="${s.key}">${escapeHtml(s.label)}</option>`)
      .join("");
  }
  if (el.collectionSort) el.collectionSort.value = collectionSort;
  if (el.expandAllBtn) {
    const hasMulti = multiSpeciesIds.size > 0;
    el.expandAllBtn.hidden = !hasMulti;
    const allOpen = hasMulti && [...multiSpeciesIds].every((id) => expandedSpecies.has(id));
    el.expandAllBtn.textContent = allOpen ? "Collapse all" : "Expand all";
    el.expandAllBtn.setAttribute("aria-pressed", allOpen ? "true" : "false");
  }
}

function renderCollection() {
  if (!el.caughtCount) return;
  el.caughtCount.textContent = caught.length;
  const uniqueSpecies = new Set(caught.map((c) => c.id));
  el.uniqueCount.textContent = uniqueSpecies.size;

  if (!caught.length) {
    el.collection.innerHTML = `<p class="empty-state">Catch a Fokemon to start your dex — each individual gets its own card, stats, and training history.</p>`;
    viewerOrder = [];
    syncCollectionToolbar(new Set());
    return;
  }

  const groups = groupCollection(caught, cardsById, collectionSort);
  viewerOrder = flattenCollectionGroups(groups);
  const vindexByUid = new Map(viewerOrder.map((v, i) => [v.entry.uid, i]));
  const multiSpeciesIds = new Set(groups.filter((g) => g.count > 1).map((g) => g.id));
  syncCollectionToolbar(multiSpeciesIds);

  el.collection.innerHTML = groups
    .map((group) => {
      const card = group.card;
      if (!card) return "";
      const isMulti = group.count > 1;
      const expanded = isMulti && expandedSpecies.has(group.id);
      return group.members
        .map((entry, memberIdx) => {
          const isRep = memberIdx === 0;
          // Non-representatives of a multi-group are emitted but hidden until
          // the species is expanded (so expand just reveals existing tiles).
          const colors = colorsFor(card);
          const power = instancePower(entry);
          const tier = powerTier(power);
          const trained = (entry.boosts?.hp || 0) + (entry.boosts?.atk || 0) + (entry.boosts?.def || 0) + (entry.boosts?.spd || 0);
          const deployed = !!entry.deployedAt;
          const deployedLabel = deployed ? battleSiteName(entry.deployedAt) : "";
          const totalHp = (card.hp || 0) + (entry.boosts?.hp || 0);
          const vindex = vindexByUid.get(entry.uid) ?? 0;
          const classes = ["gallery-card"];
          if (deployed) classes.push("deployed");
          if (isRep && isMulti) classes.push("stacked");
          if (!isRep) classes.push("member");
          if (isMulti && !isRep && !expanded) classes.push("collapsed");
          const numLabel = isMulti ? `#${memberIdx + 1}/${group.count}` : "";
          return `
        <div class="${classes.join(" ")}" data-uid="${escapeHtml(entry.uid)}" data-species="${escapeHtml(group.id)}" data-vindex="${vindex}" tabindex="0" role="button" aria-label="Open ${escapeHtml(card.name)}${numLabel ? " " + numLabel : ""} card">
          ${isMulti ? `<span class="stack-badge" title="${group.count} ${escapeHtml(card.name)}">${isRep ? `×${group.count}` : escapeHtml(numLabel)}</span>` : ""}
          ${deployed ? `<span class="deployed-pill" title="Deployed at ${escapeHtml(deployedLabel)}">At gym</span>` : ""}
          <canvas class="gallery-art" width="160" height="120" aria-hidden="true"></canvas>
          <div class="gallery-meta">
            <strong>${escapeHtml(card.name)}</strong>
            <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
          </div>
          <div class="gallery-meta" style="flex-direction:row;gap:.4rem;">
            <span class="power-chip ${tier}" title="Power level">⚡ ${power}</span>
            <span class="power-chip" title="Hit points">❤ ${totalHp}</span>
          </div>
          ${trained ? `<span class="trained-badge" title="Training boosts">+${trained} trained</span>` : ""}
          ${isRep && isMulti
            ? `<button type="button" class="expand-btn" data-species="${escapeHtml(group.id)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Collapse" : `Show all ${group.count}`}</button>`
            : ""}
        </div>`;
        })
        .join("");
    })
    .join("");

  el.collection.querySelectorAll(".gallery-card").forEach((node) => {
    const uid = node.dataset.uid;
    const entry = getInstance(uid);
    if (!entry) return;
    const card = cardsById.get(entry.id);
    const canvas = node.querySelector(".gallery-art");
    if (canvas && card) renderPortrait(canvas, card);

    const open = (ev) => {
      if (ev?.target && ev.target.closest(".expand-btn")) return;
      const vindex = Number(node.dataset.vindex) || 0;
      openCardViewer(vindex);
    };
    node.addEventListener("click", open);
    node.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open(ev);
      }
    });

    const expandBtn = node.querySelector(".expand-btn");
    if (expandBtn) {
      expandBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const sid = expandBtn.dataset.species;
        if (expandedSpecies.has(sid)) expandedSpecies.delete(sid);
        else expandedSpecies.add(sid);
        renderCollection();
      });
    }
  });
}

/* ---------------------------------------------------------------------------
   Immersive card viewer — a virtual representation of the physical card
   ------------------------------------------------------------------------- */
let cardViewerInited = false;
let cvCardEl = null;
let cvReturnFocus = null;
let cvGesture = null; // { x, y, moved, swiped }
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function cardViewerHtml(view) {
  const entry = view.entry;
  const card = cardsById.get(entry.id);
  if (!card) return "";
  const colors = colorsFor(card);
  const power = instancePower(entry);
  const tier = powerTier(power);
  const rarity = card.rarity || "common";
  const typeClass = `type-${String(card.type || "spirit").toLowerCase()}`;
  const trained = (entry.boosts?.hp || 0) + (entry.boosts?.atk || 0) + (entry.boosts?.def || 0) + (entry.boosts?.spd || 0);
  const deployed = !!entry.deployedAt;
  const deployedLabel = deployed ? battleSiteName(entry.deployedAt) : "";
  const numLabel = view.groupCount > 1 ? `#${view.indexInGroup + 1} of ${view.groupCount}` : "";
  const stat = (label, base, boost) => `
    <div><span>${base + (boost || 0)}${boost ? `<small class="stat-boost"> +${boost}</small>` : ""}</span><small>${label}</small></div>`;
  return `
    <div class="cv-card rarity-${escapeHtml(rarity)} ${typeClass}"
         style="--cv-edge:${colors.accent};--cv-glow:${colors.accent}55;"
         data-uid="${escapeHtml(entry.uid)}" tabindex="0">
      <div class="cv-flipper">
        <div class="cv-face front">
          <div class="cv-holo"></div><div class="cv-glare"></div>
          <div class="cv-body">
            <div class="cv-front-head">
              <h2>${escapeHtml(card.name)}</h2>
              <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
            </div>
            <p class="rarity ${escapeHtml(rarity)}">${escapeHtml(rarity)}${numLabel ? ` &bull; ${escapeHtml(numLabel)}` : ""}</p>
            <canvas class="cv-art" width="320" height="240" aria-hidden="true"></canvas>
            <div class="cv-badges">
              <span class="power-chip ${tier}" title="Power level">⚡ ${power}</span>
              ${trained ? `<span class="trained-badge">+${trained} trained</span>` : ""}
              ${deployed ? `<span class="deployed-pill" style="position:static;">At ${escapeHtml(deployedLabel)}</span>` : ""}
            </div>
            <div class="cv-statline">
              ${stat("HP", card.hp || 0, entry.boosts?.hp)}
              ${stat("ATK", card.atk || 0, entry.boosts?.atk)}
              ${stat("DEF", card.def || 0, entry.boosts?.def)}
              ${stat("SPD", card.spd || 0, entry.boosts?.spd)}
            </div>
            <div class="cv-foot">
              <span>${escapeHtml(formatCaughtDate(entry.ts))}</span>
              <span>Tap to flip</span>
            </div>
          </div>
        </div>
        <div class="cv-face back">
          <div class="cv-holo"></div><div class="cv-glare"></div>
          <div class="cv-body">
            <header>
              <strong>${escapeHtml(card.name)}${numLabel ? ` <small>${escapeHtml(numLabel)}</small>` : ""}</strong>
              <p class="rarity ${escapeHtml(rarity)}">${escapeHtml(rarity)} &bull; ${escapeHtml(card.type)}</p>
            </header>
            ${instanceStatRowsHtml(card, entry.boosts)}
            <p class="instance-status">${deployed
              ? `Deployed at <strong>${escapeHtml(deployedLabel)}</strong>.`
              : "Available to deploy or trade."}</p>
            <p class="flavor">${escapeHtml(card.flavor || "")}</p>
            <div class="instance-actions">
              <button type="button" class="ghost cv-release" data-uid="${escapeHtml(entry.uid)}" ${deployed ? "disabled title='Recall from gym first'" : ""}>Release</button>
            </div>
            <p class="cv-back-tip">Caught ${escapeHtml(formatCaughtDate(entry.ts))} · tap to flip back</p>
          </div>
        </div>
      </div>
    </div>`;
}

function renderCardViewer() {
  if (!el.cvStage) return;
  if (!viewerOrder.length) { closeCardViewer(); return; }
  viewerIndex = Math.max(0, Math.min(viewerIndex, viewerOrder.length - 1));
  const view = viewerOrder[viewerIndex];
  el.cvStage.innerHTML = cardViewerHtml(view);
  cvCardEl = el.cvStage.querySelector(".cv-card");
  if (cvCardEl && viewerFlipped) cvCardEl.classList.add("flipped");
  setViewerOrientation(0, 0); // reset tilt + resting highlight
  const card = cardsById.get(view.entry.id);
  const canvas = el.cvStage.querySelector(".cv-art");
  if (canvas && card) renderPortrait(canvas, card);

  if (el.cvCounter) el.cvCounter.textContent = `${viewerIndex + 1} / ${viewerOrder.length}`;
  if (el.cvPrev) el.cvPrev.disabled = viewerIndex === 0;
  if (el.cvNext) el.cvNext.disabled = viewerIndex === viewerOrder.length - 1;

  const releaseBtn = el.cvStage.querySelector(".cv-release");
  if (releaseBtn) {
    releaseBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const targetUid = releaseBtn.dataset.uid;
      const target = getInstance(targetUid);
      if (!target) return;
      const c = cardsById.get(target.id);
      const label = c ? c.name : "this Fokemon";
      if (!confirm(`Release ${label}? This is permanent — its trained boosts will be lost.`)) return;
      if (releaseInstance(targetUid)) {
        renderCollection();
        renderMap();
        if (!viewerOrder.length) { closeCardViewer(); return; }
        viewerFlipped = false;
        renderCardViewer();
      }
    });
  }
}

// Drive the holographic layers from a tilt angle (a notional overhead light
// reflecting off the card) rather than the raw cursor, so the foil and glare
// sweep with the card's orientation.
//   --mx/--my : glare focal point (the bright "wet" highlight)
//   --bx/--by : rainbow-foil sweep position. Repeating bands — no convergence
//               point — and the resting value is deliberately OFF-centre so
//               the foil never shows a seam parked mid-card on load.
//   --fc      : 0..1 distance-from-rest, used to swell the glare on tilt.
function setViewerHolo(rx, ry) {
  if (!cvCardEl) return;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mx = clamp(50 - ry * 1.8, 12, 88);
  const my = clamp(34 + rx * 1.8, 10, 84);
  const bx = clamp(30 - ry * 4.6, -45, 135);
  const by = clamp(26 + rx * 4.6, -45, 135);
  const fc = clamp(Math.hypot(rx, ry) / 15, 0, 1);
  const s = cvCardEl.style;
  s.setProperty("--mx", `${mx.toFixed(1)}%`);
  s.setProperty("--my", `${my.toFixed(1)}%`);
  s.setProperty("--bx", `${bx.toFixed(1)}%`);
  s.setProperty("--by", `${by.toFixed(1)}%`);
  s.setProperty("--fc", fc.toFixed(3));
}

// Pointer/mouse tilt (desktop): the screen is stationary, so the card itself
// rotates in 3D and the sheen follows.
function setViewerOrientation(rx, ry) {
  if (!cvCardEl) return;
  cvCardEl.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
  cvCardEl.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
  setViewerHolo(rx, ry);
}

// Phone-tilt (gyro): the screen is already moving in the user's hand, so
// rotating the card on top of that is double motion. Keep the card flat and
// let only the hologram travel with the phone's position.
function setViewerTiltHolo(rx, ry) {
  if (!cvCardEl) return;
  cvCardEl.style.setProperty("--rx", "0deg");
  cvCardEl.style.setProperty("--ry", "0deg");
  setViewerHolo(rx, ry);
}

function applyViewerTilt(clientX, clientY) {
  if (!cvCardEl || cvNavigating || prefersReducedMotion()) return;
  const rect = cvCardEl.getBoundingClientRect();
  const px = (clientX - rect.left) / rect.width;  // 0..1
  const py = (clientY - rect.top) / rect.height;  // 0..1
  const max = 12;
  setViewerOrientation(-(py - 0.5) * 2 * max, (px - 0.5) * 2 * max);
}

function resetViewerTilt() {
  setViewerOrientation(0, 0);
}

let cvNavigating = false;

function navigateViewer(delta) {
  const next = viewerIndex + delta;
  if (next < 0 || next >= viewerOrder.length || cvNavigating) return;
  const dir = delta > 0 ? 1 : -1;
  const stage = el.cvStage;
  if (prefersReducedMotion() || !stage) {
    viewerIndex = next;
    viewerFlipped = false;
    renderCardViewer();
    return;
  }
  // Slide the outgoing card off, swap, then slide the new one in from the
  // opposite edge so the change is unmistakable.
  // Sequenced with setTimeout + a forced reflow (not requestAnimationFrame):
  // rAF is starved when the tab isn't painting, which would otherwise leave
  // the card stuck off-screen. Timers always fire, so the card always lands.
  cvNavigating = true;
  stage.style.transition = "transform .16s ease, opacity .16s ease";
  stage.style.transform = `translateX(${-dir * 55}%)`;
  stage.style.opacity = "0";
  setTimeout(() => {
    viewerIndex = next;
    viewerFlipped = false;
    renderCardViewer();
    // Drop the incoming card in on the opposite edge with no transition,
    // then commit that placement with a synchronous reflow.
    stage.style.transition = "none";
    stage.style.transform = `translateX(${dir * 55}%)`;
    stage.style.opacity = "0";
    void stage.offsetWidth;
    setTimeout(() => {
      stage.style.transition = "transform .22s ease, opacity .22s ease";
      stage.style.transform = "translateX(0)";
      stage.style.opacity = "1";
      setTimeout(() => {
        stage.style.transition = "";
        stage.style.transform = "";
        stage.style.opacity = "";
        cvNavigating = false;
      }, 240);
    }, 20);
  }, 160);
}

function openCardViewer(index) {
  if (!el.cardViewer || !viewerOrder.length) return;
  initCardViewer();
  viewerIndex = Math.max(0, Math.min(index || 0, viewerOrder.length - 1));
  viewerFlipped = false;
  cvReturnFocus = document.activeElement;
  el.cardViewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderCardViewer();
  if (el.cvClose) el.cvClose.focus();
}

function closeCardViewer() {
  if (!el.cardViewer) return;
  el.cardViewer.classList.add("hidden");
  document.body.style.overflow = "";
  if (cvReturnFocus && typeof cvReturnFocus.focus === "function") {
    try { cvReturnFocus.focus(); } catch {}
  }
  cvReturnFocus = null;
}

function viewerIsOpen() {
  return el.cardViewer && !el.cardViewer.classList.contains("hidden");
}

function initCardViewer() {
  if (cardViewerInited || !el.cardViewer) return;
  cardViewerInited = true;

  el.cvPrev?.addEventListener("click", () => navigateViewer(-1));
  el.cvNext?.addEventListener("click", () => navigateViewer(1));
  el.cvClose?.addEventListener("click", closeCardViewer);
  el.cardViewer.querySelectorAll("[data-cv-close]").forEach((n) =>
    n.addEventListener("click", closeCardViewer)
  );

  document.addEventListener("keydown", (ev) => {
    if (!viewerIsOpen()) return;
    if (ev.key === "Escape") { ev.preventDefault(); closeCardViewer(); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); navigateViewer(-1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); navigateViewer(1); }
    else if (ev.key === "Enter" || ev.key === " ") {
      if (ev.target && ev.target.closest && ev.target.closest(".cv-card")) {
        ev.preventDefault();
        viewerFlipped = !viewerFlipped;
        cvCardEl?.classList.toggle("flipped", viewerFlipped);
      }
    }
  });

  // Pointer: tilt + tap-to-flip + horizontal swipe to navigate.
  el.cvStage.addEventListener("pointermove", (ev) => {
    if (cvGesture && cvGesture.swiped) return;
    applyViewerTilt(ev.clientX, ev.clientY);
  });
  el.cvStage.addEventListener("pointerleave", resetViewerTilt);
  el.cvStage.addEventListener("pointerdown", (ev) => {
    cvGesture = { x: ev.clientX, y: ev.clientY, moved: false, swiped: false };
  });
  el.cvStage.addEventListener("pointermove", (ev) => {
    if (!cvGesture) return;
    const dx = ev.clientX - cvGesture.x;
    const dy = ev.clientY - cvGesture.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) cvGesture.moved = true;
    if (!cvGesture.swiped && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      cvGesture.swiped = true;
      resetViewerTilt();
      navigateViewer(dx < 0 ? 1 : -1);
    }
  });
  const endGesture = (ev) => {
    if (!cvGesture) return;
    const wasSwipe = cvGesture.swiped;
    const moved = cvGesture.moved;
    cvGesture = null;
    if (wasSwipe || moved) return;
    // A clean tap on the card flips it (ignore taps on buttons).
    if (ev.target && ev.target.closest && ev.target.closest(".cv-card") &&
        !ev.target.closest("button")) {
      viewerFlipped = !viewerFlipped;
      cvCardEl?.classList.toggle("flipped", viewerFlipped);
    }
  };
  el.cvStage.addEventListener("pointerup", endGesture);
  el.cvStage.addEventListener("pointercancel", () => { cvGesture = null; });

  // Device-motion tilt (mobile). iOS 13+ needs an explicit permission tap.
  const attachOrientation = () => {
    window.addEventListener("deviceorientation", (ev) => {
      if (!viewerIsOpen() || !cvCardEl || cvNavigating || prefersReducedMotion()) return;
      if (ev.gamma == null || ev.beta == null) return;
      const ry = Math.max(-14, Math.min(14, ev.gamma * 0.45));
      const rx = Math.max(-14, Math.min(14, (ev.beta - 45) * 0.3));
      // Card stays flat on gyro — only the hologram tracks the phone.
      setViewerTiltHolo(-rx, ry);
    });
  };
  const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
  if (DOE && typeof DOE.requestPermission === "function") {
    if (el.cvMotion) {
      el.cvMotion.hidden = false;
      el.cvMotion.addEventListener("click", async () => {
        try {
          const res = await DOE.requestPermission();
          if (res === "granted") { attachOrientation(); el.cvMotion.hidden = true; }
        } catch {}
      });
    }
  } else if (DOE) {
    attachOrientation();
  }
}

function renderFeed() {
  const ordered = [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, 20);
  if (el.feedList) {
    el.feedList.innerHTML = ordered
      .map((e) => `<li><strong>${escapeHtml(e.trainer)}</strong> caught ${escapeHtml(e.card)}</li>`)
      .join("");
  }
  renderFeedTicker(ordered);
}

// The ambient bottom-edge ticker — a glanceable crawl of recent global
// catches. Tapping it opens the full feed sheet (see initAppShell).
function renderFeedTicker(ordered) {
  if (!el.feedTicker || !el.feedTickerTrack) return;
  if (!ordered || !ordered.length) {
    el.feedTicker.classList.add("hidden");
    el.feedTickerTrack.innerHTML = "";
    return;
  }
  const recent = ordered.slice(0, 12);
  const run = recent
    .map((e) => `<span><strong>${escapeHtml(e.trainer)}</strong> caught ${escapeHtml(e.card)}</span>`)
    .join("");
  // Duplicate the run so the -50% scroll keyframe loops seamlessly.
  el.feedTickerTrack.innerHTML = run + run;
  // Keep the scroll speed roughly constant regardless of content length.
  const chars = recent.reduce((n, e) => n + e.trainer.length + e.card.length + 9, 0);
  el.feedTicker.style.setProperty("--ticker-dur", `${Math.max(16, Math.round(chars * 0.32))}s`);
  el.feedTicker.classList.remove("hidden");
}

// Count of uncaught spawns currently within catch range — drives the
// badge on the "Catch" bottom-nav button.
function renderCatchBadge() {
  if (!el.catchBadge) return;
  let n = 0;
  if (playerLocation) {
    for (const p of currentPlacements) {
      if (gridCaughtIds.has(p.card.id)) continue;
      if (distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }) <= CATCH_RANGE_METERS) n++;
    }
  }
  if (n > 0) {
    el.catchBadge.textContent = String(n);
    el.catchBadge.classList.remove("hidden");
  } else {
    el.catchBadge.classList.add("hidden");
  }
}

function renderCards() {
  ensureFreshPlacements();
  renderCatchBadge();
  if (!el.cardsList) return;
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

const spawnPortraitCache = new Map();
function spawnPortraitDataUrl(card) {
  if (typeof document === "undefined") return "";
  const cached = spawnPortraitCache.get(card.id);
  if (cached) return cached;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  // Transparent background — the marker pill behind shows colour & glow.
  drawCreature(ctx, card, size / 2, size / 2 + 4, size * 0.34);
  const url = canvas.toDataURL("image/png");
  spawnPortraitCache.set(card.id, url);
  return url;
}

function makeSpawnIcon(p) {
  const L = window.L;
  const meters = playerLocation
    ? Math.round(distanceMeters(playerLocation, { lat: p.lat, lng: p.lng }))
    : null;
  const near = meters !== null && meters <= CATCH_RANGE_METERS ? "near" : "";
  const colors = colorsFor(p.card);
  const style = `--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};`;
  const portrait = spawnPortraitDataUrl(p.card);
  return L.divIcon({
    className: "",
    html: `<div class="spawn-marker ${near}" style="${style}">
      <div class="spawn-face">
        <img class="spawn-portrait" src="${portrait}" alt="" aria-hidden="true" />
      </div>
      <span class="spawn-name">${escapeHtml(p.card.name)}</span>
      ${meters === null ? "" : `<small class="spawn-dist">${meters}m</small>`}
    </div>`,
    iconSize: [78, 92],
    iconAnchor: [39, 46],
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
  const theme = siteTheme(site.id);
  const champion = info.champion;
  const label = champion
    ? (cardsById.get(champion.cardId)?.name || "Champion")
    : theme.tag;
  return L.divIcon({
    className: "",
    html: `
      <div
        class="battle-site-marker ${info.status} ${info.near ? "near" : ""}"
        style="--ring:${theme.color};--ring-accent:${theme.accent};"
      >
        <span class="bs-banner">${escapeHtml(name)}</span>
        <span class="bs-medal">
          <span class="bs-medal-glyph" aria-hidden="true">${theme.glyph}</span>
          ${champion ? `<span class="bs-medal-crossed" aria-hidden="true">⚔</span>` : ""}
        </span>
        <small>${escapeHtml(label)}</small>
      </div>
    `,
    iconSize: [86, 84],
    iconAnchor: [43, 84],
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
    updateRecenterButton();
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
    map.setView(center, RECENTER_ZOOM);
  } else {
    playerMarker.setLatLng(center);
  }

  // Below the threshold the map is in "world exploration" mode — only the
  // player marker is shown so the viewer can scroll across a non-cluttered map.
  const showNearby = map.getZoom() >= NEARBY_ZOOM_THRESHOLD;

  if (showNearby) {
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
  } else if (catchCircle) {
    catchCircle.remove();
    catchCircle = null;
  }

  const wantedKeys = new Set();
  const visiblePlacements = showNearby
    ? currentPlacements.filter((p) => !gridCaughtIds.has(p.card.id))
    : [];
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
  const visibleSites = showNearby ? currentBattleSites : [];
  visibleSites.forEach((site) => {
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
  const visiblePois = showNearby ? currentPois : [];
  visiblePois.forEach((poi) => {
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
  if (showNearby) {
    for (const [name, pos] of trainerLocations) {
      if (name === profile?.name) continue;
      if (Date.now() - pos.ts > PRESENCE_TTL_MS) continue;
      seenTrainers.add(name);
      let marker = trainerMarkers.get(name);
      if (!marker) {
        marker = L.marker([pos.lat, pos.lng], { icon: makeTrainerIcon(name) }).addTo(map);
        const trainerName = name;
        marker.on("click", () => openTradeModal(null, { offerTo: trainerName }));
        trainerMarkers.set(name, marker);
      } else {
        marker.setLatLng([pos.lat, pos.lng]);
      }
    }
  }
  for (const [name, marker] of trainerMarkers) {
    if (!seenTrainers.has(name)) {
      marker.remove();
      trainerMarkers.delete(name);
    }
  }

  updateRecenterButton(showNearby);
}

function updateRecenterButton(showNearby) {
  if (!el.recenterBtn) return;
  if (!playerLocation || !leafletMap) {
    el.recenterBtn.classList.add("hidden");
    if (el.mapFarHint) el.mapFarHint.classList.add("hidden");
    return;
  }
  const L = window.L;
  const inViewport = L
    ? leafletMap.getBounds().contains(L.latLng(playerLocation.lat, playerLocation.lng))
    : true;
  const zoomedIn = showNearby ?? leafletMap.getZoom() >= NEARBY_ZOOM_THRESHOLD;
  const awayFromHome = !inViewport || !zoomedIn;
  el.recenterBtn.classList.toggle("hidden", !awayFromHome);
  if (el.mapFarHint) {
    el.mapFarHint.classList.toggle("hidden", zoomedIn);
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

function rebuildCaughtIndexes() {
  caughtIds.clear();
  caughtByUid.clear();
  for (const c of caught) {
    if (!c) continue;
    caughtIds.add(c.id);
    caughtByUid.set(c.uid, c);
  }
}

function getInstance(uid) {
  return uid ? caughtByUid.get(uid) || null : null;
}

function releaseInstance(uid) {
  const entry = getInstance(uid);
  if (!entry) return false;
  if (entry.deployedAt) return false;
  caught = caught.filter((c) => c.uid !== uid);
  rebuildCaughtIndexes();
  saveLocal();
  return true;
}

function applyInstanceBoosts(uid, boosts) {
  const entry = getInstance(uid);
  if (!entry) return;
  entry.boosts = normalizeBoosts({
    hp: boosts?.hp ?? 0,
    atk: boosts?.atk ?? 0,
    def: boosts?.def ?? 0,
    spd: boosts?.spd ?? 0,
  });
  saveLocal();
}

function markInstanceDeployed(uid, siteId) {
  const entry = getInstance(uid);
  if (!entry) return;
  entry.deployedAt = siteId || null;
  saveLocal();
}

function restoreInstanceHome(uid, mergedBoosts) {
  const entry = getInstance(uid);
  if (!entry) return;
  if (mergedBoosts) entry.boosts = normalizeBoosts(mergedBoosts);
  entry.deployedAt = null;
  saveLocal();
}

function instancePower(entry) {
  const card = cardsById.get(entry.id);
  if (!card) return 0;
  return (
    (card.hp || 0) + (card.atk || 0) + (card.def || 0) + (card.spd || 0)
    + (entry.boosts?.hp || 0)
    + (entry.boosts?.atk || 0)
    + (entry.boosts?.def || 0)
    + (entry.boosts?.spd || 0)
  );
}

function catchCard(card, placement) {
  const ts = Date.now();
  const event = {
    trainer: profile.name,
    card: card.name,
    ts,
    lat: placement?.lat ?? playerLocation?.lat ?? null,
    lng: placement?.lng ?? playerLocation?.lng ?? null,
  };

  const entry = {
    id: card.id,
    ts,
    uid: makeInstanceUid(card.id, ts),
    boosts: { hp: 0, atk: 0, def: 0, spd: 0 },
    deployedAt: null,
  };
  caught.push(entry);
  caughtIds.add(card.id);
  caughtByUid.set(entry.uid, entry);
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

function bodyDims(shape, r) {
  if (shape === "tall") return { rx: r * 0.78, ry: r * 1.08 };
  if (shape === "wide") return { rx: r * 1.12, ry: r * 0.78 };
  if (shape === "stocky") return { rx: r * 1.05, ry: r * 0.95 };
  if (shape === "long") return { rx: r * 1.25, ry: r * 0.62 };
  return { rx: r, ry: r };
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
  } else if (shape === "stocky") {
    // Pear-ish: slightly heavier bottom for character.
    ctx.moveTo(-r * 1.0, -r * 0.18);
    ctx.bezierCurveTo(-r * 1.05, -r * 0.95, r * 1.05, -r * 0.95, r * 1.0, -r * 0.18);
    ctx.bezierCurveTo(r * 1.15, r * 0.9, -r * 1.15, r * 0.9, -r * 1.0, -r * 0.18);
    ctx.closePath();
  } else if (shape === "long") {
    ctx.ellipse(0, 0, r * 1.25, r * 0.62, 0, 0, Math.PI * 2);
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

  // Subtle highlight sheen — adds depth on every body.
  ctx.save();
  const sheen = ctx.createRadialGradient(-r * 0.38, -r * 0.5, r * 0.05, -r * 0.3, -r * 0.4, r * 0.55);
  sheen.addColorStop(0, "rgba(255,255,255,0.55)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.42, r * 0.42, r * 0.28, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Little feet — adds grounded character to non-floaty shapes.
  if (shape === "tall" || shape === "wide" || shape === "stocky") {
    const dims = bodyDims(shape, r);
    ctx.fillStyle = colors.dark;
    ctx.strokeStyle = "rgba(7, 13, 28, 0.5)";
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    const fy = dims.ry * 0.92;
    const fx = dims.rx * 0.48;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.ellipse(side * fx, fy, r * 0.18, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
}

function clipBodyPath(ctx, shape, r) {
  ctx.beginPath();
  if (shape === "tall") {
    ctx.ellipse(0, 0, r * 0.78, r * 1.08, 0, 0, Math.PI * 2);
  } else if (shape === "wide") {
    ctx.ellipse(0, 0, r * 1.12, r * 0.78, 0, 0, Math.PI * 2);
  } else if (shape === "stocky") {
    ctx.moveTo(-r * 1.0, -r * 0.18);
    ctx.bezierCurveTo(-r * 1.05, -r * 0.95, r * 1.05, -r * 0.95, r * 1.0, -r * 0.18);
    ctx.bezierCurveTo(r * 1.15, r * 0.9, -r * 1.15, r * 0.9, -r * 1.0, -r * 0.18);
    ctx.closePath();
  } else if (shape === "long") {
    ctx.ellipse(0, 0, r * 1.25, r * 0.62, 0, 0, Math.PI * 2);
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
  ctx.clip();
}

function drawCreatureMarkings(ctx, kind, shape, r, colors) {
  if (!kind || kind === "none") return;
  ctx.save();
  clipBodyPath(ctx, shape, r);
  if (kind === "belly") {
    const grad = ctx.createRadialGradient(0, r * 0.3, r * 0.1, 0, r * 0.4, r * 0.85);
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.7, `${colors.light}cc`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.52, r * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "spots") {
    ctx.fillStyle = `${colors.dark}cc`;
    const spots = [
      [-r * 0.5, -r * 0.05, r * 0.12],
      [r * 0.35, r * 0.15, r * 0.1],
      [-r * 0.15, r * 0.45, r * 0.13],
      [r * 0.55, -r * 0.35, r * 0.09],
    ];
    for (const [x, y, rad] of spots) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "stripes") {
    ctx.strokeStyle = `${colors.dark}d0`;
    ctx.lineWidth = Math.max(1.4, r * 0.07);
    ctx.lineCap = "round";
    const ys = [-r * 0.4, -r * 0.1, r * 0.25, r * 0.55];
    for (const y of ys) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, y);
      ctx.quadraticCurveTo(0, y + r * 0.08, r * 0.95, y);
      ctx.stroke();
    }
  } else if (kind === "mask") {
    ctx.fillStyle = `${colors.dark}e0`;
    ctx.beginPath();
    const my = shape === "tall" ? -r * 0.1 : -r * 0.18;
    ctx.ellipse(0, my, r * 0.78, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "blush") {
    ctx.fillStyle = "rgba(255, 120, 150, 0.55)";
    const by = shape === "tall" ? r * 0.08 : r * 0.02;
    const bx = shape === "wide" ? r * 0.62 : r * 0.46;
    ctx.beginPath();
    ctx.ellipse(-bx, by, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(bx, by, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  } else if (kind === "tufted") {
    // Small pointed ears with a fluff tip.
    ctx.fillStyle = colors.dark;
    ctx.lineWidth = Math.max(1, r * 0.035);
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.4, -r * 0.65);
      ctx.lineTo(side * r * 0.2, -r * 1.15);
      ctx.lineTo(side * r * 0.62, -r * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.light;
      ctx.beginPath();
      ctx.arc(side * r * 0.24, -r * 1.12, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.dark;
    });
  } else if (kind === "crest") {
    // A central mohawk-style crest, three spikes.
    ctx.fillStyle = colors.accent;
    ctx.lineWidth = Math.max(1, r * 0.035);
    const spikes = [
      [-r * 0.32, -r * 0.95, -r * 0.5, -r * 1.25, -r * 0.1, -r * 1.0],
      [0, -r * 1.05, -r * 0.18, -r * 1.45, r * 0.18, -r * 1.05],
      [r * 0.32, -r * 0.95, r * 0.1, -r * 1.25, r * 0.5, -r * 1.0],
    ];
    for (const [x1, y1, x2, y2, x3, y3] of spikes) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === "swept") {
    // Long ears swept backward — sleek, fast.
    ctx.fillStyle = colors.dark;
    ctx.lineWidth = Math.max(1, r * 0.035);
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.35, -r * 0.6);
      ctx.quadraticCurveTo(side * r * 1.1, -r * 1.0, side * r * 1.25, -r * 0.55);
      ctx.quadraticCurveTo(side * r * 0.85, -r * 0.5, side * r * 0.5, -r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(side * r * 0.55, -r * 0.6);
      ctx.quadraticCurveTo(side * r * 1.0, -r * 0.85, side * r * 1.15, -r * 0.6);
      ctx.quadraticCurveTo(side * r * 0.85, -r * 0.55, side * r * 0.55, -r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colors.dark;
    });
  }
}

function drawCreatureEyes(ctx, shape, r, expression = "smile") {
  const yOff = shape === "tall" ? -r * 0.05 : shape === "long" ? -r * 0.18 : -r * 0.12;
  const xOff =
    shape === "wide" || shape === "long" ? r * 0.42 :
    shape === "stocky" ? r * 0.36 :
    shape === "tall" ? r * 0.28 :
    r * 0.32;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = "rgba(7, 13, 28, 0.85)";

  if (expression === "sleepy") {
    // Half-closed eye arcs.
    ctx.beginPath();
    ctx.arc(-xOff, yOff, r * 0.14, Math.PI * 1.05, Math.PI * 1.95);
    ctx.arc(xOff, yOff, r * 0.14, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  } else if (expression === "happy") {
    // Closed upward-curving eyes.
    ctx.lineWidth = Math.max(1.2, r * 0.06);
    ctx.beginPath();
    ctx.arc(-xOff, yOff + r * 0.05, r * 0.14, Math.PI * 1.05, Math.PI * 1.95);
    ctx.arc(xOff, yOff + r * 0.05, r * 0.14, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  } else if (expression === "fierce") {
    // Angled-down brows + sharp eyes.
    ctx.fillStyle = "#0b1226";
    ctx.beginPath();
    ctx.arc(-xOff, yOff + r * 0.02, r * 0.12, 0, Math.PI * 2);
    ctx.arc(xOff, yOff + r * 0.02, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-xOff + r * 0.045, yOff - r * 0.02, r * 0.04, 0, Math.PI * 2);
    ctx.arc(xOff + r * 0.045, yOff - r * 0.02, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(7, 13, 28, 0.85)";
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-xOff - r * 0.18, yOff - r * 0.28);
    ctx.lineTo(-xOff + r * 0.12, yOff - r * 0.16);
    ctx.moveTo(xOff + r * 0.18, yOff - r * 0.28);
    ctx.lineTo(xOff - r * 0.12, yOff - r * 0.16);
    ctx.stroke();
  } else {
    // Default rounded eyes with highlights.
    ctx.fillStyle = "#0b1226";
    ctx.beginPath();
    ctx.arc(-xOff, yOff, r * 0.13, 0, Math.PI * 2);
    ctx.arc(xOff, yOff, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-xOff + r * 0.05, yOff - r * 0.05, r * 0.05, 0, Math.PI * 2);
    ctx.arc(xOff + r * 0.05, yOff - r * 0.05, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // Lower glint for life.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(-xOff - r * 0.04, yOff + r * 0.06, r * 0.022, 0, Math.PI * 2);
    ctx.arc(xOff - r * 0.04, yOff + r * 0.06, r * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth — varies by expression.
  ctx.strokeStyle = "rgba(7, 13, 28, 0.78)";
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.lineCap = "round";
  const my = yOff + r * 0.38;
  if (expression === "grin") {
    ctx.fillStyle = "#3a0d1c";
    ctx.beginPath();
    ctx.arc(0, my, r * 0.22, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Little fang.
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, my + r * 0.02);
    ctx.lineTo(-r * 0.02, my + r * 0.14);
    ctx.lineTo(r * 0.04, my + r * 0.02);
    ctx.closePath();
    ctx.fill();
  } else if (expression === "smirk") {
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, my);
    ctx.quadraticCurveTo(r * 0.12, my - r * 0.06, r * 0.22, my - r * 0.12);
    ctx.stroke();
  } else if (expression === "sleepy") {
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, my);
    ctx.lineTo(r * 0.08, my);
    ctx.stroke();
  } else if (expression === "calm") {
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, my);
    ctx.quadraticCurveTo(0, my + r * 0.04, r * 0.12, my);
    ctx.stroke();
  } else if (expression === "fierce") {
    // Snarl: zigzag.
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, my);
    ctx.lineTo(-r * 0.1, my - r * 0.06);
    ctx.lineTo(0, my);
    ctx.lineTo(r * 0.1, my - r * 0.06);
    ctx.lineTo(r * 0.2, my);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, my - r * 0.03, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
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
  } else if (kind === "petal") {
    // Five-petal flower.
    ctx.fillStyle = colors.accent;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * s * 0.42;
      const py = Math.sin(a) * s * 0.42;
      ctx.beginPath();
      ctx.ellipse(px, py, s * 0.22, s * 0.32, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = colors.dark;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "crescent") {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.5, 0.25 * Math.PI, 1.75 * Math.PI);
    ctx.arc(s * 0.18, 0, s * 0.42, 1.75 * Math.PI, 0.25 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "wings") {
    ctx.fillStyle = colors.accent;
    ctx.translate(0, -s * 0.7);
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * s * 0.1, 0);
      ctx.quadraticCurveTo(side * s * 0.9, -s * 0.5, side * s * 1.2, -s * 0.1);
      ctx.quadraticCurveTo(side * s * 0.8, s * 0.1, side * s * 0.1, s * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "tail-curl") {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, s * 0.4);
    ctx.quadraticCurveTo(-s * 1.6, s * 0.1, -s * 1.5, -s * 0.5);
    ctx.quadraticCurveTo(-s * 1.3, -s * 1.0, -s * 0.7, -s * 0.85);
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(-s * 0.7, -s * 0.85, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "spike-back") {
    ctx.fillStyle = colors.dark;
    const spikes = [[-s * 0.6, -s * 0.45], [-s * 0.25, -s * 0.6], [s * 0.1, -s * 0.65], [s * 0.45, -s * 0.55]];
    for (const [x, baseY] of spikes) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.12, baseY);
      ctx.lineTo(x, baseY - s * 0.45);
      ctx.lineTo(x + s * 0.12, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === "halo") {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.beginPath();
    ctx.ellipse(0, -s * 1.65, s * 0.45, s * 0.14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.ellipse(0, -s * 1.66, s * 0.42, s * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === "third-eye") {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.ellipse(0, -s * 1.05, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0b1226";
    ctx.beginPath();
    ctx.arc(0, -s * 1.05, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "claw") {
    ctx.fillStyle = colors.accent;
    ctx.strokeStyle = "rgba(7, 13, 28, 0.55)";
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * s * 0.55, s * 0.4);
      ctx.lineTo(side * s * 1.15, s * 0.1);
      ctx.lineTo(side * s * 0.95, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(side * s * 0.35, s * 0.45);
      ctx.lineTo(side * s * 0.85, s * 0.3);
      ctx.lineTo(side * s * 0.7, s * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  } else if (kind === "bubble") {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.strokeStyle = `${colors.dark}aa`;
    const bubs = [[0, -s * 0.1, s * 0.32], [s * 0.5, -s * 0.55, s * 0.18], [-s * 0.45, -s * 0.65, s * 0.14], [s * 0.35, -s * 0.9, s * 0.1]];
    for (const [x, y, rad] of bubs) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(x - rad * 0.35, y - rad * 0.35, rad * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
    }
  } else if (kind === "lantern") {
    // Curved stalk with a glowing bulb hovering above the head.
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.quadraticCurveTo(s * 0.4, -s * 1.4, s * 0.05, -s * 1.7);
    ctx.stroke();
    const glow = ctx.createRadialGradient(s * 0.05, -s * 1.7, s * 0.05, s * 0.05, -s * 1.7, s * 0.5);
    glow.addColorStop(0, "rgba(255, 240, 200, 1)");
    glow.addColorStop(0.5, colors.accent);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s * 0.05, -s * 1.7, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff7d0";
    ctx.beginPath();
    ctx.arc(s * 0.05, -s * 1.7, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "shield") {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.lineTo(s * 0.55, -s * 0.45);
    ctx.lineTo(s * 0.5, s * 0.25);
    ctx.quadraticCurveTo(0, s * 0.7, -s * 0.5, s * 0.25);
    ctx.lineTo(-s * 0.55, -s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(0, s * 0.45);
    ctx.moveTo(-s * 0.4, -s * 0.1);
    ctx.lineTo(s * 0.4, -s * 0.1);
    ctx.stroke();
  } else if (kind === "vines") {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const offset = (i - 1) * s * 0.42;
      ctx.beginPath();
      ctx.moveTo(offset, -s * 0.5);
      ctx.bezierCurveTo(offset + s * 0.25, -s * 0.85, offset - s * 0.25, -s * 1.15, offset, -s * 1.4);
      ctx.stroke();
      // Leaflet at tip.
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.ellipse(offset, -s * 1.42, s * 0.14, s * 0.08, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "ember-trail") {
    // Tail of embers behind/below.
    const embers = [[-s * 0.95, s * 0.05, s * 0.22], [-s * 0.55, s * 0.45, s * 0.14], [-s * 1.2, -s * 0.25, s * 0.12], [-s * 0.3, s * 0.7, s * 0.08]];
    for (const [x, y, rad] of embers) {
      const grad = ctx.createRadialGradient(x, y, rad * 0.1, x, y, rad);
      grad.addColorStop(0, "#fff2b0");
      grad.addColorStop(0.5, colors.accent);
      grad.addColorStop(1, "rgba(255,80,30,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "cloud") {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = `${colors.dark}aa`;
    const puffs = [[-s * 0.45, 0, s * 0.32], [0, -s * 0.18, s * 0.4], [s * 0.45, 0, s * 0.32], [0, s * 0.18, s * 0.3]];
    ctx.beginPath();
    for (const [x, y, rad] of puffs) {
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  } else if (kind === "shard") {
    ctx.fillStyle = colors.accent;
    const shards = [[-s * 0.35, -s * 0.1, s * 0.18, s * 0.55], [s * 0.05, -s * 0.25, s * 0.14, s * 0.45], [s * 0.4, 0, s * 0.16, s * 0.6]];
    for (const [x, y, w, h] of shards) {
      ctx.beginPath();
      ctx.moveTo(x, y - h / 2);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x, y + h / 2);
      ctx.lineTo(x - w, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === "crystal") {
    ctx.fillStyle = colors.accent;
    const cs = s * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, -cs);
    ctx.lineTo(cs * 0.55, -cs * 0.25);
    ctx.lineTo(cs * 0.45, cs * 0.6);
    ctx.lineTo(-cs * 0.45, cs * 0.6);
    ctx.lineTo(-cs * 0.55, -cs * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(0, -cs);
    ctx.lineTo(0, cs * 0.6);
    ctx.moveTo(-cs * 0.55, -cs * 0.25);
    ctx.lineTo(cs * 0.55, -cs * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCreature(ctx, card, cx, cy, r) {
  const colors = colorsFor(card);
  const shape = card.body || "round";
  ctx.save();
  ctx.translate(cx, cy);
  drawCreatureEars(ctx, card.ears || "round", r, colors);
  drawCreatureBody(ctx, shape, r, colors);
  drawCreatureMarkings(ctx, card.markings || "none", shape, r, colors);
  drawCreatureEyes(ctx, shape, r, card.expression || "smile");
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

  // ---------- juice: audio (synthesized, no asset files) ----------
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }
  function tone({ freq = 440, freqEnd = freq, dur = 0.12, type = "triangle", vol = 0.1, delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function noiseBurst({ dur = 0.18, vol = 0.16, filter = 1400 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const frames = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }
  const sfx = {
    throw() { tone({ freq: 320, freqEnd: 720, dur: 0.13, type: "triangle", vol: 0.08 }); },
    hit() { tone({ freq: 190, freqEnd: 85, dur: 0.16, type: "square", vol: 0.11 }); noiseBurst({ dur: 0.07, vol: 0.09, filter: 2400 }); },
    block() { tone({ freq: 135, freqEnd: 80, dur: 0.12, type: "square", vol: 0.08 }); },
    smash() { noiseBurst({ dur: 0.26, vol: 0.2, filter: 1100 }); tone({ freq: 95, freqEnd: 48, dur: 0.18, type: "sawtooth", vol: 0.06 }); },
    miss() { tone({ freq: 300, freqEnd: 150, dur: 0.22, type: "sine", vol: 0.05 }); },
    dodge() { tone({ freq: 620, freqEnd: 1150, dur: 0.1, type: "sine", vol: 0.045 }); },
    capture() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.17, type: "triangle", vol: 0.1, delay: i * 0.085 })); },
  };

  // ---------- juice: screen shake ----------
  let shakeMag = 0;
  function addShake(m) { shakeMag = Math.min(10, Math.max(shakeMag, m)); }

  // ---------- juice: particles ----------
  const particles = [];
  const rings = [];
  function addParticle(p) {
    particles.push(p);
    if (particles.length > 150) particles.splice(0, particles.length - 150);
  }
  function spawnSplinters(x, y, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 190;
      addParticle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,
        g: 640,
        life: 0.45 + Math.random() * 0.4, maxLife: 0.85,
        w: 3 + Math.random() * 4, h: 6 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 16,
        color: Math.random() < 0.5 ? "#b08148" : "#7a5230",
        shape: "rect",
      });
    }
  }
  function spawnSparks(x, y, color = "#ffe27a") {
    for (let i = 0; i < 13; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 230;
      addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 130,
        life: 0.22 + Math.random() * 0.3, maxLife: 0.52,
        size: 1.6 + Math.random() * 2.6, color, shape: "spark",
      });
    }
  }
  function spawnConfetti(x, y) {
    const cols = ["#7cf0c6", "#ffe27a", "#ff9c70", "#8fb4ff", "#ff8d9e", "#b57cff"];
    for (let i = 0; i < 36; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.5;
      const sp = 140 + Math.random() * 250;
      addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 520, drag: 0.55,
        sway: Math.random() * Math.PI * 2, swaySp: 4 + Math.random() * 4,
        life: 0.9 + Math.random() * 0.8, maxLife: 1.7,
        w: 4 + Math.random() * 4, h: 7 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 18,
        color: cols[i % cols.length], shape: "rect",
      });
    }
  }
  function spawnDust(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      const sp = 20 + Math.random() * 50;
      addParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 60,
        life: 0.3 + Math.random() * 0.25, maxLife: 0.55,
        size: 2.2 + Math.random() * 2.8, color: "rgba(196, 176, 140, 0.7)", shape: "spark",
      });
    }
  }
  function spawnRing(x, y) { rings.push({ x, y, r: 6, life: 0.5, maxLife: 0.5 }); }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (p.drag) p.vx *= 1 - p.drag * dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.sway != null) { p.sway += p.swaySp * dt; p.x += Math.sin(p.sway) * 24 * dt; }
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    for (const rg of rings) { rg.life -= dt; rg.r += 230 * dt; }
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);
    if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - dt * 42);
  }
  function drawParticles() {
    for (const rg of rings) {
      const k = rg.life / rg.maxLife;
      ctx.save();
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = "#7cf0c6";
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of particles) {
      const k = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = k;
      if (p.shape === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  }

  // ---------- juice: ball trail + near-miss tracking ----------
  const trail = [];
  let minMiss = Infinity;

  // ---------- scene: layered animated background ----------
  let elapsed = 0;
  let bumpCd = 0;
  const GROUND_Y = Math.max(FLOOR_Y - 34, H * 0.78);
  const stars = [];
  for (let i = 0, n = Math.round(W / 11); i < n; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * (GROUND_Y * 0.66),
      r: 0.5 + Math.random() * 1.5,
      ph: Math.random() * Math.PI * 2,
      sp: 0.8 + Math.random() * 2.4,
    });
  }
  const hillFar = { base: GROUND_Y - 56, amp: 24, k: 0.011, phase: Math.random() * 6, color: "rgba(46, 60, 104, 0.45)" };
  const hillNear = { base: GROUND_Y - 26, amp: 18, k: 0.019, phase: Math.random() * 6, color: "rgba(30, 42, 78, 0.65)" };
  const tufts = [];
  for (let x = 6; x < W; x += 18 + Math.random() * 12) {
    const c = Math.random();
    tufts.push({
      x,
      h: 7 + Math.random() * 13,
      ph: Math.random() * Math.PI * 2,
      color: c < 0.4 ? "rgba(124, 240, 198, 0.55)" : c < 0.7 ? "rgba(96, 210, 178, 0.5)" : "rgba(150, 255, 220, 0.45)",
    });
  }
  const motes = [];
  for (let i = 0, n = Math.round(W / 24); i < n; i++) {
    motes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.8 + Math.random() * 1.8,
      sp: 7 + Math.random() * 16,
      ph: Math.random() * Math.PI * 2,
    });
  }
  function updateScene(dt) {
    for (const m of motes) {
      m.y -= m.sp * dt;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
    }
  }

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
  const NEAR_WORDS = ["SO CLOSE!", "WHIFF!", "JUST MISSED!", "ALMOST!", "EEK, MISSED!"];
  const COMIC_COLORS = { hit: "#ffe27a", final: "#7cf0c6", smash: "#ff9c70", block: "#cdd6f0", near: "#ffd27c" };
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
      spawnSplinters(o.x, o.y, 18);
      addShake(4.6);
      sfx.smash();
    } else {
      popComic(pickWord(BLOCK_WORDS), o.x, o.y - o.h / 2 - 6, "block");
      spawnSplinters(o.x, o.y, 6);
      addShake(2.4);
      sfx.block();
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
    ctx.save();
    ctx.globalAlpha = fade * 0.26;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(o.x, FLOOR_Y - 2, o.w * 0.55, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    ensureAudio();
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
    trail.length = 0;
    minMiss = Infinity;
    ensureAudio();
    sfx.throw();
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

  // Keep the fokemon out of the crates so they act as real cover.
  function resolveObstacleCollision() {
    const R = fokemon.r * 0.62;
    for (const o of obstacles) {
      if (o.broken) continue;
      const left = o.x - o.w / 2;
      const right = o.x + o.w / 2;
      const top = o.y - o.h / 2;
      const bottom = o.y + o.h / 2;
      const cx = Math.max(left, Math.min(fokemon.x, right));
      const cy = Math.max(top, Math.min(fokemon.y, bottom));
      const dx = fokemon.x - cx;
      const dy = fokemon.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;

      if (d2 > 0.001) {
        const d = Math.sqrt(d2);
        const push = R - d;
        fokemon.x += (dx / d) * push;
        fokemon.y += (dy / d) * push;
        if (Math.abs(dx) > Math.abs(dy)) {
          fokemon.vx = (dx > 0 ? 1 : -1) * Math.abs(fokemon.vx || 60);
        } else {
          fokemon.targetY = fokemon.y;
        }
      } else {
        // Center buried inside the crate: eject along the shallowest face.
        const pl = fokemon.x - left;
        const pr = right - fokemon.x;
        const pt = fokemon.y - top;
        const pb = bottom - fokemon.y;
        let m = Math.min(pl, pr, pt, pb);
        if (m === pl && left - R < FOKEMON_MIN_X) m = Math.min(pt, pb);
        if (m === pl) { fokemon.x = left - R; fokemon.vx = -Math.abs(fokemon.vx || 60); }
        else if (m === pr) { fokemon.x = right + R; fokemon.vx = Math.abs(fokemon.vx || 60); }
        else if (m === pt) { fokemon.y = top - R; fokemon.targetY = fokemon.y; }
        else { fokemon.y = bottom + R; fokemon.targetY = fokemon.y; }
      }

      if (fokemon.jumpState === "air") {
        fokemon.jumpState = "rest";
        fokemon.restTime = 0.14 + Math.random() * 0.2;
      }
      fokemon.turnCd = Math.min(fokemon.turnCd, 0.14);
      if (bumpCd <= 0) {
        spawnDust(cx, cy);
        o.shakeTime = Math.max(o.shakeTime, 0.1);
        bumpCd = 0.45;
      }
    }
  }

  function step(dt) {
    fokemon.bobPhase += dt * 2.4;
    if (fokemon.flashTime > 0) fokemon.flashTime = Math.max(0, fokemon.flashTime - dt);
    if (bumpCd > 0) bumpCd -= dt;

    if (!fokemon.caught) {
      if (fokemon.dodgeTime > 0) {
        fokemon.x = clampX(fokemon.x + fokemon.dodgeVx * dt);
        fokemon.dodgeTime -= dt;
        if (fokemon.dodgeTime <= 0) fokemon.dodgeVx = 0;
      } else {
        updateMovement(dt);
      }
      resolveObstacleCollision();
      fokemon.x = clampX(fokemon.x);
      fokemon.y = Math.max(fokemon.r * 0.5, Math.min(FLOOR_Y - fokemon.r * 0.7, fokemon.y));
    } else {
      fokemon.captureScale = Math.max(0, fokemon.captureScale - dt * 2.4);
    }

    if (projectile) {
      netSpin += dt * 8;
      projectile.vy += GRAVITY * dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      const bobY = fokemon.y + Math.sin(fokemon.bobPhase) * fokemon.bobAmp;

      trail.push({ x: projectile.x, y: projectile.y });
      if (trail.length > 16) trail.shift();
      if (!fokemon.caught) {
        const md = Math.hypot(projectile.x - fokemon.x, projectile.y - bobY);
        if (md < minMiss) minMiss = md;
      }

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
          sfx.dodge();
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
            spawnConfetti(fokemon.x, bobY);
            spawnSparks(fokemon.x, bobY, "#7cf0c6");
            spawnRing(fokemon.x, bobY);
            addShake(7);
            sfx.capture();
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
          spawnSparks(fokemon.x, bobY, "#ffe27a");
          addShake(3.6);
          sfx.hit();
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
        if (!fokemon.caught && minMiss < fokemon.r + NET_RADIUS + 34) {
          popComic(pickWord(NEAR_WORDS), fokemon.x, bobY - fokemon.r - 6, "near");
          addShake(1.6);
          sfx.miss();
        }
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

  function drawHill(h) {
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(-14, H);
    for (let x = -14; x <= W + 14; x += 14) {
      const y = h.base + Math.sin(x * h.k + h.phase) * h.amp + Math.sin(x * h.k * 2.3 + h.phase) * h.amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 14, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground(time) {
    ctx.clearRect(0, 0, W, H);

    // Twinkling starfield (the .arena CSS nebula shows through behind it).
    ctx.fillStyle = "#cfe0ff";
    for (const s of stars) {
      ctx.globalAlpha = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * s.sp + s.ph))) * 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Parallax hill silhouettes for depth.
    drawHill(hillFar);
    drawHill(hillNear);

    // Ground plane.
    const grad = ctx.createLinearGradient(0, GROUND_Y - 8, 0, H);
    grad.addColorStop(0, "rgba(22, 64, 74, 0.55)");
    grad.addColorStop(0.18, "rgba(14, 42, 56, 0.88)");
    grad.addColorStop(1, "rgba(6, 16, 30, 0.97)");
    ctx.fillStyle = grad;
    ctx.fillRect(-16, GROUND_Y - 2, W + 32, H - GROUND_Y + 16);

    // Receding perspective grid on the ground.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.clip();
    ctx.strokeStyle = "rgba(124, 240, 198, 0.11)";
    ctx.lineWidth = 1;
    const vx = W * 0.5;
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(vx + i * (W * 0.055), GROUND_Y);
      ctx.lineTo(vx + i * (W * 0.62), H + 24);
      ctx.stroke();
    }
    const depth = H - GROUND_Y;
    for (let r = 1; r <= 5; r++) {
      const yy = GROUND_Y + Math.pow(r / 5, 1.7) * depth;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Glowing neon horizon line at the play floor.
    ctx.save();
    ctx.shadowColor = "rgba(124, 240, 198, 0.85)";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "rgba(168, 255, 224, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();
    ctx.restore();

    // Swaying energy tufts along the floor.
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const t of tufts) {
      const sway = Math.sin(time * 1.7 + t.ph) * 3.2;
      ctx.strokeStyle = t.color;
      ctx.beginPath();
      ctx.moveTo(t.x, GROUND_Y + 1);
      ctx.quadraticCurveTo(t.x + sway * 0.5, GROUND_Y - t.h * 0.6, t.x + sway, GROUND_Y - t.h);
      ctx.stroke();
    }

    // Drifting ambient motes.
    ctx.fillStyle = "#7cf0c6";
    for (const m of motes) {
      ctx.globalAlpha = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(time * 1.3 + m.ph));
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(time * 0.6 + m.ph) * 10, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Soft vignette to focus the action.
    const vig = ctx.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.34, W / 2, H * 0.52, Math.max(W, H) * 0.75);
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
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

  function drawBallTrail() {
    if (trail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < trail.length; i++) {
      const k = i / trail.length;
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = "#7cf0c6";
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, NET_RADIUS * (0.22 + k * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
    drawBackground(elapsed);

    const sx = shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const sy = shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0;
    ctx.save();
    ctx.translate(sx, sy);

    drawFokemon();
    drawObstacles();

    const netPos = projectile ? projectile : netRestPosition();
    drawSlingshot(netPos, !!projectile);
    drawTrajectory();
    if (projectile) drawBallTrail();
    drawNet(netPos, !!projectile);
    drawParticles();
    drawComicTexts();

    ctx.restore();
  }

  let lastTime = performance.now();
  let rafId = 0;
  function loop(now) {
    if (!document.body.contains(challenge)) return;
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    elapsed += dt;
    updateObstacles(dt);
    updateComicTexts(dt);
    updateParticles(dt);
    updateScene(dt);
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
  // Legacy helper kept around; new flows use availableInstances directly.
  const counts = new Map();
  for (const c of caught) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ card: cardsById.get(id), count }))
    .filter((e) => e.card)
    .sort((a, b) => (b.card.hp + b.card.atk + b.card.def + b.card.spd) - (a.card.hp + a.card.atk + a.card.def + a.card.spd));
}

function speciesIndexForInstance(uid) {
  const entry = getInstance(uid);
  if (!entry) return { idx: 1, total: 1 };
  const siblings = caught
    .filter((c) => c && c.id === entry.id)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const idx = siblings.findIndex((c) => c.uid === uid);
  return { idx: idx + 1, total: siblings.length };
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
  const entries = availableInstances(caught);
  if (!caught.length) {
    return `<p class="empty-state">Catch some Fokemon first — you can't deploy what you don't have.</p>`;
  }
  if (!entries.length) {
    return `<p class="empty-state">Every one of your Fokemon is already deployed at a gym. Recall one before sending another into the ring.</p>`;
  }
  // Sort by total power (with boosts) so the trained heavyweights are first.
  entries.sort((a, b) => instancePower(b) - instancePower(a));
  return `
    <p class="picker-prompt">Pick your fighter to ${escapeHtml(actionLabel)}:</p>
    <div class="picker-grid">
      ${entries.map((entry) => {
        const card = cardsById.get(entry.id);
        if (!card) return "";
        const colors = colorsFor(card);
        const total = instancePower(entry);
        const trained = (entry.boosts?.hp || 0) + (entry.boosts?.atk || 0) + (entry.boosts?.def || 0) + (entry.boosts?.spd || 0);
        const { idx, total: of } = speciesIndexForInstance(entry.uid);
        return `
          <button class="picker-card" data-uid="${escapeHtml(entry.uid)}" style="--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};">
            <span class="picker-power">⚡${total}</span>
            <strong>${escapeHtml(card.name)}${of > 1 ? ` <small>#${idx}</small>` : ""}</strong>
            <small>${escapeHtml(card.type)}${trained ? ` • +${trained} trained` : ""}</small>
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
            const uid = btn.dataset.uid;
            const entry = getInstance(uid);
            if (!entry || entry.deployedAt) return;
            const card = cardsById.get(entry.id);
            if (!card) return;
            const champ = {
              trainer: profile.name,
              team: profile.team || "mint",
              cardId: entry.id,
              instanceUid: entry.uid,
              boosts: { ...entry.boosts },
              defenses: 0,
              placedAt: Date.now(),
              lastBattleAt: 0,
            };
            markInstanceDeployed(entry.uid, site.id);
            championsBySite.set(site.id, champ);
            publishChampion(site.id, champ);
            renderCollection();
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
        // Carry the gym's training boosts back home before clearing the deploy.
        if (champion.instanceUid && getInstance(champion.instanceUid)) {
          applyInstanceBoosts(champion.instanceUid, champion.boosts);
          restoreInstanceHome(champion.instanceUid, champion.boosts);
        }
        championsBySite.delete(site.id);
        publishChampionRemoved(site.id);
        renderCollection();
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
          const uid = btn.dataset.uid;
          const entry = getInstance(uid);
          if (!entry || entry.deployedAt) return;
          const card = cardsById.get(entry.id);
          if (!card) return;
          close();
          launchBattle(site, card, champion, entry);
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

  // ---------- juice: audio (synthesized, no asset files) ----------
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }
  function tone({ freq = 440, freqEnd = freq, dur = 0.12, type = "triangle", vol = 0.1, delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function noiseBurst({ dur = 0.18, vol = 0.16, filter = 1400 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const frames = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }
  const sfx = {
    tick(strength = 1) { tone({ freq: 220 + strength * 360, dur: 0.04, type: "square", vol: 0.018 + strength * 0.03 }); },
    lock() { tone({ freq: 520, freqEnd: 760, dur: 0.14, type: "triangle", vol: 0.06 }); },
    ball() { [659, 880, 1175].forEach((f, i) => tone({ freq: f, dur: 0.14, type: "triangle", vol: 0.085, delay: i * 0.06 })); },
    empty() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.2, type: "triangle", vol: 0.1, delay: i * 0.09 })); noiseBurst({ dur: 0.2, vol: 0.05, filter: 3200 }); },
  };

  // ---------- juice: particles + screen shake ----------
  const particles = [];
  let shakeMag = 0;
  function addShake(m) { shakeMag = Math.min(10, Math.max(shakeMag, m)); }
  function spawnBallBurst(cx, cy) {
    const cols = ["#7cf0c6", "#ffe27a", "#8fb4ff", "#ff8d9e", "#ffffff"];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 110 + Math.random() * 240;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        g: 420,
        life: 0.45 + Math.random() * 0.5, maxLife: 0.95,
        size: 1.8 + Math.random() * 2.8,
        color: cols[i % cols.length],
      });
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - dt * 40);
  }
  function drawParticles() {
    for (const p of particles) {
      const k = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = k;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const SPOKES = 6;
  let lastDetent = 0;
  let wasAboveThreshold = false;

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
    sfx.ball();
    spawnBallBurst(CX, CY);
    addShake(4);
    if (readoutBalls) readoutBalls.textContent = String(collected);
    if (readoutBag) readoutBag.textContent = String(fokeBalls);
    if (collected >= MAX_POI_REWARD) {
      // Cache fully drained — mark spent now.
      sfx.empty();
      addShake(8);
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
    ensureAudio();
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

    // Ratchet click as each spoke passes the top — pitch/volume track speed.
    const detentSize = (Math.PI * 2) / SPOKES;
    const detent = Math.floor(theta / detentSize);
    if (detent !== lastDetent && absO > 0.35) {
      lastDetent = detent;
      sfx.tick(Math.min(1, absO / MAX_OMEGA));
    } else if (detent !== lastDetent) {
      lastDetent = detent;
    }

    // "Locked in" chime when first crossing the speed line.
    const above = absO >= THRESHOLD && collected < MAX_POI_REWARD;
    if (above && !wasAboveThreshold) sfx.lock();
    wasAboveThreshold = above;

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

    updateParticles(dt);
    setStatus();
  }

  function drawWheel() {
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
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeMag > 0) {
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    }
    drawWheel();
    drawParticles();
    ctx.restore();
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
      <p class="train-help">Drag to dodge the trainer-balls — an amber ⚠ flash warns which edge each one fires from. Grab the glowing 💚 FokéFood to refill your hearts. Each near-miss earns reps; boost stats when the drill ends.</p>
      <div class="arena training-arena">
        <canvas class="training-canvas" aria-label="Training arena"></canvas>
      </div>
      <p class="status" aria-live="polite">Drag to dodge • watch the edge warnings • grab FokéFood to heal</p>
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
  let dying = 0;
  let dragging = false;
  let totalElapsed = 0;
  let nextSpawnIn = 1.4;
  let spawnInterval = 1.4;
  let difficulty = 0;
  let fokePos = { x: W / 2, y: H / 2 };
  const balls = [];
  const sparks = [];
  const comicTexts = [];
  const telegraphs = [];
  const particles = [];
  const rings = [];
  let food = null;
  let foodTimer = 9 + Math.random() * 4;
  const FOOD_R = 14;
  let shakeMag = 0;
  let hitFlash = 0;

  // ---------- juice: audio (synthesized, no asset files) ----------
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }
  function tone({ freq = 440, freqEnd = freq, dur = 0.12, type = "triangle", vol = 0.1, delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function noiseBurst({ dur = 0.18, vol = 0.16, filter = 1400 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const frames = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }
  const sfx = {
    warn() { tone({ freq: 940, freqEnd: 1180, dur: 0.07, type: "sine", vol: 0.03 }); },
    incoming() { tone({ freq: 680, freqEnd: 300, dur: 0.16, type: "sine", vol: 0.045 }); },
    hit() { tone({ freq: 175, freqEnd: 78, dur: 0.17, type: "square", vol: 0.12 }); noiseBurst({ dur: 0.08, vol: 0.1, filter: 2200 }); },
    whiff() { tone({ freq: 520, freqEnd: 920, dur: 0.1, type: "sine", vol: 0.04 }); },
    streak() { [660, 880].forEach((f, i) => tone({ freq: f, dur: 0.12, type: "triangle", vol: 0.07, delay: i * 0.07 })); },
    food() { [523, 659, 880].forEach((f, i) => tone({ freq: f, dur: 0.15, type: "triangle", vol: 0.09, delay: i * 0.08 })); },
    ko() { noiseBurst({ dur: 0.32, vol: 0.18, filter: 900 }); tone({ freq: 210, freqEnd: 55, dur: 0.4, type: "sawtooth", vol: 0.08 }); },
  };

  // ---------- juice: screen shake + particles ----------
  function addShake(m) { shakeMag = Math.min(12, Math.max(shakeMag, m)); }
  function addParticle(p) {
    particles.push(p);
    if (particles.length > 160) particles.splice(0, particles.length - 160);
  }
  function spawnBurst(x, y, color, count = 14, opts = {}) {
    const spread = opts.spread ?? 240;
    const up = opts.up ?? 0;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * spread;
      addParticle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - up,
        g: opts.g ?? 0,
        life: 0.3 + Math.random() * (opts.life ?? 0.4), maxLife: 0.7,
        size: 1.6 + Math.random() * 2.6,
        color, shape: opts.shape ?? "spark",
      });
    }
  }
  function spawnRing(x, y, color) { rings.push({ x, y, r: 6, life: 0.45, maxLife: 0.45, color }); }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    for (const rg of rings) { rg.life -= dt; rg.r += 200 * dt; }
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);
    if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - dt * 46);
    if (hitFlash > 0) hitFlash = Math.max(0, hitFlash - dt * 2.4);
  }
  function drawParticles() {
    for (const rg of rings) {
      const k = rg.life / rg.maxLife;
      ctx.save();
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of particles) {
      const k = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = k;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- scene: drifting ambient motes ----------
  const motes = [];
  for (let i = 0, n = Math.round(W / 26); i < n; i++) {
    motes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.8 + Math.random() * 1.7,
      sp: 6 + Math.random() * 14,
      ph: Math.random() * Math.PI * 2,
    });
  }
  function updateScene(dt) {
    for (const m of motes) {
      m.y -= m.sp * dt;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
    }
  }

  function setHpText(healed) {
    if (!hpEl) return;
    let html = "";
    for (let i = 0; i < hpMax; i++) {
      html += `<span class="train-heart ${i < hp ? "full" : "empty"}" aria-hidden="true">♥</span>`;
    }
    hpEl.innerHTML = html;
    hpEl.setAttribute("aria-label", `${hp} of ${hpMax} hearts`);
    hpEl.classList.toggle("hp-low", hp <= 1 && hp > 0);
    if (healed) {
      hpEl.classList.remove("heal");
      void hpEl.offsetWidth; // restart the pulse animation
      hpEl.classList.add("heal");
    }
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
    ensureAudio();
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

  // Spawning is telegraphed: a warning marker + aim line flashes at the edge
  // for ~0.5s before the ball actually appears, so you always know where it's
  // coming from even when your hand is over that edge.
  function spawnBall(dt) {
    nextSpawnIn -= dt;
    if (nextSpawnIn > 0) return;
    nextSpawnIn = spawnInterval;
    const edge = Math.floor(Math.random() * 4);
    let x, y, mx, my;
    if (edge === 0) { x = Math.random() * W; y = -20; mx = clamp(x, 20, W - 20); my = 18; }
    else if (edge === 1) { x = W + 20; y = Math.random() * H; mx = W - 18; my = clamp(y, 20, H - 20); }
    else if (edge === 2) { x = Math.random() * W; y = H + 20; mx = clamp(x, 20, W - 20); my = H - 18; }
    else { x = -20; y = Math.random() * H; mx = 18; my = clamp(y, 20, H - 20); }
    const targetJitterX = (Math.random() - 0.5) * 90;
    const targetJitterY = (Math.random() - 0.5) * 90;
    const tx = fokePos.x + targetJitterX;
    const ty = fokePos.y + targetJitterY;
    const dx = tx - x;
    const dy = ty - y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 230 + difficulty * 90 + Math.random() * 80;
    const warn = Math.max(0.42, 0.62 - difficulty * 0.06);
    telegraphs.push({
      x, y, mx, my, tx, ty,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      ux: dx / dist, uy: dy / dist,
      warn, maxWarn: warn,
    });
    sfx.warn();
  }

  function updateTelegraphs(dt) {
    for (const t of telegraphs) t.warn -= dt;
    for (let i = telegraphs.length - 1; i >= 0; i--) {
      const t = telegraphs[i];
      if (t.warn <= 0) {
        balls.push({
          x: t.x, y: t.y,
          vx: t.vx, vy: t.vy,
          r: 11,
          passed: false,
          spin: Math.random() * Math.PI * 2,
          trail: [],
        });
        sfx.incoming();
        telegraphs.splice(i, 1);
      }
    }
  }

  function spawnFood() {
    const margin = PLAYER_R * 2.4;
    let fx = 0, fy = 0;
    for (let tries = 0; tries < 12; tries++) {
      fx = margin + Math.random() * (W - margin * 2);
      fy = margin + Math.random() * (H - margin * 2);
      if (Math.hypot(fx - fokePos.x, fy - fokePos.y) > PLAYER_R * 3.2) break;
    }
    food = { x: fx, y: fy, life: 7.5, maxLife: 7.5, pulse: Math.random() * Math.PI * 2 };
  }

  function updateFood(dt) {
    if (!food) {
      foodTimer -= dt;
      if (foodTimer <= 0) { spawnFood(); foodTimer = 15 + Math.random() * 7; }
      return;
    }
    food.life -= dt;
    food.pulse += dt * 5;
    if (food.life <= 0) { food = null; return; }
    if (Math.hypot(food.x - fokePos.x, food.y - fokePos.y) < PLAYER_R + FOOD_R + 6) {
      if (hp < hpMax) {
        const before = hp;
        hp = hpMax; // FokéFood tops you back up to full
        setHpText(true);
        popComic(hpMax - before > 1 ? "FULL HEAL!" : "YUM! +1 HP", food.x, food.y - FOOD_R - 8, "#7cf0c6");
      } else {
        score += 3;
        if (scoreEl) scoreEl.textContent = String(score);
        popComic("YUM! +3", food.x, food.y - FOOD_R - 8, "#ffe27a");
      }
      spawnBurst(food.x, food.y, "#7cf0c6", 20, { spread: 200, life: 0.5 });
      spawnRing(food.x, food.y, "#7cf0c6");
      addShake(2.2);
      sfx.food();
      food = null;
    }
  }

  function updateBalls(dt) {
    for (const b of balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += dt * 8;
      if (b.trail) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 9) b.trail.shift();
      }
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
        spawnBurst(fokePos.x, fokePos.y, "#ff8ca6", 18, { spread: 260, life: 0.45 });
        spawnRing(fokePos.x, fokePos.y, "#ff8ca6");
        hitFlash = 1;
        if (hp <= 0) {
          addShake(9);
          spawnBurst(fokePos.x, fokePos.y, "#ffd27c", 26, { spread: 320, life: 0.6 });
          sfx.ko();
          dying = 0.85;
        } else {
          addShake(5);
          sfx.hit();
        }
      } else if (!b.passed && dist < PLAYER_R + 38 && (b.vx * dx + b.vy * dy) > 0) {
        // ball just whizzed past
        b.passed = true;
        score += 1;
        if (scoreEl) scoreEl.textContent = String(score);
        if (score % 5 === 0) {
          popComic("STREAK!", fokePos.x, fokePos.y - PLAYER_R - 4, "#ffe27a");
          spawnRing(fokePos.x, fokePos.y, "#ffe27a");
          sfx.streak();
        } else {
          popComic("WHIFF!", b.x, b.y, "#7cf0c6");
          sfx.whiff();
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
    if (dying > 0) {
      dying -= dt;
      updateScene(dt);
      updateParticles(dt);
      updateFx(dt);
      if (dying <= 0) endDrill("ko");
      return;
    }
    totalElapsed += dt;
    difficulty = Math.min(2.4, totalElapsed / 18);
    spawnInterval = Math.max(0.35, 1.35 - difficulty * 0.32);
    spawnBall(dt);
    updateTelegraphs(dt);
    updateBalls(dt);
    updateFood(dt);
    updateScene(dt);
    updateParticles(dt);
    updateFx(dt);
  }

  function drawBackground(time) {
    // Translucent base so the .arena nebula glows through.
    ctx.fillStyle = "rgba(7, 11, 22, 0.55)";
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;

    // Soft floor glow under the action.
    const fl = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.62);
    fl.addColorStop(0, "rgba(124, 240, 198, 0.10)");
    fl.addColorStop(1, "rgba(124, 240, 198, 0)");
    ctx.fillStyle = fl;
    ctx.fillRect(0, 0, W, H);

    // Slowly scrolling grid for motion.
    const off = (time * 13) % 40;
    ctx.strokeStyle = "rgba(124, 240, 198, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -40 + off; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -40 + off; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Concentric dojo target rings, gently pulsing.
    const baseR = Math.min(W, H) * 0.5;
    for (let i = 0; i < 4; i++) {
      const pr = baseR * (0.26 + i * 0.22) + Math.sin(time * 1.4 + i) * 4;
      ctx.strokeStyle = `rgba(143, 171, 255, ${0.1 - i * 0.018})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Corner accent glows.
    for (const [gx, gy, gc] of [
      [0, 0, "rgba(181, 124, 255, 0.16)"],
      [W, 0, "rgba(75, 183, 255, 0.16)"],
      [0, H, "rgba(75, 183, 255, 0.14)"],
      [W, H, "rgba(181, 124, 255, 0.14)"],
    ]) {
      const cg = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.min(W, H) * 0.42);
      cg.addColorStop(0, gc);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);
    }

    // Drifting ambient motes.
    ctx.fillStyle = "#7cf0c6";
    for (const m of motes) {
      ctx.globalAlpha = 0.14 + 0.2 * (0.5 + 0.5 * Math.sin(time * 1.3 + m.ph));
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(time * 0.6 + m.ph) * 9, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Vignette.
    const vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.34, cx, cy, Math.max(W, H) * 0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTelegraphs() {
    for (const t of telegraphs) {
      const k = 1 - t.warn / t.maxWarn; // 0 -> 1 as it nears firing
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(t.warn * 16));
      ctx.save();

      // Faint aim line from the spawn edge toward the target.
      ctx.globalAlpha = 0.18 + 0.32 * k;
      ctx.strokeStyle = "#ffb24d";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.moveTo(t.mx, t.my);
      ctx.lineTo(t.mx + t.ux * (90 + 120 * k), t.my + t.uy * (90 + 120 * k));
      ctx.stroke();
      ctx.setLineDash([]);

      // Pulsing warning chevron at the edge, pointing inward.
      const ang = Math.atan2(t.uy, t.ux);
      ctx.translate(t.mx, t.my);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
      ctx.fillStyle = "#ff9c40";
      ctx.shadowColor = "rgba(255, 156, 64, 0.9)";
      ctx.shadowBlur = 10;
      const s = 9 + 5 * pulse;
      for (let c = 0; c < 2; c++) {
        const ox = c * 8;
        ctx.beginPath();
        ctx.moveTo(ox - 4, -s);
        ctx.lineTo(ox + s - 4, 0);
        ctx.lineTo(ox - 4, s);
        ctx.lineTo(ox - 1, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawFood() {
    if (!food) return;
    const blink = food.life < 1.6 ? (Math.sin(food.life * 22) > -0.1 ? 1 : 0.18) : 1;
    if (!blink) return;
    const pulse = 1 + Math.sin(food.pulse) * 0.08;
    const r = FOOD_R * pulse;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(food.x, food.y);

    // Halo.
    const halo = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.1);
    halo.addColorStop(0, "rgba(124, 240, 198, 0.5)");
    halo.addColorStop(1, "rgba(124, 240, 198, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // Berry body (warm green/gold — clearly friendly vs the red trainer-balls).
    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r);
    body.addColorStop(0, "#b6f5c8");
    body.addColorStop(0.55, "#5fd39a");
    body.addColorStop(1, "#2f9d63");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(7, 30, 20, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Leaf.
    ctx.fillStyle = "#8be86b";
    ctx.beginPath();
    ctx.ellipse(r * 0.18, -r * 1.05, r * 0.42, r * 0.22, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3aa64a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.9);
    ctx.lineTo(r * 0.05, -r * 1.18);
    ctx.stroke();

    // Heart glyph to read as "heal".
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    const hs = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(0, hs * 0.55);
    ctx.bezierCurveTo(hs * 1.1, -hs * 0.35, hs * 0.45, -hs * 1.05, 0, -hs * 0.35);
    ctx.bezierCurveTo(-hs * 0.45, -hs * 1.05, -hs * 1.1, -hs * 0.35, 0, hs * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBall(b) {
    if (b.trail && b.trail.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < b.trail.length; i++) {
        const k = i / b.trail.length;
        ctx.globalAlpha = k * 0.4;
        ctx.fillStyle = "#ff8ca6";
        ctx.beginPath();
        ctx.arc(b.trail[i].x, b.trail[i].y, b.r * (0.3 + k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
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
    drawBackground(totalElapsed);

    const sx = shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const sy = shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0;
    ctx.save();
    ctx.translate(sx, sy);
    drawTelegraphs();
    drawFood();
    drawSparks();
    for (const b of balls) drawBall(b);
    drawPlayer();
    drawParticles();
    drawComicTexts();
    ctx.restore();

    // Edge danger flash when hit (screen space, not shaken).
    if (hitFlash > 0) {
      const a = Math.min(1, hitFlash) * 0.5;
      const eg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62);
      eg.addColorStop(0, "rgba(255, 60, 90, 0)");
      eg.addColorStop(1, `rgba(255, 60, 90, ${a})`);
      ctx.fillStyle = eg;
      ctx.fillRect(0, 0, W, H);
    }
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
    // Mirror the latest training boosts onto the inventory instance so they
    // persist if the gym is later defeated/retired and the Fokemon comes home.
    if (updated.instanceUid && getInstance(updated.instanceUid)) {
      applyInstanceBoosts(updated.instanceUid, updated.boosts);
      renderCollection();
    }
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

function launchBattle(site, challengerCard, championBefore, challengerInstance = null) {
  if (activeChallenge) return;
  if (!challengerCard) return;
  const champCard = cardsById.get(championBefore.cardId);
  if (!champCard) return;

  // Apply the challenger instance's accumulated training boosts in the fight.
  const challengerBoosts = challengerInstance?.boosts || null;
  const attackerStats = effectiveStats(challengerCard, challengerBoosts ? { boosts: challengerBoosts, defenses: 0 } : null);
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
      <div class="battle-roster">
        <div class="roster-side challenger">
          <div class="roster-top">
            <span class="roster-name">${escapeHtml(challengerCard.name)} <span class="type-pill" style="background:${colorsFor(challengerCard).accent};color:#061226;">${escapeHtml(challengerCard.type)}</span></span>
            <small class="hp-text challenger-hp-text">${attackerStats.hp} / ${attackerStats.hp}</small>
          </div>
          <div class="hp-bar"><div class="hp-fill challenger-hp" style="width:100%"></div></div>
          <p class="roster-label">${escapeHtml(profile?.name || "You")}</p>
        </div>
        <span class="vs-pill">VS</span>
        <div class="roster-side defender">
          <div class="roster-top">
            <span class="roster-name">${escapeHtml(champCard.name)} <span class="type-pill" style="background:${colorsFor(champCard).accent};color:#061226;">${escapeHtml(champCard.type)}</span></span>
            <small class="hp-text defender-hp-text">${defenderStats.hp} / ${defenderStats.hp}</small>
          </div>
          <div class="hp-bar"><div class="hp-fill defender-hp" style="width:100%"></div></div>
          <p class="roster-label">${escapeHtml(championBefore.trainer)}</p>
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

  // ---------- juice: audio (synthesized, no asset files) ----------
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }
  function tone({ freq = 440, freqEnd = freq, dur = 0.12, type = "triangle", vol = 0.1, delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function noiseBurst({ dur = 0.18, vol = 0.16, filter = 1400 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const frames = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }
  const sfx = {
    charge() { tone({ freq: 240, freqEnd: 620, dur: 0.5, type: "sawtooth", vol: 0.04 }); },
    fire() { tone({ freq: 360, freqEnd: 820, dur: 0.13, type: "triangle", vol: 0.08 }); noiseBurst({ dur: 0.06, vol: 0.05, filter: 3000 }); },
    perfect() { [784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.13, type: "triangle", vol: 0.09, delay: i * 0.05 })); },
    hit() { tone({ freq: 190, freqEnd: 85, dur: 0.16, type: "square", vol: 0.11 }); noiseBurst({ dur: 0.07, vol: 0.09, filter: 2400 }); },
    crit() { noiseBurst({ dur: 0.22, vol: 0.18, filter: 1600 }); tone({ freq: 150, freqEnd: 60, dur: 0.22, type: "sawtooth", vol: 0.08 }); tone({ freq: 880, freqEnd: 220, dur: 0.16, type: "square", vol: 0.06 }); },
    super() { [523, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.12, type: "triangle", vol: 0.07, delay: i * 0.045 })); },
    weak() { tone({ freq: 280, freqEnd: 150, dur: 0.2, type: "sine", vol: 0.05 }); },
    miss() { tone({ freq: 620, freqEnd: 1150, dur: 0.1, type: "sine", vol: 0.045 }); },
    telegraph() { tone({ freq: 880, freqEnd: 1180, dur: 0.09, type: "sine", vol: 0.035 }); },
    brace() { tone({ freq: 150, freqEnd: 90, dur: 0.14, type: "square", vol: 0.08 }); noiseBurst({ dur: 0.05, vol: 0.06, filter: 1800 }); },
    ko() { noiseBurst({ dur: 0.34, vol: 0.2, filter: 900 }); tone({ freq: 220, freqEnd: 50, dur: 0.42, type: "sawtooth", vol: 0.09 }); },
    victory() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.2, type: "triangle", vol: 0.1, delay: i * 0.1 })); },
    defeat() { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.28, type: "sine", vol: 0.08, delay: i * 0.13 })); },
  };

  // ---------- scene: drifting ambient motes ----------
  const motes = [];
  for (let i = 0, n = Math.round(W / 26); i < n; i++) {
    motes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.8 + Math.random() * 1.8,
      sp: 6 + Math.random() * 15,
      ph: Math.random() * Math.PI * 2,
    });
  }
  let sceneT = 0;
  function updateScene(dt) {
    sceneT += dt;
    for (const m of motes) {
      m.y -= m.sp * dt;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
    }
  }

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

    // Spotlight glow behind the arena, gently pulsing.
    const glowR = Math.max(W, H) * (0.5 + Math.sin(sceneT * 0.8) * 0.04);
    const spot = ctx.createRadialGradient(W / 2, FLOOR_Y - 10, 10, W / 2, FLOOR_Y - 10, glowR);
    spot.addColorStop(0, "rgba(124, 240, 198, 0.16)");
    spot.addColorStop(0.55, "rgba(124, 160, 255, 0.06)");
    spot.addColorStop(1, "rgba(7, 11, 22, 0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);

    // Drifting ambient motes.
    ctx.globalCompositeOperation = "lighter";
    for (const m of motes) {
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(sceneT * 2 + m.ph));
      ctx.globalAlpha = tw * 0.5;
      ctx.fillStyle = "rgba(170, 210, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

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
    // perspective floor lines, scrolling subtly for depth
    ctx.strokeStyle = "rgba(124, 240, 198, 0.1)";
    for (let i = 1; i <= 4; i++) {
      const y = FLOOR_Y + (H - FLOOR_Y) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
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
    updateScene(dt);
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
    drawBraceRing();
    drawComicTexts(dt);
    if (flashWhole > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashWhole})`;
      ctx.fillRect(0, 0, W, H);
      flashWhole = Math.max(0, flashWhole - dt * 3);
    }
    ctx.restore();
    // HUD-space overlays (not affected by screen shake)
    drawFireMeter();
  }

  // ---- interactive fire meter (challenger turns) ----
  // A marker sweeps a bar; tapping near the centre "sweet spot" maxes the
  // spectacle. It NEVER changes damage — the sim already decided the outcome.
  function fireQualityFromMeter() {
    const d = Math.abs(meterPos); // 0 at centre, 1 at edges
    if (d <= 0.16) return "perfect";
    if (d <= 0.42) return "good";
    return "ok";
  }
  function drawFireMeter() {
    if (phase !== "aim") return;
    const bw = Math.min(W * 0.74, 420);
    const bh = 16;
    const bx = (W - bw) / 2;
    const by = H - 30;
    ctx.save();
    ctx.fillStyle = "rgba(7, 13, 28, 0.78)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.fillRect(bx - 6, by - 6, bw + 12, bh + 12);
    ctx.strokeRect(bx - 6, by - 6, bw + 12, bh + 12);
    // Zones mirror fireQualityFromMeter() exactly: marker x = centre +
    // meterPos*(bw/2), so a threshold T maps to a half-width of T*bw/2.
    const sweetW = 0.16 * (bw / 2);
    const goodW = 0.42 * (bw / 2);
    ctx.fillStyle = "rgba(143, 180, 255, 0.28)";
    ctx.fillRect(bx + bw / 2 - goodW, by, goodW * 2, bh);
    ctx.fillStyle = "rgba(124, 240, 198, 0.5)";
    ctx.fillRect(bx + bw / 2 - sweetW, by, sweetW * 2, bh);
    // frame
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.strokeRect(bx, by, bw, bh);
    // marker
    const mx = bx + bw / 2 + meterPos * (bw / 2);
    ctx.fillStyle = "#ffe27a";
    ctx.shadowColor = "#ffe27a";
    ctx.shadowBlur = 10;
    ctx.fillRect(mx - 3, by - 5, 6, bh + 10);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  function drawBraceRing() {
    if (phase !== "telegraph" || !current) return;
    // contracting ring around the challenger — tap when it's tight to brace
    const cx = challenger.pos.x;
    const cy = challenger.pos.y - BODY_R * 0.5;
    const k = Math.max(0, Math.min(1, telegraphT / TELEGRAPH_DUR));
    const r = BODY_R * (2.4 - 1.5 * k);
    ctx.save();
    ctx.strokeStyle = braced ? "#7cf0c6" : "#8fb4ff";
    ctx.globalAlpha = braced ? 0.5 : 0.85;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, BODY_R * 0.9, 0, Math.PI * 2);
    ctx.stroke();
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
    if (entry.dodged) {
      defSide.shakeTime = 0.15;
      popComic("MISS!", defSide.pos.x, defSide.pos.y - BODY_R - 16, "#cdd6f0");
      sfx.miss();
      return;
    }

    // Player input is pure spectacle — it scales juice, never the numbers.
    // Damage + HP always come straight from the deterministic sim log.
    const playerAttacked = state.playerControlled;
    const q = state.fireQuality || "ok";
    const juiceMul = !playerAttacked ? 1 : q === "perfect" ? 1.6 : q === "good" ? 1.15 : 0.8;
    const braced = !!state.braced;

    defSide.hp = entry.defenderHp;
    defSide.flashTime = braced ? 0.2 : 0.35;
    defSide.shakeTime = braced ? 0.14 : 0.32;
    setHpBar(defSide, defSide === challenger ? "challenger" : "defender");
    const sparkColor = state.atkSide.card.type === "Fire" ? "#ffb185" : colorsFor(state.atkSide.card).accent;
    const baseSparks = entry.crit ? 22 : 14;
    popSparks(defSide.pos.x, defSide.pos.y - BODY_R * 0.5, sparkColor, Math.round(baseSparks * juiceMul * (braced ? 0.5 : 1)));
    const colors = colorsFor(state.atkSide.card);
    auras.push({ x: defSide.pos.x, y: defSide.pos.y - BODY_R * 0.4, r: BODY_R * 0.9, dur: 0.45, t: 0, color: colors.accent });
    const word = entry.move === "skill"
      ? entry.crit ? "CRIT!" : "ZWAP!"
      : entry.crit ? "CRIT!" : ["POW!", "BAM!", "ZAP!", "WHACK!"][Math.floor(Math.random() * 4)];
    popComic(`${word} -${entry.damage}`, defSide.pos.x, defSide.pos.y - BODY_R - 20, entry.crit ? "#ffe27a" : "#ff8ca6", entry.crit);
    if (entry.effective === "super") popComic("SUPER!", defSide.pos.x, defSide.pos.y - BODY_R - 44, "#7cf0c6");
    if (entry.effective === "weak") popComic("weak…", defSide.pos.x, defSide.pos.y - BODY_R - 44, "#9fb0d9");
    if (playerAttacked && q === "perfect") popComic("PERFECT!", defSide.pos.x, defSide.pos.y - BODY_R - 68, "#ffe27a", true);

    // Audio
    if (entry.crit) sfx.crit();
    else sfx.hit();
    if (entry.effective === "super") sfx.super();
    else if (entry.effective === "weak") sfx.weak();

    let shake = entry.crit ? 0.9 : entry.move === "skill" ? 0.65 : 0.35;
    shake *= juiceMul;
    if (braced) {
      shake *= 0.4;
      sfx.brace();
      popComic("BLOCK!", defSide.pos.x, defSide.pos.y - BODY_R - 16, "#8fb4ff");
      auras.push({ x: defSide.pos.x, y: defSide.pos.y - BODY_R * 0.4, r: BODY_R * 1.1, dur: 0.4, t: 0, color: "#8fb4ff" });
    }
    screenShake = Math.max(screenShake, shake);
    if (entry.move === "skill" || (playerAttacked && q === "perfect")) {
      flashWhole = Math.max(flashWhole, entry.move === "skill" ? 0.35 : 0.25);
    }
    if (defSide.hp <= 0) {
      defSide.knockedOut = true;
      defSide.koTime = 0;
      popComic("K.O.!", defSide.pos.x, defSide.pos.y - BODY_R - 50, "#ffd166", true);
      screenShake = 1.1;
      sfx.ko();
    }
  }

  let queue = [];
  result.log.forEach((entry, idx) => {
    const state = attackEntry(entry);
    state.idx = idx;
    state.playerControlled = entry.attacker === "attacker";
    queue.push(state);
  });

  let current = null;
  let phaseT = 0;
  let raf = 0;
  let last = performance.now();
  let battleOver = false;

  // ---- interactive phase machine ----
  // phase: intro | aim | windup | flight | telegraph | recover | done
  let phase = "intro";
  let meterPos = 0;   // -1 .. 1 (0 = sweet spot)
  let meterDir = 1;
  const AIM_TIMEOUT = 2.6;   // auto-fire if the player freezes
  const TELEGRAPH_DUR = 0.95;
  let telegraphT = 0;
  let braced = false;
  let telegraphBeepT = 0;

  function describeTurn(state) {
    const moveLabel = state.entry.move === "skill" ? skillNameFor(state.atkSide.card) : "Quick Strike";
    const who = state.entry.attacker === "attacker" ? challengerCard.name : champCard.name;
    const note = state.entry.dodged
      ? " — but it missed!"
      : state.entry.effective === "super" ? " — super effective!"
      : state.entry.effective === "weak" ? " — not very effective."
      : "";
    return `<strong>${escapeHtml(who)}</strong> used <em>${escapeHtml(moveLabel)}</em>${escapeHtml(note)}`;
  }

  function advance() {
    current = queue.shift() || null;
    phaseT = 0;
    if (!current) {
      if (!battleOver) finishBattle();
      return;
    }
    current.descLine = describeTurn(current);
    if (current.playerControlled) {
      phase = "aim";
      meterPos = -1;
      meterDir = 1;
      current.fireQuality = "ok";
      sfx.charge();
      const skill = current.entry.move === "skill";
      status.innerHTML = `<strong>Your move!</strong> ${skill ? "Charge a skill — " : ""}TAP / SPACE in the <span style="color:#7cf0c6">green zone</span> to fire 🔴`;
    } else {
      phase = "telegraph";
      telegraphT = 0;
      telegraphBeepT = 0;
      braced = false;
      status.innerHTML = `<strong>${escapeHtml(champCard.name)}</strong> is winding up — <span style="color:#8fb4ff">TAP / SPACE to BRACE!</span>`;
    }
  }

  function spawnTurnProjectile() {
    const entry = current.entry;
    const proj = entry.move === "skill"
      ? makeSkillProjectile(current.atkSide, current.defSide, current.atkSide.card)
      : makeAttackProjectile(current.atkSide, current.defSide, current.atkSide.card);
    proj.onHit = () => {
      if (current.hit) return;
      current.hit = true;
      applyHit(current);
    };
    projectiles.push(proj);
    current.projectileSpawned = true;
    phase = "flight";
    phaseT = 0;
    status.innerHTML = current.descLine;
  }

  // Player tap / key — routes by phase. Pure spectacle: never the numbers.
  function onPlayerAction() {
    ensureAudio();
    if (phase === "aim" && current && !current.fired) {
      current.fired = true;
      current.fireQuality = fireQualityFromMeter();
      sfx.fire();
      if (current.fireQuality === "perfect") {
        sfx.perfect();
        flashWhole = Math.max(flashWhole, 0.22);
      }
      phase = "windup";
      phaseT = 0;
    } else if (phase === "telegraph" && current && !braced) {
      braced = true;
      current.braced = true;
      // tighter timing (later in the wind-up) = a crisper block flourish
      const tight = telegraphT / TELEGRAPH_DUR > 0.55;
      sfx.telegraph();
      popComic(tight ? "READY!" : "brace", challenger.pos.x, challenger.pos.y - BODY_R - 14, tight ? "#7cf0c6" : "#8fb4ff");
      popSparks(challenger.pos.x, challenger.pos.y - BODY_R * 0.5, "#8fb4ff", tight ? 12 : 6, 120);
    }
  }

  function tickPhase(dt) {
    if (!current) return;
    phaseT += dt;
    const atkHome = current.atkSide === challenger ? CHALLENGER_HOME : DEFENDER_HOME;
    ensureBodyAt(current.atkSide, atkHome.x, atkHome.y);

    if (phase === "aim") {
      // sweep the marker back and forth; gentle charge bob on the attacker
      meterPos += meterDir * dt * 2.7;
      if (meterPos >= 1) { meterPos = 1; meterDir = -1; }
      else if (meterPos <= -1) { meterPos = -1; meterDir = 1; }
      const charge = Math.sin(phaseT * 11) * 3;
      ensureBodyAt(current.atkSide, atkHome.x - current.atkSide.facing * 4, atkHome.y + charge);
      if (phaseT >= AIM_TIMEOUT && !current.fired) {
        current.fired = true;
        current.fireQuality = "ok";
        sfx.fire();
        phase = "windup";
        phaseT = 0;
      }
      return;
    }

    if (phase === "windup") {
      const lunge = Math.min(1, phaseT / 0.22);
      const lungeOffset = current.atkSide.facing * 20 * lunge * (1 - lunge);
      ensureBodyAt(current.atkSide, atkHome.x + lungeOffset, atkHome.y);
      if (phaseT >= 0.22) spawnTurnProjectile();
      return;
    }

    if (phase === "telegraph") {
      telegraphT += dt;
      telegraphBeepT -= dt;
      if (telegraphBeepT <= 0) { sfx.telegraph(); telegraphBeepT = 0.26; }
      // defender draws back, glowing
      const k = telegraphT / TELEGRAPH_DUR;
      const draw = current.atkSide.facing * 16 * Math.min(1, k);
      ensureBodyAt(current.atkSide, atkHome.x + draw, atkHome.y - Math.sin(k * Math.PI) * 4);
      current.atkSide.flashTime = Math.max(current.atkSide.flashTime, 0.12);
      if (telegraphT >= TELEGRAPH_DUR) {
        const lungeOffset = current.atkSide.facing * 20;
        ensureBodyAt(current.atkSide, atkHome.x + lungeOffset, atkHome.y);
        spawnTurnProjectile();
      }
      return;
    }

    if (phase === "flight") {
      // projectile motion + onHit handled by tickProjectiles()
      if (current.hit) { phase = "recover"; phaseT = 0; }
      return;
    }

    if (phase === "recover") {
      if (phaseT >= 0.55) {
        if (current.defSide.knockedOut && current.defSide.koTime > 0.8) {
          battleOver = true;
          current = null;
          phase = "done";
          finishBattle();
          return;
        }
        advance();
      }
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
      // The challenger now occupies the gym — mark their inventory instance.
      const challengerUid = challengerInstance?.uid || null;
      if (challengerUid && getInstance(challengerUid)) {
        markInstanceDeployed(challengerUid, site.id);
      }
      const newChampion = {
        trainer: profile.name,
        team: profile.team || "mint",
        cardId: challengerCard.id,
        instanceUid: challengerUid,
        boosts: challengerInstance?.boosts ? { ...challengerInstance.boosts } : { hp: 0, atk: 0, def: 0, spd: 0 },
        defenses: 0,
        placedAt,
        lastBattleAt: placedAt,
      };
      championsBySite.set(site.id, newChampion);
      publishChampion(site.id, newChampion);
      summary = `${escapeHtml(challengerCard.name)} dethroned ${escapeHtml(champCard.name)}. ${escapeHtml(profile?.name || "")} is the new champion of ${escapeHtml(battleSiteName(site.id))}!`;
      renderCollection();
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
    // Final flourish
    if (challengerWon) {
      sfx.victory();
      flashWhole = Math.max(flashWhole, 0.3);
      popComic("VICTORY!", W / 2, H * 0.4, "#7cf0c6", true);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          if (!document.body.contains(challenge)) return;
          popSparks(W * (0.2 + Math.random() * 0.6), H * (0.25 + Math.random() * 0.3), ["#7cf0c6", "#ffe27a", "#8fb4ff", "#ff8d9e"][i % 4], 16, 220);
        }, i * 130);
      }
    } else {
      sfx.defeat();
      popComic("DEFEAT", W / 2, H * 0.42, "#ff8ca6", true);
    }
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
  function onKey(ev) {
    if (ev.key === "Escape") { closeChallenge(); return; }
    if (ev.key === " " || ev.key === "Spacebar" || ev.key === "Enter") {
      ev.preventDefault();
      onPlayerAction();
    }
  }
  function onCanvasTap(ev) {
    ev.preventDefault();
    onPlayerAction();
  }
  document.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onCanvasTap);
  canvas.style.touchAction = "manipulation";
  canvas.style.cursor = "pointer";
  cancel.addEventListener("click", closeChallenge);

  // intro pause then kick off
  setHpBar(challenger, "challenger");
  setHpBar(defender, "defender");
  status.innerHTML = `<strong>Battle start!</strong> ${escapeHtml(profile?.name || "You")} challenge ${escapeHtml(championBefore.trainer)}…`;
  setTimeout(advance, 700);
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
  // Become discoverable for trading promptly on the first fix instead of
  // waiting up to a full heartbeat; throttled so a chatty GPS watch can't spam.
  publishPresence();
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
        <input id="dbgLat" type="text" inputmode="decimal" pattern="-?[0-9]*\\.?[0-9]*" autocomplete="off" value="${current.lat || 0}" />
      </label>
      <label style="text-align:left;">Longitude
        <input id="dbgLng" type="text" inputmode="decimal" pattern="-?[0-9]*\\.?[0-9]*" autocomplete="off" value="${current.lng || 0}" />
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

  // Touch-friendly: rapid taps on the location pill opens the debug dialog.
  const pill = el.locationStatus;
  if (pill) {
    const TAP_TARGET = 7;
    const TAP_WINDOW_MS = 3000;
    let tapCount = 0;
    let tapTimer = null;
    let originalText = "";
    function resetTaps() {
      tapCount = 0;
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      if (originalText && pill.dataset.tapping === "1") {
        pill.textContent = originalText;
        pill.dataset.tapping = "0";
      }
    }
    pill.style.cursor = "pointer";
    pill.style.userSelect = "none";
    pill.style.webkitUserSelect = "none";
    pill.style.webkitTapHighlightColor = "transparent";
    // Count on pointerdown (not click): fires once per tap, immediately, and
    // is never swallowed by the iOS double-tap-zoom guard below.
    function registerTap(ev) {
      ev.preventDefault();
      if (tapCount === 0) originalText = pill.textContent;
      tapCount += 1;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(resetTaps, TAP_WINDOW_MS);
      if (tapCount >= TAP_TARGET) {
        resetTaps();
        openDebugLocationDialog();
        return;
      }
      if (tapCount >= 4) {
        pill.dataset.tapping = "1";
        pill.textContent = `Debug ${tapCount}/${TAP_TARGET}…`;
      }
    }
    if (window.PointerEvent) {
      pill.addEventListener("pointerdown", registerTap);
    } else {
      pill.addEventListener("touchstart", registerTap, { passive: false });
      pill.addEventListener("click", registerTap);
    }
  }

  // ---- iOS zoom guard ----
  // iOS Safari ignores `user-scalable=no`, so rapid multi-taps and pinches on
  // the full-screen map still trigger a page zoom. Suppress the double-tap
  // zoom (without killing single-tap clicks) and the pinch gesture.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (ev) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) ev.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
  document.addEventListener("gesturestart", (ev) => ev.preventDefault());
  document.addEventListener("dblclick", (ev) => ev.preventDefault());
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
    if (event.trainer && event.trainer !== profile?.name) {
      const prev = trainerLocations.get(event.trainer);
      const merged = mergeTrainerLocation(prev, event);
      if (merged && merged !== prev) trainerLocations.set(event.trainer, merged);
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

// Presence: a single overwrite-in-place node per trainer keyed by name. This
// publishes the same coarse lat/lng a catch event already exposes on the
// public feed — no new privacy surface — but keeps idle trainers visible for
// trading. Like trades/champions there's no auth, so a name can be spoofed;
// the public datastore + the on-map range gate make that easier to spot than
// to prevent, consistent with the rest of the multiplayer model.
function publishPresence(force = false) {
  if (!presenceNode || !profile?.name || !playerLocation) return;
  const now = Date.now();
  // The periodic heartbeat forces a write; opportunistic callers (e.g. a
  // noisy GPS watch) are throttled so we don't hammer the relay.
  if (!force && now - lastPresenceSentAt < PRESENCE_HEARTBEAT_MS) return;
  lastPresenceSentAt = now;
  try {
    presenceNode.get(profile.name).put({
      lat: playerLocation.lat,
      lng: playerLocation.lng,
      ts: now,
    });
  } catch {}
}

function subscribePresence() {
  if (!presenceNode) return;
  presenceNode.map().on((raw, name) => {
    if (!raw || !name || name === profile?.name) return;
    const prev = trainerLocations.get(name);
    const merged = mergeTrainerLocation(prev, raw);
    if (!merged || merged === prev) return;
    trainerLocations.set(name, merged);
    renderMap();
  });
}

function normalizeChampion(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.cardId || !raw.trainer || !raw.placedAt) return null;
  const champ = {
    trainer: String(raw.trainer),
    team: raw.team || "mint",
    cardId: String(raw.cardId),
    instanceUid: raw.instanceUid ? String(raw.instanceUid) : null,
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

function reclaimLostInstanceAtSite(siteId, lastChampionWeKnew) {
  // If a local instance was deployed at this site but our ownership has ended
  // (taken over, retired, or cleared), bring it back home so it can be
  // redeployed elsewhere. Keeps boosts already mirrored from training.
  const deployed = deployedInstanceAtSite(caught, siteId);
  if (!deployed) return false;
  const carryBoosts = lastChampionWeKnew?.trainer === profile?.name
    ? lastChampionWeKnew.boosts
    : deployed.boosts;
  restoreInstanceHome(deployed.uid, carryBoosts);
  return true;
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
      const existing = championsBySite.get(site.id);
      if (!champ) {
        if (championsBySite.has(site.id)) {
          championsBySite.delete(site.id);
          if (reclaimLostInstanceAtSite(site.id, existing)) renderCollection();
          renderMap();
          refreshOpenSitePanel(site.id);
        } else if (reclaimLostInstanceAtSite(site.id, null)) {
          renderCollection();
        }
        return;
      }
      if (isChampionRetired(champ)) {
        championsBySite.delete(site.id);
        if (reclaimLostInstanceAtSite(site.id, champ)) renderCollection();
        // Auto-clear stale champion record so the site re-opens.
        try { battleSitesNode.get(site.id).put(null); } catch {}
        renderMap();
        refreshOpenSitePanel(site.id);
        return;
      }
      const sig = JSON.stringify(champ);
      const existingSig = existing ? JSON.stringify(existing) : "";
      if (sig === existingSig) return;
      championsBySite.set(site.id, champ);
      // If the gym's current occupant is no longer ours (or has a different
      // instance uid than what we have parked there), pull the instance home.
      const local = deployedInstanceAtSite(caught, site.id);
      if (local) {
        const stillMine = champ.trainer === profile?.name && champ.instanceUid === local.uid;
        if (!stillMine) {
          if (reclaimLostInstanceAtSite(site.id, existing)) renderCollection();
        }
      }
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
      instanceUid: champion.instanceUid || null,
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

// ===========================================================================
// Trading
// ---------------------------------------------------------------------------
// Two trainers within TRADE_RANGE_METERS can swap a specific instance each.
// State lives under `fokemon/trades/<requestId>` on GUN. A request goes:
//   pending (waiting for recipient)
//   → countered (recipient picked their side and accepted)
//   → completed (originator confirms; both sides apply the swap locally)
//   → cancelled (either side bails)
// Each peer is responsible for applying the swap to its OWN inventory once it
// observes the matching status — there is no global atomic commit, but the
// public datastore + range requirement make abuse easier to spot than fix.
// ===========================================================================

let tradesNode = null;
const tradeRequests = new Map(); // requestId -> normalized request
// Which trade ids have already been applied to MY inventory. Persisted: a
// completed trade lives in GUN forever, so subscribeTrades re-emits it on
// every reload — without a durable guard the swap would re-apply each refresh
// and keep re-adding the received Fokémon. Bounded so it can't grow forever.
const APPLIED_TRADES_KEY = "fokemon_applied_trades";
const appliedTrades = new Set(
  (Array.isArray(safeStorageGet(APPLIED_TRADES_KEY, [])) ? safeStorageGet(APPLIED_TRADES_KEY, []) : []).map(String)
);
function rememberAppliedTrade(id) {
  appliedTrades.add(id);
  try {
    localStorage.setItem(APPLIED_TRADES_KEY, JSON.stringify([...appliedTrades].slice(-400)));
  } catch {}
}
const notifiedTradeKeys = new Set(); // `${id}:${status}` already surfaced as a toast
const locallyCancelledTrades = new Set(); // ids I cancelled/declined myself
let openTradeRequestId = null;
let openTradeRefresh = null;

// A trade request/counter syncs near-instantly over GUN; anything older than
// this is treated as a stale replay (e.g. on reload) and surfaced silently.
const TRADE_NOTIFY_FRESH_MS = 120000;

function makeRequestId() {
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function packInstanceForTrade(entry) {
  if (!entry) return null;
  return {
    uid: entry.uid,
    cardId: entry.id,
    boosts: { ...(entry.boosts || {}) },
    caughtAt: entry.ts || 0,
  };
}

function normalizeTradeOffer(raw) {
  // `raw` is whatever GUN handed us: the JSON-string wire format on a peer, or
  // a plain object for a local echo. parseTradeOffer fixes the shape; we only
  // add the card-existence gate (it needs the live card index).
  const offer = parseTradeOffer(raw);
  if (!offer) return null;
  if (!cardsById.has(offer.cardId)) return null;
  return offer;
}

function normalizeTradeRequest(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.id || !raw.from || !raw.to) return null;
  const offer = normalizeTradeOffer(raw.offer);
  if (!offer) return null;
  const counter = raw.counterOffer ? normalizeTradeOffer(raw.counterOffer) : null;
  const status = String(raw.status || "pending");
  return {
    id: String(raw.id),
    from: String(raw.from),
    to: String(raw.to),
    offer,
    counterOffer: counter,
    status,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    lat: Number(raw.lat) || null,
    lng: Number(raw.lng) || null,
  };
}

function publishTradeRequest(req) {
  if (!tradesNode) return;
  try {
    // offer/counterOffer go on the wire as JSON *strings*, not nested objects:
    // GUN's tradesNode.map().on() never resolves nested child nodes, so an
    // object here would reach peers as an unresolved link and the request
    // would be silently dropped. Strings sync verbatim. See app.logic.js.
    tradesNode.get(req.id).put({
      id: req.id,
      from: req.from,
      to: req.to,
      offer: serializeTradeOffer(req.offer),
      counterOffer: req.counterOffer ? serializeTradeOffer(req.counterOffer) : null,
      status: req.status,
      createdAt: req.createdAt,
      updatedAt: Date.now(),
      lat: req.lat ?? null,
      lng: req.lng ?? null,
    });
  } catch {}
}

function nearbyTrainerEntries() {
  if (!playerLocation) return [];
  const out = [];
  for (const [name, loc] of trainerLocations.entries()) {
    if (!loc || !name || name === profile?.name) continue;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
    const dist = distanceMeters(playerLocation, loc);
    if (dist > TRADE_RANGE_METERS) continue;
    if (Date.now() - (loc.ts || 0) > TRADE_DISCOVERY_TTL_MS) continue;
    out.push({ name, distance: Math.round(dist), lat: loc.lat, lng: loc.lng, ts: loc.ts });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

function pendingIncomingTrades() {
  return [...tradeRequests.values()].filter((req) => {
    if (req.to !== profile?.name) return false;
    if (req.status === "completed" || req.status === "cancelled") return false;
    if (Date.now() - req.createdAt > TRADE_REQUEST_TTL_MS) return false;
    return true;
  });
}

// Finished trades stay in GUN, so they survive a refresh — surface the recent
// ones so a completed/cancelled swap leaves a visible trace instead of
// silently vanishing from the lobby.
const RECENT_TRADE_WINDOW_MS = 24 * 60 * 60 * 1000;
function recentFinishedTrades(max = 6) {
  const me = profile?.name;
  return [...tradeRequests.values()]
    .filter((r) =>
      (r.from === me || r.to === me) &&
      (r.status === "completed" || r.status === "cancelled") &&
      Date.now() - (r.updatedAt || r.createdAt) <= RECENT_TRADE_WINDOW_MS)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, max);
}

function applyIncomingCompletedTrade(req) {
  // I'm the originator and the counterparty has countered+accepted. Add their
  // instance to my inventory and remove what I offered. Idempotent via appliedTrades.
  if (!req.counterOffer) return;
  if (appliedTrades.has(req.id)) return;
  rememberAppliedTrade(req.id);
  // Remove my offered instance (might already be gone if deployed elsewhere or released).
  if (req.offer && getInstance(req.offer.uid)) {
    caught = caught.filter((c) => c.uid !== req.offer.uid);
  }
  // Add their offered instance into my inventory.
  const card = cardsById.get(req.counterOffer.cardId);
  if (card) {
    const ts = Date.now();
    const newEntry = {
      id: card.id,
      ts,
      uid: req.counterOffer.uid || makeInstanceUid(card.id, ts),
      boosts: normalizeBoosts(req.counterOffer.boosts),
      deployedAt: null,
    };
    caught.push(newEntry);
  }
  rebuildCaughtIndexes();
  saveLocal();
  renderCollection();
  renderMap();
}

function applyAcceptedTradeAsRecipient(req) {
  // I'm the recipient and have countered with my own instance — finalize swap
  // by removing what I offered and adding what they offered.
  if (appliedTrades.has(req.id)) return;
  rememberAppliedTrade(req.id);
  if (req.counterOffer && getInstance(req.counterOffer.uid)) {
    caught = caught.filter((c) => c.uid !== req.counterOffer.uid);
  }
  const card = cardsById.get(req.offer.cardId);
  if (card) {
    const ts = Date.now();
    const newEntry = {
      id: card.id,
      ts,
      uid: req.offer.uid || makeInstanceUid(card.id, ts),
      boosts: normalizeBoosts(req.offer.boosts),
      deployedAt: null,
    };
    caught.push(newEntry);
  }
  rebuildCaughtIndexes();
  saveLocal();
  renderCollection();
  renderMap();
}

function subscribeTrades() {
  if (!tradesNode) return;
  tradesNode.map().on((raw, id) => {
    if (!raw) {
      if (tradeRequests.has(id)) {
        tradeRequests.delete(id);
        renderTradeBadge();
        refreshOpenTradeModal();
      }
      return;
    }
    const req = normalizeTradeRequest({ ...raw, id });
    if (!req) return;
    if (req.from !== profile?.name && req.to !== profile?.name) return;
    tradeRequests.set(req.id, req);

    // Auto-apply on the right side once status flips:
    if (req.status === "countered" && req.from === profile?.name) {
      // Wait for me (originator) to confirm via modal — no auto-apply.
    }
    if (req.status === "completed") {
      if (req.from === profile?.name) applyIncomingCompletedTrade(req);
      else if (req.to === profile?.name) applyAcceptedTradeAsRecipient(req);
      dismissTradeToast(); // the trade resolved — clear any lingering banner
    }
    maybeNotifyTrade(req);
    renderTradeBadge();
    refreshOpenTradeModal();
  });
}

function renderTradeBadge() {
  if (!el.tradeBadge) return;
  const pending = pendingIncomingTrades().length;
  if (pending > 0) {
    el.tradeBadge.textContent = String(pending);
    el.tradeBadge.classList.remove("hidden");
  } else {
    el.tradeBadge.classList.add("hidden");
  }
}

function refreshOpenTradeModal() {
  if (!openTradeRequestId && typeof openTradeRefresh !== "function") return;
  if (typeof openTradeRefresh === "function") openTradeRefresh();
}

// A single non-blocking banner so an incoming request / counter can't be
// missed even when the player isn't looking at the Trade button.
let tradeToastEl = null;
let tradeToastTimer = null;

function dismissTradeToast() {
  if (tradeToastTimer) { clearTimeout(tradeToastTimer); tradeToastTimer = null; }
  const wrap = tradeToastEl;
  tradeToastEl = null;
  if (!wrap) return;
  wrap.classList.remove("show");
  setTimeout(() => { if (wrap.parentNode) wrap.remove(); }, 250);
}

function showTradeToast({ title, detail, requestId, autoDismissMs }) {
  if (typeof document === "undefined") return;
  dismissTradeToast();
  const wrap = document.createElement("div");
  wrap.className = "trade-toast";
  wrap.setAttribute("role", "alert");
  wrap.innerHTML = `
    <div class="trade-toast-body">
      <span class="trade-toast-icon" aria-hidden="true">🔄</span>
      <div class="trade-toast-text">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
    </div>
    <div class="trade-toast-actions">
      ${requestId ? `<button type="button" class="primary trade-toast-view">Review</button>` : ""}
      <button type="button" class="ghost trade-toast-dismiss" aria-label="Dismiss">✕</button>
    </div>
  `;
  document.body.appendChild(wrap);
  void wrap.offsetWidth; // reflow so the slide-in transition runs
  wrap.classList.add("show");
  tradeToastEl = wrap;

  wrap.querySelector(".trade-toast-dismiss")?.addEventListener("click", dismissTradeToast);
  wrap.querySelector(".trade-toast-view")?.addEventListener("click", () => {
    dismissTradeToast();
    if (!requestId) return;
    if (openTradeRequestId) {
      // A trade modal is already open — route it to this request.
      openTradeRequestId = requestId;
      if (typeof openTradeRefresh === "function") openTradeRefresh();
    } else {
      openTradeModal(requestId);
    }
  });
  if (autoDismissMs) tradeToastTimer = setTimeout(dismissTradeToast, autoDismissMs);
}

function buzz(pattern) {
  try { if (navigator?.vibrate) navigator.vibrate(pattern); } catch {}
}

// Surface a fresh, actionable trade transition exactly once.
function maybeNotifyTrade(req) {
  if (!req || !profile?.name) return;
  const iAmTo = req.to === profile.name;
  const iAmFrom = req.from === profile.name;
  if (!iAmTo && !iAmFrom) return;

  const key = `${req.id}:${req.status}`;
  if (notifiedTradeKeys.has(key)) return;

  if (req.status === "pending" && iAmTo) {
    notifiedTradeKeys.add(key);
    if (Date.now() - req.createdAt > TRADE_NOTIFY_FRESH_MS) return;
    const name = cardsById.get(req.offer.cardId)?.name || "a Fokemon";
    buzz([120, 60, 120]);
    showTradeToast({
      title: `${req.from} wants to trade`,
      detail: `Offering their ${name} — tap Review to respond`,
      requestId: req.id,
    });
  } else if (req.status === "countered" && iAmFrom) {
    notifiedTradeKeys.add(key);
    if (Date.now() - req.updatedAt > TRADE_NOTIFY_FRESH_MS) return;
    const name = req.counterOffer
      ? (cardsById.get(req.counterOffer.cardId)?.name || "a Fokemon")
      : "a Fokemon";
    buzz([120, 60, 120]);
    showTradeToast({
      title: `${req.to} responded`,
      detail: `They offer their ${name} — review the swap`,
      requestId: req.id,
    });
  } else if (req.status === "cancelled") {
    notifiedTradeKeys.add(key);
    if (locallyCancelledTrades.has(req.id)) return;
    if (Date.now() - req.updatedAt > TRADE_NOTIFY_FRESH_MS) return;
    const other = iAmFrom ? req.to : req.from;
    showTradeToast({
      title: `Trade cancelled`,
      detail: `Your trade with ${other} was cancelled`,
      requestId: null,
      autoDismissMs: 6000,
    });
  }
}

// Completion animations should fire once, not on every background re-render.
const celebratedTrades = new Set();

function trainerHue(name) {
  return seedFromStrings(String(name || "?")) % 360;
}

// A chunky coloured trainer badge — a stand-in "avatar" so trainers feel like
// characters, not rows in a list. Colour is stable per name.
function trainerOrbHtml(name, size = "md") {
  const initial = (String(name || "?").trim()[0] || "?").toUpperCase();
  return `<span class="trainer-orb orb-${size}" style="--orb-h:${trainerHue(name)}deg" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

// Three-stop progress ribbon so a player can always see WHERE in the swap they
// are. `active` is the 1-based current step; `complete` lights every node.
function tradeRailHtml(active, { complete = false, cancelled = false } = {}) {
  const steps = ["Send yours", "Trade back", "Seal it"];
  let html = `<div class="trade-rail${cancelled ? " is-cancelled" : ""}" aria-hidden="true">`;
  steps.forEach((label, i) => {
    const n = i + 1;
    const done = !cancelled && (complete || n < active);
    const now = !cancelled && !complete && n === active;
    if (i > 0) html += `<i class="rail-link${!cancelled && (complete || active >= n) ? " lit" : ""}"></i>`;
    html += `<span class="rail-node ${done ? "done" : now ? "now" : "off"}"><b>${done ? "✓" : n}</b><em>${label}</em></span>`;
  });
  return html + "</div>";
}

// A cartoon speech bubble paired with the speaker's orb.
function tradeTalkHtml(name, html, mood = "neutral") {
  return `<div class="trade-talk mood-${mood}">${trainerOrbHtml(name, "sm")}<div class="trade-bubble">${html}</div></div>`;
}

const liveDots = `<span class="live-dots"><i></i><i></i><i></i></span>`;

// A virtual trading card — the same foil/rarity language as the immersive card
// viewer, shrunk to fit two-up on the trade table. `offer` is a packed trade
// offer ({uid,cardId,boosts}); null/missing renders a face-down "?" slot.
function tradeMiniCard(offer, opts = {}) {
  const { waitingLabel = "Waiting…", pop = false } = opts;
  if (!offer) {
    return `<div class="tcard tcard-ghost"><span class="tcard-foil"></span><span class="tcard-q">?</span><span class="tcard-wait">${escapeHtml(waitingLabel)}</span></div>`;
  }
  const card = cardsById.get(offer.cardId);
  if (!card) {
    return `<div class="tcard tcard-ghost"><span class="tcard-q">?</span><span class="tcard-wait">Unknown Fokémon</span></div>`;
  }
  const colors = colorsFor(card);
  const b = offer.boosts || {};
  const trained = (b.hp || 0) + (b.atk || 0) + (b.def || 0) + (b.spd || 0);
  const si = speciesIndexForInstance(offer.uid);
  const dex = si && si.total > 1 ? ` <span class="tcard-dex">#${si.idx}</span>` : "";
  return `
    <div class="tcard rarity-${card.rarity || "common"}${pop ? " tcard-pop" : ""}" style="--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};">
      <span class="tcard-foil"></span>
      <span class="tcard-glare"></span>
      <header class="tcard-head">
        <strong>${escapeHtml(card.name)}${dex}</strong>
        <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
      </header>
      <canvas class="tcard-art" data-card="${escapeHtml(card.id)}" width="260" height="150" aria-hidden="true"></canvas>
      ${instanceStatRowsHtml(card, offer.boosts)}
      <footer class="tcard-foot">
        ${trained
          ? `<span class="tcard-ribbon">★ Trained +${trained}</span>`
          : `<span class="tcard-ribbon plain">Wild &amp; untrained</span>`}
      </footer>
    </div>`;
}

// A pickable card button (same face as tradeMiniCard, plus a power tag).
function tradePickCardHtml(entry) {
  const card = cardsById.get(entry.id);
  if (!card) return "";
  const colors = colorsFor(card);
  const power = instancePower(entry);
  const b = entry.boosts || {};
  const trained = (b.hp || 0) + (b.atk || 0) + (b.def || 0) + (b.spd || 0);
  const si = speciesIndexForInstance(entry.uid);
  const dex = si && si.total > 1 ? ` <span class="tcard-dex">#${si.idx}</span>` : "";
  return `
    <button type="button" class="tcard tcard-pick rarity-${card.rarity || "common"}" data-uid="${escapeHtml(entry.uid)}" style="--type-light:${colors.light};--type-dark:${colors.dark};--type-accent:${colors.accent};">
      <span class="tcard-foil"></span>
      <span class="tcard-glare"></span>
      <span class="tcard-power">⚡ ${power}</span>
      <header class="tcard-head">
        <strong>${escapeHtml(card.name)}${dex}</strong>
        <span class="type-pill" style="background:${colors.accent};color:#061226;">${escapeHtml(card.type)}</span>
      </header>
      <canvas class="tcard-art" data-card="${escapeHtml(card.id)}" width="260" height="140" aria-hidden="true"></canvas>
      ${instanceStatRowsHtml(card, entry.boosts)}
      <span class="tcard-send">${trained ? `★ +${trained} · ` : ""}Tap to send →</span>
    </button>`;
}

// Paint the actual creature onto every card canvas after the markup is in the
// DOM (deferred a frame so the canvas has a measured size).
function hydrateTradeArt(root) {
  if (!root) return;
  requestAnimationFrame(() => {
    root.querySelectorAll("canvas.tcard-art[data-card]").forEach((cv) => {
      const card = cardsById.get(cv.dataset.card);
      if (card) try { renderPortrait(cv, card); } catch {}
    });
  });
}

function openTradeModal(initialRequestId = null, options = {}) {
  if (activeChallenge) return;
  if (openTradeRequestId) return;
  const offerTo = options?.offerTo || null;

  const overlay = document.createElement("div");
  overlay.className = "battle-site-modal trade-modal";
  overlay.innerHTML = `
    <div class="site-card trade-card" role="dialog" aria-modal="true" aria-label="Trade with trainers">
      <header class="site-head trade-head">
        <div>
          <p class="eyebrow">🤝 Trade Station</p>
          <h3>Swap a Fokémon</h3>
        </div>
        <button class="ghost trade-close" aria-label="Close">✕</button>
      </header>
      <div class="trade-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector(".trade-body");
  const closeBtn = overlay.querySelector(".trade-close");
  openTradeRequestId = initialRequestId || "list";

  function close() {
    overlay.remove();
    openTradeRequestId = null;
    openTradeRefresh = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(ev) { if (ev.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  function paint(html) {
    bodyEl.innerHTML = html;
    hydrateTradeArt(bodyEl);
    bodyEl.querySelector(".trade-back")?.addEventListener("click", (ev) => { ev.preventDefault(); renderList(); });
  }

  function renderList() {
    openTradeRequestId = "list";
    const nearby = nearbyTrainerEntries();
    const incoming = pendingIncomingTrades();
    const myOutgoing = [...tradeRequests.values()].filter((r) =>
      r.from === profile?.name && r.status !== "completed" && r.status !== "cancelled"
    );

    const incomingHtml = incoming.length ? `
      <section class="trade-group">
        <h4 class="trade-group-title hot">⚡ Someone wants to trade!</h4>
        <div class="trade-tiles">
          ${incoming.map((req) => {
            const cn = cardsById.get(req.offer.cardId)?.name || "a Fokémon";
            return `
              <div class="trade-tile tile-hot">
                ${trainerOrbHtml(req.from)}
                <div class="tile-text">
                  <strong>${escapeHtml(req.from)}</strong>
                  <span>offers their <b>${escapeHtml(cn)}</b></span>
                </div>
                <button type="button" class="trade-cta trade-open" data-id="${escapeHtml(req.id)}">Open&nbsp;→</button>
              </div>`;
          }).join("")}
        </div>
      </section>` : "";

    const outgoingHtml = myOutgoing.length ? `
      <section class="trade-group">
        <h4 class="trade-group-title">📤 Your offers</h4>
        <div class="trade-tiles">
          ${myOutgoing.map((req) => {
            const yourMove = req.status === "countered";
            const chip = yourMove
              ? `<span class="tile-chip go">Your move!</span>`
              : `<span class="tile-chip wait">Waiting${liveDots}</span>`;
            return `
              <div class="trade-tile">
                ${trainerOrbHtml(req.to)}
                <div class="tile-text">
                  <strong>${escapeHtml(req.to)}</strong>
                  ${chip}
                </div>
                <button type="button" class="trade-cta ghost trade-open" data-id="${escapeHtml(req.id)}">View</button>
              </div>`;
          }).join("")}
        </div>
      </section>` : "";

    const recent = recentFinishedTrades();
    const recentHtml = recent.length ? `
      <section class="trade-group">
        <h4 class="trade-group-title">🕘 Recent trades</h4>
        <div class="trade-tiles">
          ${recent.map((r) => {
            const me = profile?.name;
            const other = r.from === me ? r.to : r.from;
            const done = r.status === "completed";
            const gotOffer = r.from === me ? r.counterOffer : r.offer;
            const gotName = gotOffer ? (cardsById.get(gotOffer.cardId)?.name || "a Fokémon") : "a Fokémon";
            return `
              <div class="trade-tile${done ? "" : " tile-faded"}">
                ${trainerOrbHtml(other)}
                <div class="tile-text">
                  <strong>${escapeHtml(other)}</strong>
                  <span>${done ? `🤝 You got <b>${escapeHtml(gotName)}</b>` : "😕 Called off"}</span>
                </div>
                <button type="button" class="trade-cta ghost trade-open" data-id="${escapeHtml(r.id)}">View</button>
              </div>`;
          }).join("")}
        </div>
      </section>` : "";

    const nearbyHtml = nearby.length ? `
      <div class="trade-tiles">
        ${nearby.map((t) => `
          <div class="trade-tile">
            ${trainerOrbHtml(t.name)}
            <div class="tile-text">
              <strong>${escapeHtml(t.name)}</strong>
              <span class="tile-dist"><i class="ping"></i>${t.distance}m away</span>
            </div>
            <button type="button" class="trade-cta trade-start" data-name="${escapeHtml(t.name)}">Trade</button>
          </div>`).join("")}
      </div>`
      : `
      <div class="trade-radar">
        <div class="radar-scope"><span class="radar-sweep"></span><span class="radar-blip b1"></span><span class="radar-blip b2"></span></div>
        <p class="radar-title">Scanning for trainers…</p>
        <p class="radar-sub">Nobody's within <b>${TRADE_RANGE_METERS}m</b> right now. Open Fokémon on another phone close by — they'll pop up here the moment they're in range.</p>
      </div>`;

    paint(`
      ${incomingHtml}
      ${outgoingHtml}
      <section class="trade-group">
        <h4 class="trade-group-title">🛰️ Trainers near you <span class="title-note">≤ ${TRADE_RANGE_METERS}m</span></h4>
        ${nearbyHtml}
      </section>
      ${recentHtml}
    `);

    bodyEl.querySelectorAll(".trade-start").forEach((btn) =>
      btn.addEventListener("click", () => renderOffer(btn.dataset.name)));
    bodyEl.querySelectorAll(".trade-open").forEach((btn) =>
      btn.addEventListener("click", () => renderRequest(btn.dataset.id)));
  }

  function renderOffer(recipientName) {
    openTradeRequestId = "list";
    const available = availableInstances(caught);
    if (!available.length) {
      paint(`
        <button type="button" class="trade-back">‹ Back</button>
        <div class="trade-empty">
          <span class="empty-emoji">🎒</span>
          <p><b>Your bench is empty!</b></p>
          <p class="muted">Every Fokémon you own is deployed at a gym. Recall one first, then come back to trade.</p>
        </div>
      `);
      return;
    }
    paint(`
      <button type="button" class="trade-back">‹ Back</button>
      ${tradeTalkHtml(recipientName, `Pick the Fokémon you want to send to <b>${escapeHtml(recipientName)}</b>!`, "happy")}
      <div class="trade-picker">
        ${available.map((entry) => tradePickCardHtml(entry)).join("")}
      </div>
    `);
    bodyEl.querySelectorAll(".tcard-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = getInstance(btn.dataset.uid);
        if (!entry || entry.deployedAt) return;
        btn.classList.add("tcard-chosen");
        const req = {
          id: makeRequestId(),
          from: profile.name,
          to: recipientName,
          offer: packInstanceForTrade(entry),
          counterOffer: null,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lat: playerLocation?.lat ?? null,
          lng: playerLocation?.lng ?? null,
        };
        tradeRequests.set(req.id, req);
        publishTradeRequest(req);
        renderRequest(req.id);
      });
    });
  }

  function renderRequest(reqId) {
    const req = tradeRequests.get(reqId);
    if (!req) { renderList(); return; }
    openTradeRequestId = reqId;
    const iAmFrom = req.from === profile?.name;
    const iAmTo = req.to === profile?.name;
    const me = profile?.name;
    const them = iAmFrom ? req.to : req.from;

    // --- The pending recipient still owes a counter: show their picker. ---
    if (req.status === "pending" && iAmTo) {
      const available = availableInstances(caught);
      const fromCardName = cardsById.get(req.offer.cardId)?.name || "a Fokémon";
      if (!available.length) {
        paint(`
          <button type="button" class="trade-back">‹ Back</button>
          ${tradeRailHtml(2)}
          ${tradeTalkHtml(req.from, `<b>${escapeHtml(req.from)}</b> offered you a <b>${escapeHtml(fromCardName)}</b> — but every Fokémon you own is at a gym. Recall one to trade back.`, "sad")}
          <div class="trade-cards"><div class="trade-slot">${tradeMiniCard(req.offer)}</div></div>
          <div class="trade-actions"><button type="button" class="trade-cta danger trade-decline">Decline</button></div>
        `);
      } else {
        paint(`
          <button type="button" class="trade-back">‹ Back</button>
          ${tradeRailHtml(2)}
          ${tradeTalkHtml(req.from, `<b>${escapeHtml(req.from)}</b> threw down a <b>${escapeHtml(fromCardName)}</b>! Pick one of yours to trade back 👇`, "happy")}
          <div class="trade-cards">
            <div class="trade-slot"><span class="slot-name">${escapeHtml(req.from)}</span>${tradeMiniCard(req.offer)}</div>
            <span class="trade-swap-icon">⇄</span>
            <div class="trade-slot"><span class="slot-name">You</span><div class="slot-empty">Pick below 👇</div></div>
          </div>
          <div class="trade-picker">
            ${available.map((entry) => tradePickCardHtml(entry)).join("")}
          </div>
          <div class="trade-actions"><button type="button" class="trade-cta danger trade-decline">Decline trade</button></div>
        `);
        bodyEl.querySelectorAll(".tcard-pick").forEach((btn) => {
          btn.addEventListener("click", () => {
            const entry = getInstance(btn.dataset.uid);
            if (!entry || entry.deployedAt) return;
            const updated = { ...req, counterOffer: packInstanceForTrade(entry), status: "countered", updatedAt: Date.now() };
            tradeRequests.set(req.id, updated);
            publishTradeRequest(updated);
            renderRequest(req.id);
          });
        });
      }
      wireTradeButtons(req);
      return;
    }

    // --- Everything else: the two-card "trade table". ---
    let railStep = 2, railOpts = {};
    let bubble = "";
    let actions = "";
    let tableClass = "";

    if (req.status === "completed") {
      railOpts = { complete: true };
      const gainedCard = iAmFrom ? cardsById.get(req.counterOffer?.cardId) : cardsById.get(req.offer?.cardId);
      const gained = gainedCard?.name || "a new Fokémon";
      const fresh = !celebratedTrades.has(req.id);
      celebratedTrades.add(req.id);
      tableClass = fresh ? "is-swapping" : "is-swapped";
      bubble = `<div class="trade-banner">🎉 <b>Trade complete!</b><span><b>${escapeHtml(gained)}</b> is now yours — it's in your collection.</span></div>`;
      actions = `<button type="button" class="trade-cta big trade-done">Awesome! 🎈</button>`;
    } else if (req.status === "cancelled") {
      railOpts = { cancelled: true };
      bubble = `<div class="trade-banner sad">😕 <b>Trade called off.</b><span>No Fokémon changed hands.</span></div>`;
      actions = `<button type="button" class="trade-cta trade-back">‹ Back to trainers</button>`;
    } else if (req.status === "pending" && iAmFrom) {
      railStep = 2;
      bubble = tradeTalkHtml(req.to, `Sent! Waiting for <b>${escapeHtml(req.to)}</b> to pick a card to trade back${liveDots}`, "wait");
      actions = `<button type="button" class="trade-cta danger trade-cancel">Cancel offer</button>`;
    } else if (req.status === "countered" && iAmFrom) {
      railStep = 3;
      const cn = cardsById.get(req.counterOffer?.cardId)?.name || "a Fokémon";
      bubble = tradeTalkHtml(req.to, `<b>${escapeHtml(req.to)}</b> wants to trade their <b>${escapeHtml(cn)}</b> for yours. Seal the deal? 🤝`, "happy");
      actions = `
        <button type="button" class="trade-cta big trade-confirm">✓ Confirm swap</button>
        <button type="button" class="trade-cta ghost trade-cancel">Cancel</button>`;
    } else if (req.status === "countered" && iAmTo) {
      railStep = 3;
      bubble = tradeTalkHtml(req.from, `Card locked in! Waiting for <b>${escapeHtml(req.from)}</b> to seal the swap${liveDots}`, "wait");
      actions = `<button type="button" class="trade-cta danger trade-cancel">Cancel</button>`;
    }

    const mineOffer = iAmTo ? req.counterOffer : req.offer;
    const theirsOffer = iAmTo ? req.offer : req.counterOffer;
    const myLabel = me ? escapeHtml(me) : "You";
    const theirLabel = escapeHtml(them);

    paint(`
      <button type="button" class="trade-back">‹ Back</button>
      ${tradeRailHtml(railStep, railOpts)}
      ${bubble}
      <div class="trade-table ${tableClass}">
        <div class="trade-slot slot-mine"><span class="slot-name">${myLabel}</span>${tradeMiniCard(mineOffer, { waitingLabel: "You haven't picked yet" })}</div>
        <span class="trade-swap-icon" aria-hidden="true">⇄</span>
        <div class="trade-slot slot-theirs"><span class="slot-name">${theirLabel}</span>${tradeMiniCard(theirsOffer, { waitingLabel: `Waiting for ${escapeHtml(them)}…` })}</div>
        <span class="spark-burst" aria-hidden="true">${"<i></i>".repeat(8)}</span>
      </div>
      <div class="trade-actions">${actions}</div>
    `);
    wireTradeButtons(req);
  }

  function wireTradeButtons(req) {
    bodyEl.querySelector(".trade-confirm")?.addEventListener("click", () => {
      const finalized = { ...req, status: "completed", updatedAt: Date.now() };
      tradeRequests.set(req.id, finalized);
      publishTradeRequest(finalized);
      // Apply locally so the originator's inventory updates immediately.
      applyIncomingCompletedTrade(finalized);
      renderRequest(req.id);
    });
    bodyEl.querySelector(".trade-cancel")?.addEventListener("click", () => {
      const cancelled = { ...req, status: "cancelled", updatedAt: Date.now() };
      locallyCancelledTrades.add(req.id);
      tradeRequests.set(req.id, cancelled);
      publishTradeRequest(cancelled);
      renderRequest(req.id);
    });
    bodyEl.querySelector(".trade-decline")?.addEventListener("click", () => {
      const cancelled = { ...req, status: "cancelled", updatedAt: Date.now() };
      locallyCancelledTrades.add(req.id);
      tradeRequests.set(req.id, cancelled);
      publishTradeRequest(cancelled);
      renderList();
    });
    bodyEl.querySelector(".trade-done")?.addEventListener("click", close);
  }

  function renderOutOfRange(name) {
    openTradeRequestId = "list";
    paint(`
      <button type="button" class="trade-back">‹ Back</button>
      <div class="trade-empty">
        <span class="empty-emoji">📡</span>
        <p><b>${escapeHtml(name)} is too far away!</b></p>
        <p class="muted">You need to be within <b>${TRADE_RANGE_METERS}m</b> of ${escapeHtml(name)} (and they must have been active recently). Walk closer and try again.</p>
      </div>
    `);
  }

  openTradeRefresh = () => {
    // If a tracked request gets a new status update behind the scenes, refresh the view.
    if (openTradeRequestId && openTradeRequestId !== "list" && tradeRequests.has(openTradeRequestId)) {
      renderRequest(openTradeRequestId);
    } else if (!offerTo) {
      // Don't yank the player out of the offer picker on a background sync.
      renderList();
    }
  };

  if (offerTo) {
    if (nearbyTrainerEntries().some((t) => t.name === offerTo)) {
      renderOffer(offerTo);
    } else {
      renderOutOfRange(offerTo);
    }
  } else if (initialRequestId && tradeRequests.has(initialRequestId)) {
    renderRequest(initialRequestId);
  } else {
    renderList();
  }
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
    tradesNode = root.get("trades");
    presenceNode = root.get("presence");
    connectFeed();
    connectGridCaught();
    subscribeChampionUpdates();
    subscribeTrades();
    subscribePresence();
  } catch {
    eventsNode = FALLBACK_EVENTS_NODE;
  }
}

// ---- App-shell navigation ----------------------------------------------
// The map is the persistent stage. The bottom bar + ticker raise
// bottom-sheets *over* the still-running map; nothing here ever scrolls
// the page. Gameplay modals (catch/battle/card-viewer) keep their higher
// z-index and sit above all of this untouched.
function initAppShell() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  const scrim = el.sheetScrim;
  if (!scrim) return;
  const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
  const sheets = {
    catch: document.getElementById("sheet-catch"),
    collection: document.getElementById("sheet-collection"),
    feed: document.getElementById("sheet-feed"),
  };
  let activeSheet = null;
  let closeTimer = null;

  function setActiveNav(name) {
    navButtons.forEach((b) => {
      const n = b.dataset.nav;
      b.classList.toggle("is-active", name ? n === name : n === "map");
    });
  }

  function openSheet(name) {
    const sheet = sheets[name];
    if (!sheet) return;
    if (activeSheet && activeSheet !== name) {
      const prev = sheets[activeSheet];
      if (prev) prev.classList.remove("show"), prev.classList.add("hidden");
    }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    activeSheet = name;
    scrim.classList.remove("hidden");
    sheet.classList.remove("hidden");
    void sheet.offsetWidth; // reflow so the slide-up transition runs
    requestAnimationFrame(() => {
      scrim.classList.add("show");
      sheet.classList.add("show");
    });
    setActiveNav(name);
    // Refresh content that may have changed while the sheet was closed.
    if (name === "catch") renderCards();
    else if (name === "collection") renderCollection();
    else if (name === "feed") renderFeed();
  }

  function closeSheet() {
    if (!activeSheet) return;
    const sheet = sheets[activeSheet];
    activeSheet = null;
    scrim.classList.remove("show");
    if (sheet) sheet.classList.remove("show");
    setActiveNav(null);
    closeTimer = setTimeout(() => {
      scrim.classList.add("hidden");
      if (sheet) sheet.classList.add("hidden");
      closeTimer = null;
    }, 340);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "map") {
        if (activeSheet) closeSheet();
        else recenterOnPlayer();
        return;
      }
      if (activeSheet === nav) closeSheet();
      else openSheet(nav);
    });
  });

  if (el.feedTicker) {
    el.feedTicker.addEventListener("click", () => {
      if (activeSheet === "feed") closeSheet();
      else openSheet("feed");
    });
  }

  scrim.addEventListener("click", closeSheet);
  document
    .querySelectorAll("[data-sheet-close]")
    .forEach((b) => b.addEventListener("click", closeSheet));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeSheet) closeSheet();
  });

  // Swipe-down on a sheet header dismisses it (native bottom-sheet feel).
  Object.values(sheets).forEach((sheet) => {
    const head = sheet && sheet.querySelector(".sheet-head");
    if (!head) return;
    let startY = 0;
    let dy = 0;
    let dragging = false;
    head.addEventListener(
      "touchstart",
      (e) => {
        dragging = true;
        startY = e.touches[0].clientY;
        dy = 0;
        sheet.style.transition = "none";
      },
      { passive: true }
    );
    head.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging) return;
        dy = Math.max(0, e.touches[0].clientY - startY);
        sheet.style.transform = `translate(-50%, ${dy}px)`;
      },
      { passive: true }
    );
    head.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (dy > 90) closeSheet();
    });
  });

  // Keep Leaflet sized to the full-screen container across viewport changes.
  const resize = () => requestAnimationFrame(() => leafletMap?.invalidateSize());
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 250));
}

function enterGame() {
  if (!el.auth || !el.game) return;
  el.auth.classList.add("hidden");
  el.game.classList.remove("hidden");
  // Compact HUD chip — the "Live sync" eyebrow carries the context, so the
  // headline is just the trainer name (it ellipsises within the chip).
  el.welcome.textContent = profile.name;
  document.documentElement.style.setProperty(
    "--accent",
    profile.team === "violet" ? "#ca90ff" : profile.team === "sun" ? "#ffd173" : "#7cf0c6"
  );
  ensureMap();
  // The map just went from display:none to a fixed full-viewport stage —
  // give Leaflet a beat to pick up the new size (URL bar / font load too).
  setTimeout(() => leafletMap?.invalidateSize(), 220);
  ensureFreshPlacements();
  renderBallCount();
  renderCards();
  renderMap();
  renderCollection();
  renderTradeBadge();
  connectFeed();
  updateBucketLabel();
  renderDebugChip();
  initCardViewer();
  bootstrapLocation();
}

if (el.collectionSort) {
  el.collectionSort.addEventListener("change", () => {
    const val = el.collectionSort.value;
    if (!VALID_SORTS.has(val)) return;
    collectionSort = val;
    try { localStorage.setItem(COLLECTION_SORT_KEY, val); } catch {}
    renderCollection();
  });
}

if (el.expandAllBtn) {
  el.expandAllBtn.addEventListener("click", () => {
    const groups = groupCollection(caught, cardsById, collectionSort);
    const multi = groups.filter((g) => g.count > 1).map((g) => g.id);
    const allOpen = multi.length > 0 && multi.every((id) => expandedSpecies.has(id));
    if (allOpen) expandedSpecies.clear();
    else multi.forEach((id) => expandedSpecies.add(id));
    renderCollection();
  });
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

function confirmSwitchTrainer() {
  if (document.getElementById("logoutConfirm")) return;
  const overlay = document.createElement("div");
  overlay.id = "logoutConfirm";
  overlay.className = "modal";
  const who = escapeHtml(profile?.name || "this trainer");
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="logoutConfirmTitle">
      <p class="eyebrow">Switch trainer</p>
      <h2 id="logoutConfirmTitle">Log out of ${who}?</h2>
      <p>This signs out on this device and returns to the trainer setup screen. Your caught Fokemon and gym champions stay safe on the network — you can sign back in with the same name to pick up where you left off.</p>
      <div class="debug-actions">
        <button type="button" class="ghost lo-cancel">Stay logged in</button>
        <button type="button" class="lo-confirm">Log out</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(ev) { if (ev.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelector(".lo-cancel").addEventListener("click", close);
  overlay.querySelector(".lo-confirm").addEventListener("click", () => {
    try { localStorage.removeItem("fokemon_profile"); } catch {}
    location.reload();
  });
}

if (el.reset) {
  el.reset.addEventListener("click", confirmSwitchTrainer);
}

if (el.enableLocation) {
  el.enableLocation.addEventListener("click", () => {
    setModalHelp("Requesting your location…");
    startLocationTracking();
  });
}

if (el.tradeBtn) {
  el.tradeBtn.addEventListener("click", () => {
    if (openTradeRequestId) return;
    openTradeModal();
  });
}


initGun();
initAppShell();

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
    renderTradeBadge();
  }, 1000);

  // Idle heartbeat: keeps this trainer discoverable for trading even when
  // they aren't catching anything. Forced (bypasses the publish throttle).
  setInterval(() => publishPresence(true), PRESENCE_HEARTBEAT_MS);
}
