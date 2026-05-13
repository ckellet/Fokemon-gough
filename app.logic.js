export const SPAWN_CELL_DEGREES = 0.001;
export const POI_COOLDOWN_MS = 5 * 60 * 1000;
export const BATTLE_SITE_NEIGHBORHOOD_CELLS = 2;
export const BATTLE_SITE_DENSITY = 0.16;
export const MAX_TRAINING_BOOST_PER_STAT = 28;
export const MAX_CHAMPION_DEFENSES = 5;
export const CHAMPION_TTL_MS = 24 * 60 * 60 * 1000;

export function computeCollectionStats(caught) {
  const uniqueIds = [...new Set((caught || []).map((c) => c.id))];
  return {
    total: (caught || []).length,
    unique: uniqueIds.length,
    uniqueIds,
  };
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
      const cellKey = `${latCell}:${lonCell}`;
      const density = hashToUnitInterval(`poi-density|${cellKey}`);
      let count;
      if (density < 0.32) count = 0;
      else if (density < 0.74) count = 1;
      else if (density < 0.94) count = 2;
      else count = 3;

      const latBase = latCell * cellSizeDegrees - 90;
      const lonBase = lonCell * cellSizeDegrees - 180;
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
    density = BATTLE_SITE_DENSITY,
  } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const placements = [];
  const latBaseCell = Math.floor((lat + 90) / cellSizeDegrees);
  const lonBaseCell = Math.floor((lon + 180) / cellSizeDegrees);

  for (let dlat = -neighborhoodCells; dlat <= neighborhoodCells; dlat++) {
    for (let dlon = -neighborhoodCells; dlon <= neighborhoodCells; dlon++) {
      const latCell = latBaseCell + dlat;
      const lonCell = lonBaseCell + dlon;
      const cellKey = `${latCell}:${lonCell}`;
      const roll = hashToUnitInterval(`battle-site|${cellKey}`);
      if (roll >= density) continue;
      const latBase = latCell * cellSizeDegrees - 90;
      const lonBase = lonCell * cellSizeDegrees - 180;
      placements.push({
        id: `bs|${cellKey}`,
        grid: cellKey,
        lat: latBase + hashToUnitInterval(`bs|${cellKey}|lat`) * cellSizeDegrees,
        lng: lonBase + hashToUnitInterval(`bs|${cellKey}|lng`) * cellSizeDegrees,
      });
    }
  }
  return placements;
}

const SITE_ADJECTIVES = [
  "Crystal", "Ember", "Glacial", "Hollow", "Solar", "Twilight",
  "Verdant", "Storm", "Iron", "Wild", "Aurora", "Mossy",
  "Sunken", "Cinder", "Quiet", "Howling", "Lumen", "Drift",
];
const SITE_NOUNS = [
  "Spire", "Falls", "Arena", "Grove", "Bastion", "Hollow",
  "Court", "Keep", "Cradle", "Forge", "Glade", "Reach",
  "Ring", "Pyre", "Den", "Hall", "Steppe", "Crag",
];

export function battleSiteName(siteId) {
  const adj = SITE_ADJECTIVES[Math.floor(hashToUnitInterval(`name|adj|${siteId}`) * SITE_ADJECTIVES.length)];
  const noun = SITE_NOUNS[Math.floor(hashToUnitInterval(`name|noun|${siteId}`) * SITE_NOUNS.length)];
  return `${adj} ${noun}`;
}

export function clampBoost(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_TRAINING_BOOST_PER_STAT, Math.round(value)));
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
  const apply = (base, boost, fatigueMul) =>
    Math.max(1, Math.round((base + (boost || 0)) * (1 - fatigue * fatigueMul)));
  return {
    hp: apply(card.hp ?? 0, boosts.hp, 0.5),
    atk: apply(card.atk ?? 0, boosts.atk, 1),
    def: apply(card.def ?? 0, boosts.def, 1),
    spd: apply(card.spd ?? 0, boosts.spd, 0.8),
  };
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
