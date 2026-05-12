export const SPAWN_CELL_DEGREES = 0.001;
export const POI_COOLDOWN_MS = 5 * 60 * 1000;

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
