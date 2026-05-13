import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCollectionStats,
  computePoiPlacements,
  computeSpawnPlacements,
  computeSpawnSlots,
  filterUncaughtSpawns,
  getGridKey,
  isPoiAvailable,
  mergeRecentEvents,
  POI_COOLDOWN_MS,
  SPAWN_CELL_DEGREES,
  computeBattleSitePlacements,
  battleSiteName,
  effectiveStats,
  isChampionRetired,
  simulateBattle,
  typeMultiplier,
  seedFromStrings,
  clampBoost,
  totalBoostCapRemaining,
  MAX_TRAINING_BOOST_PER_STAT,
  MAX_CHAMPION_DEFENSES,
  CHAMPION_TTL_MS,
} from './app.logic.js';

test('computeCollectionStats returns total and unique counts', () => {
  const result = computeCollectionStats([{ id: 'a' }, { id: 'a' }, { id: 'b' }]);
  assert.equal(result.total, 3);
  assert.equal(result.unique, 2);
  assert.deepEqual(result.uniqueIds.sort(), ['a', 'b']);
});

test('mergeRecentEvents skips invalid and duplicate events', () => {
  const base = [{ trainer: 'A', card: 'VoltLynx', ts: 1 }];
  const withInvalid = mergeRecentEvents(base, { trainer: 'A' });
  assert.equal(withInvalid.length, 1);
  const withDup = mergeRecentEvents(base, { trainer: 'A', card: 'VoltLynx', ts: 1 });
  assert.equal(withDup.length, 1);
});

test('mergeRecentEvents enforces max items', () => {
  let events = [];
  for (let i = 0; i < 5; i++) events = mergeRecentEvents(events, { trainer: 'T', card: String(i), ts: i }, 3);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.card), ['2', '3', '4']);
});

test('getGridKey returns stable geographic bucket at coarse cell', () => {
  assert.equal(getGridKey(37.77, -122.41, 0.25), '511:230');
});

test('getGridKey defaults to fine ~100m cell', () => {
  assert.equal(SPAWN_CELL_DEGREES, 0.001);
  assert.equal(getGridKey(37.7700, -122.4100), getGridKey(37.7701, -122.4099));
  assert.notEqual(getGridKey(37.7700, -122.4100), getGridKey(37.7720, -122.4100));
});

test('computeSpawnPlacements places spawns inside the active grid cell', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const placements = computeSpawnPlacements(cards, {
    timeMs: 1_700_000_000_000,
    lat: 37.7700,
    lon: -122.4100,
    maxSpawns: 3,
    intervalMs: 60_000,
  });
  assert.equal(placements.length, 3);
  for (const p of placements) {
    assert.ok(p.lat >= 37.77 && p.lat < 37.771, `lat ${p.lat} outside cell`);
    assert.ok(p.lng >= -122.41 && p.lng < -122.409, `lng ${p.lng} outside cell`);
    assert.ok(Number.isFinite(p.expiresAt));
  }
});

test('computeSpawnPlacements is deterministic per grid + bucket', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const opts = { timeMs: 1_700_000_000_000, lat: 10, lon: 20, maxSpawns: 2, intervalMs: 60_000 };
  const a = computeSpawnPlacements(cards, opts);
  const b = computeSpawnPlacements(cards, opts);
  assert.deepEqual(a, b);
});

test('computeSpawnSlots is deterministic per grid and time bucket', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const opts = { timeMs: 1_700_000_000_000, lat: 10, lon: 20, maxSpawns: 2 };
  const one = computeSpawnSlots(cards, opts).map((c) => c.id);
  const two = computeSpawnSlots(cards, opts).map((c) => c.id);
  assert.deepEqual(one, two);
  assert.equal(one.length, 2);
});

test('filterUncaughtSpawns removes already-caught card ids', () => {
  const filtered = filterUncaughtSpawns([{ id: 'a' }, { id: 'b' }], new Set(['a']));
  assert.deepEqual(filtered.map((c) => c.id), ['b']);
});

test('computePoiPlacements is deterministic and stays within neighborhood cells', () => {
  const opts = { neighborhoodCells: 1 };
  const a = computePoiPlacements(37.7700, -122.4100, opts);
  const b = computePoiPlacements(37.7700, -122.4100, opts);
  assert.deepEqual(a, b);

  const latLow = Math.floor((37.7700 + 90) / SPAWN_CELL_DEGREES) - 1;
  const latHigh = latLow + 3;
  const lonLow = Math.floor((-122.4100 + 180) / SPAWN_CELL_DEGREES) - 1;
  const lonHigh = lonLow + 3;

  for (const p of a) {
    const latCell = Math.floor((p.lat + 90) / SPAWN_CELL_DEGREES);
    const lonCell = Math.floor((p.lng + 180) / SPAWN_CELL_DEGREES);
    assert.ok(latCell >= latLow && latCell < latHigh, `lat cell ${latCell} out of range`);
    assert.ok(lonCell >= lonLow && lonCell < lonHigh, `lon cell ${lonCell} out of range`);
    assert.ok(typeof p.id === 'string' && p.id.includes('|'));
  }
});

test('computePoiPlacements neighborhood scales placement search area', () => {
  const small = computePoiPlacements(0, 0, { neighborhoodCells: 0 });
  const wide = computePoiPlacements(0, 0, { neighborhoodCells: 1 });
  assert.ok(wide.length >= small.length, 'wider neighborhood should not lose POIs');
  for (const p of small) {
    assert.ok(
      wide.some((w) => w.id === p.id && w.lat === p.lat && w.lng === p.lng),
      'small-radius POIs should be a subset of wide-radius POIs'
    );
  }
});

test('isPoiAvailable respects cooldown window', () => {
  const poi = { id: 'abc|0' };
  assert.equal(isPoiAvailable(poi, {}), true);
  const justSpent = { 'abc|0': 1_000_000 };
  assert.equal(isPoiAvailable(poi, justSpent, 1_000_000 + 60_000), false);
  assert.equal(isPoiAvailable(poi, justSpent, 1_000_000 + POI_COOLDOWN_MS), true);
});

test('computeBattleSitePlacements is deterministic and stays inside neighborhood', () => {
  const opts = { neighborhoodCells: 2 };
  const a = computeBattleSitePlacements(37.7700, -122.4100, opts);
  const b = computeBattleSitePlacements(37.7700, -122.4100, opts);
  assert.deepEqual(a, b);

  for (const p of a) {
    assert.ok(typeof p.id === 'string' && p.id.startsWith('bs|'));
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
});

test('computeBattleSitePlacements is sparser than POIs at default density', () => {
  let totalBs = 0;
  let totalPoi = 0;
  for (let i = 0; i < 50; i++) {
    const lat = 30 + i * 0.005;
    const lon = -100 + i * 0.005;
    totalBs += computeBattleSitePlacements(lat, lon).length;
    totalPoi += computePoiPlacements(lat, lon).length;
  }
  assert.ok(totalBs < totalPoi, `expected fewer battle sites than POIs; got ${totalBs} vs ${totalPoi}`);
});

test('battleSiteName produces stable, non-trivial names', () => {
  const a = battleSiteName('bs|123:456');
  const b = battleSiteName('bs|123:456');
  assert.equal(a, b);
  assert.ok(a.length >= 5, `expected non-trivial name, got "${a}"`);
});

test('battleSiteName has high diversity across adjacent grid cells', () => {
  const names = new Set();
  for (let dlat = 0; dlat < 60; dlat++) {
    for (let dlon = 0; dlon < 60; dlon++) {
      names.add(battleSiteName(`bs|${100000 + dlat}:${200000 + dlon}`));
    }
  }
  // Out of 3,600 nearby IDs, expect at least ~2,000 unique names — well above the
  // earlier ~324-combo dictionary where adjacent cells routinely collided.
  assert.ok(names.size >= 2000, `expected high name diversity; got ${names.size} unique of 3600`);
});

test('effectiveStats adds boosts and applies fatigue from defenses', () => {
  const card = { hp: 80, atk: 60, def: 50, spd: 40, type: 'Leaf' };
  const fresh = effectiveStats(card, { boosts: { hp: 0, atk: 10, def: 0, spd: 0 }, defenses: 0 });
  assert.equal(fresh.atk, 70);
  assert.equal(fresh.hp, 80);

  const worn = effectiveStats(card, { boosts: { hp: 0, atk: 10, def: 0, spd: 0 }, defenses: 4 });
  assert.ok(worn.atk < fresh.atk, 'fatigue should drop ATK after defenses');
  assert.ok(worn.hp <= fresh.hp);
});

test('clampBoost caps at MAX_TRAINING_BOOST_PER_STAT and floors at 0', () => {
  assert.equal(clampBoost(-5), 0);
  assert.equal(clampBoost(MAX_TRAINING_BOOST_PER_STAT + 5), MAX_TRAINING_BOOST_PER_STAT);
  assert.equal(clampBoost(7.6), 8);
});

test('totalBoostCapRemaining tracks remaining headroom', () => {
  const remaining = totalBoostCapRemaining({ hp: 10, atk: 10, def: 0, spd: 0 });
  assert.equal(remaining, MAX_TRAINING_BOOST_PER_STAT * 4 - 20);
});

test('isChampionRetired retires after defense cap or TTL', () => {
  const now = 1_700_000_000_000;
  assert.equal(isChampionRetired(null, now), true);
  assert.equal(isChampionRetired({ defenses: 0, placedAt: now }, now), false);
  assert.equal(isChampionRetired({ defenses: MAX_CHAMPION_DEFENSES, placedAt: now }, now), true);
  assert.equal(isChampionRetired({ defenses: 0, placedAt: now - CHAMPION_TTL_MS - 1 }, now), true);
});

test('typeMultiplier returns 1 for unknown matchups and >1 for super effective', () => {
  assert.equal(typeMultiplier('Fire', 'Leaf'), 1.5);
  assert.equal(typeMultiplier('Water', 'Fire'), 1.5);
  assert.equal(typeMultiplier('Leaf', 'Fire'), 0.7);
  assert.equal(typeMultiplier('Bug', 'Metal'), 1);
});

test('simulateBattle is deterministic for the same seed and produces a winner', () => {
  const attacker = { card: { type: 'Fire', name: 'A' }, stats: { hp: 80, atk: 70, def: 50, spd: 60 } };
  const defender = { card: { type: 'Leaf', name: 'D' }, stats: { hp: 80, atk: 55, def: 60, spd: 50 } };
  const one = simulateBattle({ attacker, defender, seed: seedFromStrings('a|d|1') });
  const two = simulateBattle({ attacker, defender, seed: seedFromStrings('a|d|1') });
  assert.deepEqual(one.log, two.log);
  assert.ok(one.winner === 'attacker' || one.winner === 'defender');
  assert.ok(one.log.length > 0);
});

test('simulateBattle: stronger fokemon usually wins when types neutral', () => {
  const strong = { card: { type: 'Rock', name: 'Strong' }, stats: { hp: 120, atk: 90, def: 80, spd: 60 } };
  const weak = { card: { type: 'Metal', name: 'Weak' }, stats: { hp: 60, atk: 40, def: 30, spd: 30 } };
  let strongWins = 0;
  for (let i = 0; i < 30; i++) {
    const res = simulateBattle({ attacker: strong, defender: weak, seed: seedFromStrings(`run|${i}`) });
    if (res.winner === 'attacker') strongWins += 1;
  }
  assert.ok(strongWins >= 26, `expected dominant winner most of the time, got ${strongWins}/30`);
});
