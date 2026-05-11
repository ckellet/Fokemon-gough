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

export function getGridKey(lat, lon, cellSizeDegrees = 0.25) {
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

export function computeSpawnSlots(cards, { timeMs = Date.now(), lat = 0, lon = 0, intervalMs = 5 * 60 * 1000, maxSpawns = 3 } = {}) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const grid = getGridKey(lat, lon) || 'global';
  const bucket = Math.floor(timeMs / intervalMs);

  const weighted = cards
    .map((card) => ({ card, score: hashToUnitInterval(`${grid}|${bucket}|${card.id}`) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(maxSpawns, cards.length));

  return weighted.map((entry) => entry.card);
}

export function filterUncaughtSpawns(spawns, caughtIds) {
  const caughtSet = caughtIds instanceof Set ? caughtIds : new Set(caughtIds || []);
  return (spawns || []).filter((spawn) => !caughtSet.has(spawn.id));
}
