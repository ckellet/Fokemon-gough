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
