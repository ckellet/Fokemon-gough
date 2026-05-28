export const SPAWN_CELL_DEGREES = 0.001;
export const POI_COOLDOWN_MS = 5 * 60 * 1000;
export const BATTLE_SITE_NEIGHBORHOOD_CELLS = 2;
// Battle sites are placed in 3×3 cell macro blocks (~333m square). Exactly
// one gym is guaranteed per non-ocean macro — this both bumps the count
// slightly vs. pure-random rolls and spreads them more evenly.
export const BATTLE_SITE_MACRO_SIZE = 3;
export const MAX_TRAINING_BOOST_PER_STAT = 28;
export const MAX_CHAMPION_DEFENSES = 5;
export const CHAMPION_TTL_MS = 24 * 60 * 60 * 1000;
// Champions resting on guard duty accrue +1 HP boost per interval, capped by
// MAX_TRAINING_BOOST_PER_STAT. Slower than the training drill so the drill is
// still the way to push other stats.
export const GYM_REST_HP_INTERVAL_MS = 30 * 60 * 1000;

// How long a trainer stays on the map / discoverable for trading after their
// last location signal (catch event OR presence heartbeat). Two windows,
// matching what the UI already used inline before presence existed:
//   - TRADE_DISCOVERY_TTL_MS: still selectable as a nearby trade partner.
//   - PRESENCE_TTL_MS: still drawn as a map marker (the more forgiving one,
//     also the cutoff below which we don't even bother storing a location).
export const TRADE_DISCOVERY_TTL_MS = 15 * 60 * 1000;
export const PRESENCE_TTL_MS = 30 * 60 * 1000;

// Conservative open-ocean exclusion boxes. Cells whose centre falls inside one
// of these boxes get no POIs or battle sites — keeps mid-ocean clear without
// risking false exclusions over coasts or islands.
// Each entry is [minLat, maxLat, minLon, maxLon].
export const OCEAN_EXCLUSIONS = [
  [22, 48, -148, -130],   // North Pacific (US west coast ↔ Hawaii)
  [-10, 18, -145, -115],  // Central Pacific (south of Hawaii, east of Polynesia)
  [-48, -25, -125, -90],  // South Pacific (east of Polynesia ↔ South America)
  [32, 48, -50, -32],     // North Atlantic (Bermuda ↔ Azores)
  [-10, 10, -28, -18],    // Equatorial Atlantic (Brazil ↔ West Africa)
  [-45, -22, -30, 5],     // South Atlantic
  [-25, -8, 70, 88],      // Central Indian Ocean
  [-48, -32, 58, 100],    // South Indian Ocean (south of Madagascar)
  [85, 90, -180, 180],    // High Arctic Ocean
];

export function isInOceanExclusion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  for (let i = 0; i < OCEAN_EXCLUSIONS.length; i++) {
    const z = OCEAN_EXCLUSIONS[i];
    if (lat >= z[0] && lat <= z[1] && lon >= z[2] && lon <= z[3]) return true;
  }
  return false;
}

export function computeCollectionStats(caught) {
  const uniqueIds = [...new Set((caught || []).map((c) => c.id))];
  return {
    total: (caught || []).length,
    unique: uniqueIds.length,
    uniqueIds,
  };
}

// Collection view: sorting + duplicate grouping ----------------------------

// Sort options surfaced in the collection toolbar. `key` is persisted; `label`
// is the single source of truth for the UI dropdown.
export const COLLECTION_SORTS = [
  { key: "recent", label: "Recently caught" },
  { key: "oldest", label: "Oldest first" },
  { key: "power", label: "Power (strongest)" },
  { key: "hp", label: "HP (highest)" },
  { key: "name", label: "Name (A–Z)" },
  { key: "type", label: "Type" },
  { key: "rarity", label: "Rarity" },
];

const RARITY_RANK = { epic: 0, rare: 1, common: 2 };

function entryPower(entry, card) {
  if (!card) return 0;
  const b = entry?.boosts || EMPTY_BOOSTS;
  const total =
    (card.hp || 0) + (card.atk || 0) + (card.def || 0) + (card.spd || 0)
    + (b.hp || 0) + (b.atk || 0) + (b.def || 0) + (b.spd || 0);
  return Math.round(total * evoStatMult(entry?.evoStage));
}

function entryHp(entry, card) {
  return (card?.hp || 0) + (entry?.boosts?.hp || 0);
}

function nameCmp(a, b) {
  return String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""));
}

// Comparator over species groups. Date sorts use the group's newest/oldest
// catch; stat sorts use the strongest individual (the representative).
function groupComparator(sortKey) {
  return (A, B) => {
    const a = A.representative, b = B.representative;
    const ca = A.card, cb = B.card;
    switch (sortKey) {
      case "oldest":
        return (A.oldestTs - B.oldestTs) || nameCmp(ca, cb);
      case "power":
        return (entryPower(b, cb) - entryPower(a, ca)) || nameCmp(ca, cb);
      case "hp":
        return (entryHp(b, cb) - entryHp(a, ca)) || nameCmp(ca, cb);
      case "name":
        return nameCmp(ca, cb);
      case "type":
        return String(ca?.type || "").localeCompare(String(cb?.type || "")) || nameCmp(ca, cb);
      case "rarity":
        return ((RARITY_RANK[ca?.rarity] ?? 9) - (RARITY_RANK[cb?.rarity] ?? 9)) || nameCmp(ca, cb);
      case "recent":
      default:
        return (B.newestTs - A.newestTs) || nameCmp(ca, cb);
    }
  };
}

// Group caught entries by species and order them for display.
//   caught   - array of caught instance entries
//   lookup   - (id) => card definition (or undefined)
//   sortKey  - one of COLLECTION_SORTS keys
// Returns an ordered array of groups:
//   { id, card, members, representative, count, newestTs, oldestTs }
// `members` is ordered strongest-first; `representative` is members[0].
export function groupCollection(caught, lookup, sortKey = "recent") {
  const get = typeof lookup === "function"
    ? lookup
    : (id) => (lookup && typeof lookup.get === "function" ? lookup.get(id) : undefined);
  const byId = new Map();
  for (const entry of caught || []) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }
  const groups = [];
  for (const [id, members] of byId) {
    const card = get(id) || null;
    const ordered = [...members].sort(
      (a, b) => (entryPower(b, card) - entryPower(a, card)) || ((b.ts || 0) - (a.ts || 0))
    );
    const tsValues = members.map((m) => m.ts || 0);
    groups.push({
      id,
      card,
      members: ordered,
      representative: ordered[0],
      count: members.length,
      newestTs: tsValues.length ? Math.max(...tsValues) : 0,
      oldestTs: tsValues.length ? Math.min(...tsValues) : 0,
    });
  }
  groups.sort(groupComparator(sortKey));
  return groups;
}

// Flatten ordered groups into the linear sequence the immersive viewer pages
// through: each group's members in strongest-first order.
export function flattenCollectionGroups(groups) {
  const out = [];
  for (const g of groups || []) {
    g.members.forEach((entry, indexInGroup) => {
      out.push({
        entry,
        speciesId: g.id,
        indexInGroup,
        groupCount: g.count,
        isRepresentative: indexInGroup === 0,
      });
    });
  }
  return out;
}

export const EMPTY_BOOSTS = Object.freeze({ hp: 0, atk: 0, def: 0, spd: 0 });

function randomToken() {
  // Compact, collision-resistant-enough random token for client-only ids.
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function makeInstanceUid(cardId, ts = Date.now()) {
  return `${cardId}-${ts}-${randomToken()}`;
}

export function normalizeBoosts(raw) {
  return {
    hp: clampBoost(raw?.hp ?? 0),
    atk: clampBoost(raw?.atk ?? 0),
    def: clampBoost(raw?.def ?? 0),
    spd: clampBoost(raw?.spd ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Trade offer wire format
// ---------------------------------------------------------------------------
// A trade record syncs through `fokemon/trades/<id>` and is read on every peer
// via `tradesNode.map().on()`. GUN's `.map().on()` does NOT resolve nested
// child objects — a `put({ offer: { ... } })` is stored as a *separate graph
// node*, so the receiver sees `offer` as an unresolved link (`{ '#': soul }`),
// never the real `{ uid, cardId, boosts }`. The originator's own callback fires
// with the full object only because GUN already has that subgraph cached
// locally from its own `.put()` — which is exactly why "I can send a trade but
// the other player never receives it" happens in two-browser testing.
//
// Fix: keep the offer as a single JSON *string* scalar. Strings sync verbatim
// through `.map().on()`, so both peers reconstruct an identical offer.
export function serializeTradeOffer(offer) {
  if (!offer || typeof offer !== "object") return null;
  if (!offer.uid || !offer.cardId) return null;
  return JSON.stringify({
    uid: String(offer.uid),
    cardId: String(offer.cardId),
    boosts: normalizeBoosts(offer.boosts),
    caughtAt: Number(offer.caughtAt) || 0,
    evoStage: clampEvoStage(offer.evoStage),
  });
}

// Accepts what a peer actually receives: a JSON string (the wire format), or a
// plain object (a local echo before it round-trips, or a legacy record). An
// unresolved GUN link (`{ '#': ... }`, no uid/cardId) yields null so a partial
// graph read can't masquerade as a real offer. Card-existence is the caller's
// job (it needs the live card index); this only fixes the shape.
export function parseTradeOffer(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  if (!obj.uid || !obj.cardId) return null;
  return {
    uid: String(obj.uid),
    cardId: String(obj.cardId),
    boosts: normalizeBoosts(obj.boosts),
    caughtAt: Number(obj.caughtAt) || 0,
    evoStage: clampEvoStage(obj.evoStage),
  };
}

export function migrateCaughtEntries(entries) {
  // Assign uid/boosts/deployedAt to legacy entries while preserving any newer
  // fields. Returns a new array; safe to call multiple times.
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const id = String(entry.id || "");
    const ts = Number(entry.ts) || Date.now();
    const migrated = {
      id,
      ts,
      uid: entry.uid || makeInstanceUid(id, ts),
      boosts: normalizeBoosts(entry.boosts),
      deployedAt: entry.deployedAt ? String(entry.deployedAt) : null,
    };
    // Preserve raid trophy metadata across reloads — these flags drive UI
    // affordances (the UBERMAX laurel) and lifecycle gates (raid-parked
    // instances can't double-deploy).
    if (entry.ubermax) migrated.ubermax = true;
    if (entry.raidId) migrated.raidId = String(entry.raidId);
    if (entry.raidParked) migrated.raidParked = String(entry.raidParked);
    // Evolution tier only stored when above base, so untouched entries stay
    // byte-identical to the legacy shape.
    const stage = clampEvoStage(entry.evoStage);
    if (stage > 0) migrated.evoStage = stage;
    return migrated;
  });
}

export function availableInstances(caught) {
  return (caught || []).filter((c) => c && !c.deployedAt);
}

export function deployedInstanceAtSite(caught, siteId) {
  if (!siteId) return null;
  return (caught || []).find((c) => c && c.deployedAt === siteId) || null;
}

export function mergeBoosts(a, b) {
  return normalizeBoosts({
    hp: (a?.hp || 0) + (b?.hp || 0),
    atk: (a?.atk || 0) + (b?.atk || 0),
    def: (a?.def || 0) + (b?.def || 0),
    spd: (a?.spd || 0) + (b?.spd || 0),
  });
}

export function mergeRecentEvents(currentEvents, incomingEvent, maxItems = 100) {
  if (!incomingEvent || !incomingEvent.ts || !incomingEvent.trainer || !incomingEvent.card) {
    return currentEvents;
  }

  const exists = currentEvents.some(
    (e) => e.ts === incomingEvent.ts && e.trainer === incomingEvent.trainer && e.card === incomingEvent.card
  );
  if (exists) return currentEvents;

  const merged = [...currentEvents, incomingEvent];
  if (merged.length > maxItems) return merged.slice(merged.length - maxItems);
  return merged;
}

// Decide how an incoming location signal should update the in-memory
// trainerLocations entry for one trainer. Used for BOTH catch events and
// presence heartbeats so the two stay consistent:
//   - Newest timestamp wins, so a late-arriving stale catch event can never
//     clobber a fresh presence heartbeat (or vice versa).
//   - Anything already older than ttlMs is dropped — it would never be shown
//     anyway, and this keeps the map from accumulating ancient trainers when
//     a peer replays a long-dormant presence record on connect.
// Returns the entry to keep (the existing one unchanged when nothing should
// change, a new entry when it should update, or null when there's nothing
// worth storing). Pure: callers diff by reference to decide whether to redraw.
export function mergeTrainerLocation(existing, incoming, now = Date.now(), ttlMs = PRESENCE_TTL_MS) {
  if (!incoming) return existing ?? null;
  // Reject nullish coords explicitly: a catch event may publish lat/lng:null,
  // and Number(null) === 0 would otherwise drop the trainer onto null island.
  if (incoming.lat == null || incoming.lng == null || incoming.ts == null) {
    return existing ?? null;
  }
  const lat = Number(incoming.lat);
  const lng = Number(incoming.lng);
  const ts = Number(incoming.ts);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts)) {
    return existing ?? null;
  }
  if (now - ts > ttlMs) return existing ?? null;
  if (existing && Number.isFinite(existing.ts) && existing.ts >= ts) return existing;
  return { lat, lng, ts };
}

export function getGridKey(lat, lon, cellSizeDegrees = SPAWN_CELL_DEGREES) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const latCell = Math.floor((lat + 90) / cellSizeDegrees);
  const lonCell = Math.floor((lon + 180) / cellSizeDegrees);
  return `${latCell}:${lonCell}`;
}

function hashToUnitInterval(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function cellOrigin(value, axis, cellSizeDegrees) {
  const shift = axis === "lat" ? 90 : 180;
  return Math.floor((value + shift) / cellSizeDegrees) * cellSizeDegrees - shift;
}

export function computeSpawnPlacements(
  cards,
  {
    timeMs = Date.now(),
    lat = 0,
    lon = 0,
    intervalMs = 5 * 60 * 1000,
    maxSpawns = 3,
    cellSizeDegrees = SPAWN_CELL_DEGREES,
  } = {}
) {
  if (!Array.isArray(cards) || !cards.length) return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const grid = getGridKey(lat, lon, cellSizeDegrees);
  if (!grid) return [];
  const bucket = Math.floor(timeMs / intervalMs);
  const latBase = cellOrigin(lat, "lat", cellSizeDegrees);
  const lonBase = cellOrigin(lon, "lon", cellSizeDegrees);

  return cards
    .map((card) => ({ card, score: hashToUnitInterval(`${grid}|${bucket}|${card.id}`) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(maxSpawns, cards.length))
    .map(({ card }) => ({
      card,
      lat: latBase + hashToUnitInterval(`${grid}|${bucket}|${card.id}|lat`) * cellSizeDegrees,
      lng: lonBase + hashToUnitInterval(`${grid}|${bucket}|${card.id}|lng`) * cellSizeDegrees,
      grid,
      bucket,
      expiresAt: (bucket + 1) * intervalMs,
    }));
}

export function computeSpawnSlots(cards, options) {
  return computeSpawnPlacements(cards, options).map((p) => p.card);
}

export function filterUncaughtSpawns(spawns, caughtIds) {
  const caughtSet = caughtIds instanceof Set ? caughtIds : new Set(caughtIds || []);
  return (spawns || []).filter((spawn) => !caughtSet.has(spawn.id));
}

export function computePoiPlacements(
  lat,
  lon,
  { cellSizeDegrees = SPAWN_CELL_DEGREES, neighborhoodCells = 1 } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const placements = [];
  const latBaseCell = Math.floor((lat + 90) / cellSizeDegrees);
  const lonBaseCell = Math.floor((lon + 180) / cellSizeDegrees);

  for (let dlat = -neighborhoodCells; dlat <= neighborhoodCells; dlat++) {
    for (let dlon = -neighborhoodCells; dlon <= neighborhoodCells; dlon++) {
      const latCell = latBaseCell + dlat;
      const lonCell = lonBaseCell + dlon;
      const latBase = latCell * cellSizeDegrees - 90;
      const lonBase = lonCell * cellSizeDegrees - 180;
      if (isInOceanExclusion(latBase + cellSizeDegrees / 2, lonBase + cellSizeDegrees / 2)) continue;
      const cellKey = `${latCell}:${lonCell}`;
      const density = hashToUnitInterval(`poi-density|${cellKey}`);
      let count;
      if (density < 0.32) count = 0;
      else if (density < 0.74) count = 1;
      else if (density < 0.94) count = 2;
      else count = 3;

      for (let i = 0; i < count; i++) {
        placements.push({
          id: `${cellKey}|${i}`,
          grid: cellKey,
          lat: latBase + hashToUnitInterval(`poi|${cellKey}|${i}|lat`) * cellSizeDegrees,
          lng: lonBase + hashToUnitInterval(`poi|${cellKey}|${i}|lng`) * cellSizeDegrees,
        });
      }
    }
  }
  return placements;
}

export function isPoiAvailable(poi, spentMap, now = Date.now(), cooldownMs = POI_COOLDOWN_MS) {
  if (!poi) return false;
  const spent = spentMap && (spentMap instanceof Map ? spentMap.get(poi.id) : spentMap[poi.id]);
  if (!spent) return true;
  return now - spent >= cooldownMs;
}

export function computeBattleSitePlacements(
  lat,
  lon,
  {
    cellSizeDegrees = SPAWN_CELL_DEGREES,
    neighborhoodCells = BATTLE_SITE_NEIGHBORHOOD_CELLS,
    macroSize = BATTLE_SITE_MACRO_SIZE,
  } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const placements = [];
  const seen = new Set();
  const latBaseCell = Math.floor((lat + 90) / cellSizeDegrees);
  const lonBaseCell = Math.floor((lon + 180) / cellSizeDegrees);

  // Expand the scan range so every macro overlapping the requested neighborhood
  // gets evaluated even when the player sits near its edge.
  const scan = neighborhoodCells + macroSize;
  for (let dlat = -scan; dlat <= scan; dlat++) {
    for (let dlon = -scan; dlon <= scan; dlon++) {
      const latCell = latBaseCell + dlat;
      const lonCell = lonBaseCell + dlon;
      const macroLat = Math.floor(latCell / macroSize);
      const macroLon = Math.floor(lonCell / macroSize);
      const macroKey = `${macroLat}:${macroLon}`;
      if (seen.has(macroKey)) continue;

      // Deterministically pick which cell inside this macro hosts the gym.
      const slotCount = macroSize * macroSize;
      const slot = Math.floor(hashToUnitInterval(`bs-macro|${macroKey}|slot`) * slotCount);
      const slotLat = Math.floor(slot / macroSize);
      const slotLon = slot % macroSize;
      const chosenLatCell = macroLat * macroSize + slotLat;
      const chosenLonCell = macroLon * macroSize + slotLon;

      // Keep the scan tight: skip macros that wouldn't yield a gym in the
      // requested neighborhood window anyway.
      if (
        Math.abs(chosenLatCell - latBaseCell) > neighborhoodCells ||
        Math.abs(chosenLonCell - lonBaseCell) > neighborhoodCells
      ) {
        seen.add(macroKey);
        continue;
      }

      const latBase = chosenLatCell * cellSizeDegrees - 90;
      const lonBase = chosenLonCell * cellSizeDegrees - 180;
      if (isInOceanExclusion(latBase + cellSizeDegrees / 2, lonBase + cellSizeDegrees / 2)) {
        seen.add(macroKey);
        continue;
      }

      const cellKey = `${chosenLatCell}:${chosenLonCell}`;
      placements.push({
        id: `bs|${cellKey}`,
        grid: cellKey,
        lat: latBase + hashToUnitInterval(`bs|${cellKey}|lat`) * cellSizeDegrees,
        lng: lonBase + hashToUnitInterval(`bs|${cellKey}|lng`) * cellSizeDegrees,
      });
      seen.add(macroKey);
    }
  }
  return placements;
}

const SITE_ADJECTIVES = [
  "Crystal", "Ember", "Glacial", "Hollow", "Solar", "Twilight",
  "Verdant", "Storm", "Iron", "Wild", "Aurora", "Mossy",
  "Sunken", "Cinder", "Quiet", "Howling", "Lumen", "Drift",
  "Bramble", "Velvet", "Cobalt", "Marble", "Onyx", "Amber",
  "Frosted", "Gilded", "Hidden", "Lonely", "Restless", "Ashen",
  "Silken", "Tidal", "Whispering", "Crooked", "Singing", "Stoneworn",
  "Crimson", "Lantern", "Shimmer", "Vagrant",
];
const SITE_NOUNS = [
  "Spire", "Falls", "Arena", "Grove", "Bastion", "Hollow",
  "Court", "Keep", "Cradle", "Forge", "Glade", "Reach",
  "Ring", "Pyre", "Den", "Hall", "Steppe", "Crag",
  "Cairn", "Watch", "Mire", "Vault", "Wharf", "Embers",
  "Bluff", "Cove", "Causeway", "Hearth", "Lyceum", "Marsh",
  "Meadow", "Obelisk", "Pavilion", "Quay", "Refuge", "Sanctum",
  "Tower", "Verge", "Wellspring", "Yard",
];
const SITE_SUFFIXES = [
  "", "of the Dawn", "of the Hush", "of the Veil", "of Echoes",
  "of the Ember", "of the Tide", "of the Wisp", "of the Lattice",
  "of the Mirror", "of the Spine", "of the Cinder",
];

// Mix the input so adjacent IDs (which share long prefixes) don't pick adjacent
// dictionary slots. Salt with a per-token nonce and a reversed-id tail.
function nameSeed(siteId, role, salt) {
  const tail = String(siteId).split("").reverse().join("");
  return hashToUnitInterval(`${salt}|${role}|${siteId}|${tail}|${role}`);
}

export function battleSiteName(siteId) {
  const adj = SITE_ADJECTIVES[Math.floor(nameSeed(siteId, "adj", "Q7r") * SITE_ADJECTIVES.length)];
  const noun = SITE_NOUNS[Math.floor(nameSeed(siteId, "noun", "9LM") * SITE_NOUNS.length)];
  const suffix = SITE_SUFFIXES[Math.floor(nameSeed(siteId, "suf", "kV3") * SITE_SUFFIXES.length)];
  return suffix ? `${adj} ${noun} ${suffix}` : `${adj} ${noun}`;
}

// Twelve distinct visual identities — each gym permanently picks one based on
// its id, so the same gym looks the same every visit regardless of who holds it.
export const SITE_THEMES = [
  { tag: "Pyre",    color: "#ff7a45", accent: "#ffd2b3", glyph: "🔥" },
  { tag: "Tide",    color: "#4cb8ff", accent: "#c4ecff", glyph: "🌊" },
  { tag: "Grove",   color: "#6ddc8a", accent: "#c8ffd6", glyph: "🌿" },
  { tag: "Storm",   color: "#b27cff", accent: "#e2d0ff", glyph: "⚡" },
  { tag: "Frost",   color: "#9ee8ff", accent: "#dff7ff", glyph: "❄" },
  { tag: "Shadow",  color: "#7c5fff", accent: "#cdc1ff", glyph: "🌙" },
  { tag: "Cosmic",  color: "#ffd166", accent: "#fff0c2", glyph: "✦" },
  { tag: "Forge",   color: "#d4a25a", accent: "#f1d8a8", glyph: "⚒" },
  { tag: "Spirit",  color: "#ff8aa8", accent: "#ffd1de", glyph: "✧" },
  { tag: "Crystal", color: "#7af0ff", accent: "#cef7ff", glyph: "◈" },
  { tag: "Beast",   color: "#a8e85b", accent: "#dfffaa", glyph: "🐾" },
  { tag: "Wind",    color: "#bcdcff", accent: "#e3f0ff", glyph: "🍃" },
];

export function siteTheme(siteId) {
  const idx = Math.floor(nameSeed(siteId, "theme", "Th7") * SITE_THEMES.length);
  return SITE_THEMES[Math.min(idx, SITE_THEMES.length - 1)];
}

export function clampBoost(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_TRAINING_BOOST_PER_STAT, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Evolution + type-food
// ---------------------------------------------------------------------------
// Catching any Fokemon yields food keyed to its TYPE (not its species). Spend a
// type's food to evolve any caught Fokemon of that type up a tier. Higher tiers
// are bigger, renamed (Super → Mega) and stat-multiplied (evoStatMult), so even
// the most basic spawns stay worth catching — they're the evolution-fuel farm.

// Per-catch food yield. Flat across rarities on purpose: commons spawn most
// often, so a flat yield makes them the reliable fuel grind the loop wants.
export const FOOD_PER_CATCH = 10;

// Highest tier an instance can reach (0 = base, freshly caught).
export const EVO_MAX_STAGE = 2;

// Food cost to climb FROM the indexed stage to the next. index 0 = base→1.
export const EVO_FOOD_COSTS = [50, 150];

// Display-name prefix per stage. Stage 0 is the plain species name.
export const EVO_NAME_PREFIX = ["", "Super ", "Mega "];

// Multiplier applied to (base + boost) per stage in effectiveStats — the single
// knob that makes an evolved Fokemon "more powerful" everywhere stats are read
// (collection power, gym battles, raid damage).
export const EVO_STAT_MULT = [1, 1.35, 1.85];

// One food per type. `name` is surfaced in the UI; `emoji` rides the chips.
export const TYPE_FOOD = {
  Electric: { name: "Voltbites",    emoji: "⚡" },
  Leaf:     { name: "Sproutsnacks", emoji: "🌿" },
  Water:    { name: "Dewdrops",     emoji: "💧" },
  Fire:     { name: "Cindersnaps",  emoji: "🔥" },
  Shadow:   { name: "Umbragums",    emoji: "🌑" },
  Ice:      { name: "Frostflakes",  emoji: "❄️" },
  Wind:     { name: "Gustpuffs",    emoji: "🌬️" },
  Rock:     { name: "Cragcrunch",   emoji: "🪨" },
  Cosmic:   { name: "Stardrops",    emoji: "🌟" },
  Spirit:   { name: "Wispwafers",   emoji: "👻" },
  Bug:      { name: "Nectarnibs",   emoji: "🍯" },
  Metal:    { name: "Cogchews",     emoji: "⚙️" },
};

export function foodForType(type) {
  return TYPE_FOOD[type] || { name: `${type || "Mystery"} treats`, emoji: "🍬" };
}

export function clampEvoStage(value) {
  const n = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(EVO_MAX_STAGE, n));
}

export function evoStatMult(stage) {
  return EVO_STAT_MULT[clampEvoStage(stage)] ?? 1;
}

// Food required to advance FROM `stage` to `stage + 1`, or null when maxed.
export function evoCostFor(stage) {
  const s = clampEvoStage(stage);
  if (s >= EVO_MAX_STAGE) return null;
  return EVO_FOOD_COSTS[s] ?? null;
}

export function evoDisplayName(name, stage) {
  return `${EVO_NAME_PREFIX[clampEvoStage(stage)] || ""}${name || ""}`;
}

// Keep a food bag as a clean { [type]: positiveInt } map (drops zero/junk).
export function normalizeFoodBag(raw) {
  const bag = {};
  if (raw && typeof raw === "object") {
    for (const type of Object.keys(TYPE_FOOD)) {
      const n = Math.floor(Number(raw[type]) || 0);
      if (n > 0) bag[type] = n;
    }
  }
  return bag;
}

// Whether an instance can evolve right now, plus everything the UI needs to
// render the affordance (cost, have, short-by, next tier + name).
export function evolutionState(card, entry, foodBag) {
  if (!card) return { ok: false, reason: "unknown" };
  const stage = clampEvoStage(entry?.evoStage);
  const food = foodForType(card.type);
  const have = Math.max(0, Math.floor(Number(foodBag?.[card.type]) || 0));
  if (stage >= EVO_MAX_STAGE) {
    return { ok: false, reason: "maxed", stage, nextStage: stage, cost: null, have, shortBy: 0, type: card.type, food, nextName: evoDisplayName(card.name, stage) };
  }
  const cost = evoCostFor(stage);
  const deployed = !!(entry?.deployedAt || entry?.raidParked);
  const ok = !deployed && cost != null && have >= cost;
  return {
    ok,
    reason: deployed ? "deployed" : have < (cost ?? Infinity) ? "short" : "ready",
    stage,
    nextStage: stage + 1,
    cost,
    have,
    shortBy: Math.max(0, (cost ?? 0) - have),
    type: card.type,
    food,
    nextName: evoDisplayName(card.name, stage + 1),
  };
}

// ---------------------------------------------------------------------------
// UberMax raid bosses
// ---------------------------------------------------------------------------
// Giant co-op bosses. One raid lives at a (macro cell × time bucket); any
// trainer within UBERMAX_RANGE_METERS can commit a Fokemon to the shared
// army. Each contribution chips real HP off the boss. If the army drops the
// HP to 0 before the bucket ends, every contributor gets to keep an UberMax
// copy. If the timer expires first, the boss escapes and contributors get a
// FokéBall consolation. Placements are deterministic so every peer sees the
// same raid at the same coordinates; the live state syncs through GUN.
export const UBERMAX_INTERVAL_MS = 30 * 60 * 1000;
export const UBERMAX_MACRO_SIZE = 7;           // ~777m macro — much sparser than gyms
export const UBERMAX_NEIGHBORHOOD_CELLS = 6;   // visible from further out than gyms/spawns
export const UBERMAX_SPAWN_RATE = 0.45;        // ~45% of land macros host a raid per bucket
export const UBERMAX_RANGE_METERS = 250;       // bigger interact range than a gym
export const UBERMAX_MAX_CONTRIBUTORS = 24;    // soft cap so a 20-person mob doesn't trivialise it
export const UBERMAX_HP_MULT = 4.8;
export const UBERMAX_HP_BONUS = 240;
export const UBERMAX_ATK_MULT = 2.4;
export const UBERMAX_DEF_MULT = 2.0;
export const UBERMAX_DAMAGE_MULT = 2.2;        // scales per-contributor damage so 3–4 trainers can win
export const UBERMAX_REWARD_BOOST_HP = 24;
export const UBERMAX_REWARD_BOOST_ATK = 22;
export const UBERMAX_REWARD_BOOST_DEF = 18;
export const UBERMAX_REWARD_BOOST_SPD = 14;

export function ubermaxStats(card) {
  if (!card) return { hp: 0, atk: 0, def: 0, spd: 0 };
  return {
    hp: Math.round((card.hp || 0) * UBERMAX_HP_MULT) + UBERMAX_HP_BONUS,
    atk: Math.round((card.atk || 0) * UBERMAX_ATK_MULT) + 40,
    def: Math.round((card.def || 0) * UBERMAX_DEF_MULT) + 30,
    spd: Math.max(20, Math.round((card.spd || 0) * 0.6)),
  };
}

// Stat block applied as boosts onto the captured UberMax copy so the trophy
// actually feels gigantic in the collection. Capped by clampBoost downstream.
export const UBERMAX_REWARD_BOOSTS = Object.freeze({
  hp: UBERMAX_REWARD_BOOST_HP,
  atk: UBERMAX_REWARD_BOOST_ATK,
  def: UBERMAX_REWARD_BOOST_DEF,
  spd: UBERMAX_REWARD_BOOST_SPD,
});

// Damage one contributor's Fokemon deals to the boss. Type advantage matters
// — a Water Fokemon vs a Fire UberMax actually closes the HP bar fast. Boosts
// from training carry over (incentive to bring your trained heavyweights).
export function ubermaxDamageFor(contributorCard, contributorBoosts, ubermaxCard, evoStage = 0) {
  if (!contributorCard || !ubermaxCard) return 0;
  const stats = effectiveStats(contributorCard, { boosts: contributorBoosts || EMPTY_BOOSTS, defenses: 0, evoStage });
  const mult = typeMultiplier(contributorCard.type, ubermaxCard.type);
  // Soft bonus per stat point of training: each +1 boost adds a little extra
  // pop on top of the linear stats so a fully-trained Fokemon really shines.
  const trained =
    (contributorBoosts?.hp || 0) +
    (contributorBoosts?.atk || 0) +
    (contributorBoosts?.def || 0) +
    (contributorBoosts?.spd || 0);
  const base = stats.atk * UBERMAX_DAMAGE_MULT * mult;
  return Math.max(1, Math.round(base + trained * 0.5));
}

// Roll up the live raid state from the contributor list. Returns a snapshot
// callers can render directly: HP gauge, defeat flag, total army stats.
export function computeRaidState(ubermaxCard, contributors, cardLookup) {
  const stats = ubermaxStats(ubermaxCard);
  const get = typeof cardLookup === "function"
    ? cardLookup
    : (id) => (cardLookup && typeof cardLookup.get === "function" ? cardLookup.get(id) : undefined);
  let damage = 0;
  let armyAtk = 0;
  let armyHp = 0;
  let valid = 0;
  for (const c of contributors || []) {
    const card = get(c?.cardId);
    if (!card) continue;
    valid += 1;
    damage += ubermaxDamageFor(card, c.boosts, ubermaxCard, c.evoStage);
    const eff = effectiveStats(card, { boosts: c.boosts || EMPTY_BOOSTS, defenses: 0, evoStage: c.evoStage });
    armyAtk += eff.atk;
    armyHp += eff.hp;
  }
  const maxHp = stats.hp;
  const remainingHp = Math.max(0, maxHp - damage);
  return {
    maxHp,
    remainingHp,
    damage,
    defeated: damage >= maxHp,
    armyAtk,
    armyHp,
    armySize: valid,
    bossStats: stats,
  };
}

export function isRaidExpired(raid, now = Date.now(), intervalMs = UBERMAX_INTERVAL_MS) {
  if (!raid) return true;
  const ends = Number(raid.expiresAt) || (Number(raid.bucket) || 0) * intervalMs + intervalMs;
  return now >= ends;
}

// Deterministic placements: every peer at the same lat/lng/time sees the same
// UberMax cast. Sparser than gyms (UBERMAX_MACRO_SIZE × MACRO_SIZE), and only
// a slice of macros host a boss in any given bucket (UBERMAX_SPAWN_RATE).
// `epicCards` is the species pool — typically the rare/epic cards.
export function computeUberMaxPlacements(
  lat,
  lon,
  epicCards,
  {
    timeMs = Date.now(),
    cellSizeDegrees = SPAWN_CELL_DEGREES,
    neighborhoodCells = UBERMAX_NEIGHBORHOOD_CELLS,
    macroSize = UBERMAX_MACRO_SIZE,
    intervalMs = UBERMAX_INTERVAL_MS,
    spawnRate = UBERMAX_SPAWN_RATE,
  } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!Array.isArray(epicCards) || !epicCards.length) return [];
  const placements = [];
  const seen = new Set();
  const latBaseCell = Math.floor((lat + 90) / cellSizeDegrees);
  const lonBaseCell = Math.floor((lon + 180) / cellSizeDegrees);
  const bucket = Math.floor(timeMs / intervalMs);

  const scan = neighborhoodCells + macroSize;
  for (let dlat = -scan; dlat <= scan; dlat++) {
    for (let dlon = -scan; dlon <= scan; dlon++) {
      const latCell = latBaseCell + dlat;
      const lonCell = lonBaseCell + dlon;
      const macroLat = Math.floor(latCell / macroSize);
      const macroLon = Math.floor(lonCell / macroSize);
      const macroKey = `${macroLat}:${macroLon}`;
      if (seen.has(macroKey)) continue;
      seen.add(macroKey);

      // Per-bucket roll: does this macro host a raid this 30 min?
      const roll = hashToUnitInterval(`um-spawn|${macroKey}|${bucket}`);
      if (roll >= spawnRate) continue;

      // Pick a cell inside the macro for the actual spawn point.
      const slotCount = macroSize * macroSize;
      const slot = Math.floor(hashToUnitInterval(`um-slot|${macroKey}|${bucket}`) * slotCount);
      const slotLat = Math.floor(slot / macroSize);
      const slotLon = slot % macroSize;
      const chosenLatCell = macroLat * macroSize + slotLat;
      const chosenLonCell = macroLon * macroSize + slotLon;

      if (
        Math.abs(chosenLatCell - latBaseCell) > neighborhoodCells ||
        Math.abs(chosenLonCell - lonBaseCell) > neighborhoodCells
      ) continue;

      const latBase = chosenLatCell * cellSizeDegrees - 90;
      const lonBase = chosenLonCell * cellSizeDegrees - 180;
      if (isInOceanExclusion(latBase + cellSizeDegrees / 2, lonBase + cellSizeDegrees / 2)) continue;

      const cellKey = `${chosenLatCell}:${chosenLonCell}`;
      const cardIdx = Math.floor(hashToUnitInterval(`um-card|${macroKey}|${bucket}`) * epicCards.length);
      const card = epicCards[Math.min(cardIdx, epicCards.length - 1)];
      const startsAt = bucket * intervalMs;
      placements.push({
        id: `um|${cellKey}|${bucket}`,
        grid: cellKey,
        macro: macroKey,
        bucket,
        cardId: card.id,
        lat: latBase + hashToUnitInterval(`um-lat|${macroKey}|${bucket}`) * cellSizeDegrees,
        lng: lonBase + hashToUnitInterval(`um-lng|${macroKey}|${bucket}`) * cellSizeDegrees,
        startsAt,
        expiresAt: startsAt + intervalMs,
      });
    }
  }
  return placements;
}

export function totalBoostCapRemaining(boosts) {
  const stats = ["hp", "atk", "def", "spd"];
  let remaining = 0;
  for (const s of stats) {
    remaining += Math.max(0, MAX_TRAINING_BOOST_PER_STAT - (boosts?.[s] || 0));
  }
  return remaining;
}

export function effectiveStats(card, champion) {
  if (!card) return { hp: 0, atk: 0, def: 0, spd: 0 };
  const boosts = champion?.boosts || { hp: 0, atk: 0, def: 0, spd: 0 };
  const defenses = champion?.defenses || 0;
  const fatigue = Math.min(0.45, defenses * 0.09);
  const mult = evoStatMult(champion?.evoStage);
  const apply = (base, boost, fatigueMul) =>
    Math.max(1, Math.round((base + (boost || 0)) * mult * (1 - fatigue * fatigueMul)));
  return {
    hp: apply(card.hp ?? 0, boosts.hp, 0.5),
    atk: apply(card.atk ?? 0, boosts.atk, 1),
    def: apply(card.def ?? 0, boosts.def, 1),
    spd: apply(card.spd ?? 0, boosts.spd, 0.8),
  };
}

export function computeGymRestGain({ boosts, restAccruedAt, placedAt, now }, intervalMs = GYM_REST_HP_INTERVAL_MS) {
  // Pure: how many HP-boost slices a champion has accrued since the last
  // credit. Time always advances (even when capped), so capped tenure doesn't
  // bank slices for later. 0 is a valid timestamp, so prefer Number.isFinite
  // over truthiness when picking the start point.
  const restValid = Number.isFinite(restAccruedAt) && restAccruedAt > 0;
  const placedValid = Number.isFinite(placedAt) && placedAt >= 0;
  const start = restValid ? Number(restAccruedAt) : (placedValid ? Number(placedAt) : (Number(now) || 0));
  const t = Number(now) || 0;
  const interval = Math.max(1, Number(intervalMs) || 1);
  const elapsed = Math.max(0, t - start);
  const slicesAvailable = Math.floor(elapsed / interval);
  const currentHp = Math.max(0, Number(boosts?.hp) || 0);
  const headroom = Math.max(0, MAX_TRAINING_BOOST_PER_STAT - currentHp);
  const gain = Math.min(slicesAvailable, headroom);
  const nextAccruedAt = start + slicesAvailable * interval;
  return { gain, nextAccruedAt };
}

export function isChampionRetired(champion, now = Date.now()) {
  if (!champion) return true;
  if ((champion.defenses || 0) >= MAX_CHAMPION_DEFENSES) return true;
  if (champion.placedAt && now - champion.placedAt > CHAMPION_TTL_MS) return true;
  return false;
}

export const TYPE_MATCHUPS = {
  Fire:     { Leaf: 1.5, Ice: 1.5, Bug: 1.5, Metal: 1.4, Water: 0.7, Rock: 0.7 },
  Water:    { Fire: 1.5, Rock: 1.5, Leaf: 0.7, Electric: 0.7 },
  Leaf:     { Water: 1.5, Rock: 1.5, Fire: 0.7, Ice: 0.7, Bug: 0.7, Wind: 0.7 },
  Electric: { Water: 1.5, Wind: 1.5, Metal: 1.4, Rock: 0.6, Leaf: 0.7 },
  Ice:      { Leaf: 1.5, Wind: 1.5, Rock: 1.2, Fire: 0.6 },
  Wind:     { Bug: 1.5, Leaf: 1.5, Fire: 1.2, Electric: 0.7, Ice: 0.7 },
  Rock:     { Fire: 1.5, Bug: 1.5, Wind: 1.5, Electric: 1.4, Leaf: 0.7, Water: 0.7 },
  Shadow:   { Spirit: 1.5, Cosmic: 1.5, Bug: 1.2, Metal: 0.7 },
  Spirit:   { Shadow: 1.5, Cosmic: 1.4, Metal: 0.7 },
  Cosmic:   { Shadow: 1.5, Spirit: 1.4, Metal: 0.7 },
  Bug:      { Leaf: 1.5, Shadow: 1.5, Spirit: 1.2, Fire: 0.6, Rock: 0.6, Wind: 0.6 },
  Metal:    { Rock: 1.5, Ice: 1.5, Bug: 1.2, Fire: 0.6, Electric: 0.6 },
};

export function typeMultiplier(attackerType, defenderType) {
  return TYPE_MATCHUPS[attackerType]?.[defenderType] ?? 1;
}

export function seedFromStrings(...parts) {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function makeSeededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function simulateBattle({ attacker, defender, seed = 1, maxTurns = 24 }) {
  if (!attacker?.stats || !defender?.stats) {
    return { winner: null, log: [], finalHpAttacker: 0, finalHpDefender: 0 };
  }
  const rand = makeSeededRandom(seed);
  const a = { side: "attacker", card: attacker.card, stats: attacker.stats, hp: attacker.stats.hp, energy: 0 };
  const d = { side: "defender", card: defender.card, stats: defender.stats, hp: defender.stats.hp, energy: 0 };
  const log = [];

  let round = 0;
  while (a.hp > 0 && d.hp > 0 && round < maxTurns) {
    round += 1;
    const order = a.stats.spd >= d.stats.spd ? [a, d] : [d, a];
    if (a.stats.spd === d.stats.spd && rand() < 0.5) order.reverse();

    for (const atk of order) {
      const def = atk === a ? d : a;
      if (atk.hp <= 0 || def.hp <= 0) continue;

      const useSkill = atk.energy >= 3 || (atk.energy >= 1 && rand() < 0.22);
      const mul = typeMultiplier(atk.card.type, def.card.type);
      const dodgeRoll = rand();
      const spdRatio = def.stats.spd / Math.max(1, atk.stats.spd + def.stats.spd);
      const dodgeChance = useSkill ? 0.04 : 0.06 + spdRatio * 0.08;
      const dodged = dodgeRoll < dodgeChance;

      if (dodged) {
        log.push({
          round,
          attacker: atk.side,
          defender: def.side,
          attackerType: atk.card.type,
          defenderType: def.card.type,
          move: useSkill ? "skill" : "attack",
          dodged: true,
          damage: 0,
          defenderHp: def.hp,
          defenderMaxHp: def.stats.hp,
        });
        if (!useSkill) atk.energy = Math.min(4, atk.energy + 1);
        continue;
      }

      const variance = 0.85 + rand() * 0.3;
      const crit = rand() < 0.12;
      const critMul = crit ? 1.55 : 1;
      const skillMul = useSkill ? 1.7 : 1;
      const base = Math.max(1, atk.stats.atk - def.stats.def / 2);
      const dmg = Math.max(1, Math.round(base * variance * mul * critMul * skillMul));
      def.hp = Math.max(0, def.hp - dmg);

      if (useSkill) atk.energy = 0;
      else atk.energy = Math.min(4, atk.energy + 1);

      log.push({
        round,
        attacker: atk.side,
        defender: def.side,
        attackerType: atk.card.type,
        defenderType: def.card.type,
        move: useSkill ? "skill" : "attack",
        dodged: false,
        crit,
        effective: mul > 1 ? "super" : mul < 1 ? "weak" : "normal",
        damage: dmg,
        defenderHp: def.hp,
        defenderMaxHp: def.stats.hp,
      });

      if (def.hp <= 0) break;
    }
  }

  let winner;
  if (a.hp <= 0 && d.hp <= 0) winner = "defender";
  else if (a.hp <= 0) winner = "defender";
  else if (d.hp <= 0) winner = "attacker";
  else winner = a.hp / a.stats.hp >= d.hp / d.stats.hp ? "attacker" : "defender";

  return { winner, log, finalHpAttacker: a.hp, finalHpDefender: d.hp };
}
