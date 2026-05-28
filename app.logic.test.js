import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCollectionStats,
  COLLECTION_SORTS,
  groupCollection,
  flattenCollectionGroups,
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
  isInOceanExclusion,
  siteTheme,
  SITE_THEMES,
  makeInstanceUid,
  migrateCaughtEntries,
  availableInstances,
  deployedInstanceAtSite,
  mergeBoosts,
  normalizeBoosts,
  computeGymRestGain,
  GYM_REST_HP_INTERVAL_MS,
  serializeTradeOffer,
  parseTradeOffer,
  mergeTrainerLocation,
  TRADE_DISCOVERY_TTL_MS,
  PRESENCE_TTL_MS,
  computeUberMaxPlacements,
  ubermaxStats,
  ubermaxDamageFor,
  computeRaidState,
  isRaidExpired,
  UBERMAX_INTERVAL_MS,
  UBERMAX_HP_MULT,
  UBERMAX_HP_BONUS,
  UBERMAX_REWARD_BOOSTS,
  FOOD_PER_CATCH,
  EVO_MAX_STAGE,
  EVO_FOOD_COSTS,
  EVO_STAT_MULT,
  TYPE_FOOD,
  foodForType,
  clampEvoStage,
  evoStatMult,
  evoCostFor,
  evoDisplayName,
  normalizeFoodBag,
  evolutionState,
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

test('presence windows: trade discovery is tighter than the map window', () => {
  assert.equal(TRADE_DISCOVERY_TTL_MS, 15 * 60 * 1000);
  assert.equal(PRESENCE_TTL_MS, 30 * 60 * 1000);
  assert.ok(TRADE_DISCOVERY_TTL_MS < PRESENCE_TTL_MS);
});

test('trade offer survives the GUN wire as a JSON string round-trip', () => {
  const offer = { uid: 'VoltLynx#abc', cardId: 'VoltLynx', boosts: { hp: 3, atk: 2, def: 0, spd: 1 }, caughtAt: 1700 };
  const wire = serializeTradeOffer(offer);
  assert.equal(typeof wire, 'string');
  // What the *receiving* peer gets from tradesNode.map().on() is this string.
  const decoded = parseTradeOffer(wire);
  assert.deepEqual(decoded, {
    uid: 'VoltLynx#abc',
    cardId: 'VoltLynx',
    boosts: { hp: 3, atk: 2, def: 0, spd: 1 },
    caughtAt: 1700,
    evoStage: 0,
  });
});

test('trade offer carries evolution tier across the wire', () => {
  const wire = serializeTradeOffer({ uid: 'u9', cardId: 'Sparkit', boosts: {}, caughtAt: 9, evoStage: 2 });
  assert.equal(parseTradeOffer(wire).evoStage, 2);
  // clamps junk / over-cap values
  assert.equal(serializeTradeOffer({ uid: 'u9', cardId: 'Sparkit', evoStage: 99 }), JSON.stringify({ uid: 'u9', cardId: 'Sparkit', boosts: { hp: 0, atk: 0, def: 0, spd: 0 }, caughtAt: 0, evoStage: EVO_MAX_STAGE }));
});

test('parseTradeOffer rejects an unresolved GUN link node (the original bug)', () => {
  // GUN .map().on() hands nested objects over as link references, never data.
  assert.equal(parseTradeOffer({ '#': 'fokemon/trades/trade-1/offer' }), null);
  assert.equal(parseTradeOffer({ '#': 'soul', _: { '#': 'soul' } }), null);
});

test('parseTradeOffer accepts a plain object (local echo / legacy record)', () => {
  const decoded = parseTradeOffer({ uid: 'u1', cardId: 'AquaPup', boosts: { hp: 1 }, caughtAt: 5 });
  assert.equal(decoded.uid, 'u1');
  assert.equal(decoded.cardId, 'AquaPup');
  assert.deepEqual(decoded.boosts, { hp: 1, atk: 0, def: 0, spd: 0 });
});

test('trade offer serialization is null-safe on junk input', () => {
  assert.equal(serializeTradeOffer(null), null);
  assert.equal(serializeTradeOffer({ cardId: 'X' }), null); // no uid
  assert.equal(parseTradeOffer(null), null);
  assert.equal(parseTradeOffer('not json{'), null);
  assert.equal(parseTradeOffer('{"cardId":"X"}'), null); // no uid
});

test('mergeTrainerLocation accepts a fresh signal when nothing is stored', () => {
  const now = 1_700_000_000_000;
  const merged = mergeTrainerLocation(undefined, { lat: 1, lng: 2, ts: now - 1000 }, now);
  assert.deepEqual(merged, { lat: 1, lng: 2, ts: now - 1000 });
});

test('mergeTrainerLocation keeps the newer timestamp (heartbeat not clobbered by late catch)', () => {
  const now = 1_700_000_000_000;
  const fresh = { lat: 1, lng: 2, ts: now - 1000 };
  // A late-arriving older catch event must not overwrite a fresher heartbeat.
  const kept = mergeTrainerLocation(fresh, { lat: 9, lng: 9, ts: now - 60_000 }, now);
  assert.equal(kept, fresh, 'should return the existing entry by reference, unchanged');
  // A newer signal does replace it.
  const updated = mergeTrainerLocation(fresh, { lat: 5, lng: 6, ts: now - 10 }, now);
  assert.deepEqual(updated, { lat: 5, lng: 6, ts: now - 10 });
});

test('mergeTrainerLocation drops signals older than the TTL', () => {
  const now = 1_700_000_000_000;
  const stale = mergeTrainerLocation(undefined, { lat: 1, lng: 2, ts: now - PRESENCE_TTL_MS - 1 }, now);
  assert.equal(stale, null, 'too old to ever display -> not stored');
  const existing = { lat: 1, lng: 2, ts: now - 1000 };
  // A stale incoming signal leaves an existing entry untouched (no deletion).
  assert.equal(
    mergeTrainerLocation(existing, { lat: 7, lng: 8, ts: now - PRESENCE_TTL_MS - 1 }, now),
    existing
  );
});

test('mergeTrainerLocation rejects non-finite coordinates without losing prior data', () => {
  const now = 1_700_000_000_000;
  const existing = { lat: 1, lng: 2, ts: now - 1000 };
  assert.equal(mergeTrainerLocation(existing, null, now), existing);
  assert.equal(mergeTrainerLocation(existing, { lat: 'x', lng: 2, ts: now }, now), existing);
  assert.equal(mergeTrainerLocation(undefined, { lat: 1, lng: 2, ts: NaN }, now), null);
  // A catch event with null coords must not land the trainer at 0,0.
  assert.equal(mergeTrainerLocation(undefined, { lat: null, lng: null, ts: now }, now), null);
  assert.equal(mergeTrainerLocation(existing, { lat: null, lng: null, ts: now }, now), existing);
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

test('isInOceanExclusion flags mid-ocean points and leaves land alone', () => {
  // Mid-ocean points — should be excluded
  assert.equal(isInOceanExclusion(0, -25), true, 'mid Equatorial Atlantic');
  assert.equal(isInOceanExclusion(30, -140), true, 'mid North Pacific');
  assert.equal(isInOceanExclusion(-35, -100), true, 'mid South Pacific');
  assert.equal(isInOceanExclusion(-35, -15), true, 'mid South Atlantic');
  assert.equal(isInOceanExclusion(-15, 80), true, 'mid Central Indian Ocean');
  assert.equal(isInOceanExclusion(88, 30), true, 'High Arctic');

  // Major populated cities — should NOT be excluded
  assert.equal(isInOceanExclusion(51.5074, -0.1278), false, 'London');
  assert.equal(isInOceanExclusion(40.7589, -73.9851), false, 'NYC');
  assert.equal(isInOceanExclusion(35.6762, 139.6503), false, 'Tokyo');
  assert.equal(isInOceanExclusion(37.7749, -122.4194), false, 'San Francisco');
  assert.equal(isInOceanExclusion(-33.8688, 151.2093), false, 'Sydney');
  assert.equal(isInOceanExclusion(21.3099, -157.8581), false, 'Honolulu');
  assert.equal(isInOceanExclusion(64.1466, -21.9426), false, 'Reykjavik');
  assert.equal(isInOceanExclusion(37.7412, -25.6756), false, 'Ponta Delgada (Azores)');
});

test('computePoiPlacements skips ocean exclusion zones', () => {
  // Smack in the middle of the South Pacific
  const ocean = computePoiPlacements(-35, -110, { neighborhoodCells: 2 });
  assert.equal(ocean.length, 0, 'expected no POIs in mid South Pacific');
});

test('computeBattleSitePlacements skips ocean exclusion zones', () => {
  // Mid North Pacific
  const ocean = computeBattleSitePlacements(35, -140, { neighborhoodCells: 5 });
  assert.equal(ocean.length, 0, 'expected no battle sites in mid North Pacific');
});

test('computeBattleSitePlacements distributes gyms evenly via macro cells', () => {
  // Step across many cells in a non-ocean area; with 3×3 macros and 1 gym
  // each, a 9×9 cell window should produce close to 9 gyms (much tighter than
  // the old Poisson rolls allowed).
  const counts = [];
  for (let i = 0; i < 30; i++) {
    const lat = 30 + i * 0.05;
    const lon = -100 + i * 0.05;
    counts.push(computeBattleSitePlacements(lat, lon, { neighborhoodCells: 4 }).length);
  }
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  assert.ok(min >= 4, `expected every 9×9 window to have ≥4 gyms; got min ${min}`);
  assert.ok(max <= 16, `expected every 9×9 window to have ≤16 gyms; got max ${max}`);
});

test('siteTheme is deterministic and returns a known theme', () => {
  const a = siteTheme('bs|12345:67890');
  const b = siteTheme('bs|12345:67890');
  assert.deepEqual(a, b);
  assert.ok(typeof a.tag === 'string' && a.tag.length > 0);
  assert.ok(typeof a.color === 'string' && a.color.startsWith('#'));
  assert.ok(typeof a.glyph === 'string' && a.glyph.length > 0);
  assert.ok(SITE_THEMES.some((t) => t.tag === a.tag));
});

test('siteTheme covers many distinct themes across nearby ids', () => {
  const tags = new Set();
  for (let i = 0; i < 200; i++) {
    tags.add(siteTheme(`bs|1000:${10000 + i}`).tag);
  }
  assert.ok(tags.size >= 8, `expected diverse themes across IDs; got ${tags.size}`);
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

test('makeInstanceUid produces unique tokens per call', () => {
  const a = makeInstanceUid('voltlynx', 100);
  const b = makeInstanceUid('voltlynx', 100);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('voltlynx-100-'));
});

test('migrateCaughtEntries fills uid/boosts/deployedAt and preserves new fields', () => {
  const legacy = [{ id: 'sparkit', ts: 1 }, { id: 'mossaur', ts: 2 }];
  const migrated = migrateCaughtEntries(legacy);
  for (const entry of migrated) {
    assert.ok(typeof entry.uid === 'string' && entry.uid.length > 4);
    assert.deepEqual(entry.boosts, { hp: 0, atk: 0, def: 0, spd: 0 });
    assert.equal(entry.deployedAt, null);
  }
  // Running again is idempotent (preserves existing uid).
  const again = migrateCaughtEntries(migrated);
  assert.deepEqual(again.map((e) => e.uid), migrated.map((e) => e.uid));
});

test('migrateCaughtEntries normalizes deployedAt and boosts', () => {
  const out = migrateCaughtEntries([
    { id: 'sparkit', ts: 1, uid: 'u1', deployedAt: 'bs|123:456', boosts: { hp: -3, atk: 999, def: 5.4 } },
  ]);
  assert.equal(out[0].deployedAt, 'bs|123:456');
  assert.equal(out[0].boosts.hp, 0);
  assert.equal(out[0].boosts.atk, MAX_TRAINING_BOOST_PER_STAT);
  assert.equal(out[0].boosts.def, 5);
});

test('availableInstances excludes deployed Fokemon', () => {
  const caught = migrateCaughtEntries([
    { id: 'sparkit', ts: 1, deployedAt: 'bs|1:1' },
    { id: 'sparkit', ts: 2 },
    { id: 'mossaur', ts: 3, deployedAt: 'bs|2:2' },
  ]);
  const free = availableInstances(caught);
  assert.equal(free.length, 1);
  assert.equal(free[0].id, 'sparkit');
});

test('deployedInstanceAtSite locates the instance pinned to a gym', () => {
  const caught = migrateCaughtEntries([
    { id: 'sparkit', ts: 1, deployedAt: 'bs|1:1' },
    { id: 'mossaur', ts: 2 },
  ]);
  const found = deployedInstanceAtSite(caught, 'bs|1:1');
  assert.ok(found && found.id === 'sparkit');
  assert.equal(deployedInstanceAtSite(caught, 'nope'), null);
});

test('mergeBoosts adds and clamps within stat cap', () => {
  const merged = mergeBoosts({ hp: 10, atk: 5, def: 0, spd: 0 }, { hp: 100, atk: 5 });
  assert.equal(merged.hp, MAX_TRAINING_BOOST_PER_STAT);
  assert.equal(merged.atk, 10);
  assert.equal(merged.def, 0);
});

test('normalizeBoosts coerces invalid input to zero', () => {
  assert.deepEqual(normalizeBoosts(null), { hp: 0, atk: 0, def: 0, spd: 0 });
  assert.deepEqual(normalizeBoosts({ hp: 'x', atk: -5, def: 3, spd: 1.6 }), { hp: 0, atk: 0, def: 3, spd: 2 });
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

// --- collection sorting + grouping -----------------------------------------

const COLL_CARDS = {
  volt: { id: 'volt', name: 'VoltLynx', type: 'Electric', rarity: 'rare', hp: 58, atk: 72, def: 44, spd: 88 }, // base 262
  moss: { id: 'moss', name: 'Mossaur', type: 'Leaf', rarity: 'common', hp: 84, atk: 56, def: 70, spd: 38 }, // base 248
  vulp: { id: 'vulp', name: 'Vulpyre', type: 'Fire', rarity: 'epic', hp: 62, atk: 92, def: 50, spd: 86 }, // base 290
};
const collLookup = (id) => COLL_CARDS[id];
const collCaught = () => [
  { id: 'volt', uid: 'v1', ts: 1000, boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
  { id: 'volt', uid: 'v2', ts: 3000, boosts: { hp: 10, atk: 0, def: 0, spd: 0 } }, // strongest volt: power 272, hp 68
  { id: 'volt', uid: 'v3', ts: 2000, boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
  { id: 'moss', uid: 'm1', ts: 5000, boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
  { id: 'vulp', uid: 'p1', ts: 4000, boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
];
const groupIds = (groups) => groups.map((g) => g.id);

test('COLLECTION_SORTS exposes the expected sort keys', () => {
  assert.deepEqual(
    COLLECTION_SORTS.map((s) => s.key),
    ['recent', 'oldest', 'power', 'hp', 'name', 'type', 'rarity']
  );
  for (const s of COLLECTION_SORTS) assert.ok(typeof s.label === 'string' && s.label.length);
});

test('groupCollection clusters duplicates with the strongest as representative', () => {
  const groups = groupCollection(collCaught(), collLookup, 'name');
  const volt = groups.find((g) => g.id === 'volt');
  assert.equal(volt.count, 3);
  assert.equal(volt.representative.uid, 'v2'); // boosted = strongest
  // members ordered strongest-first, ties broken by newest ts
  assert.deepEqual(volt.members.map((m) => m.uid), ['v2', 'v3', 'v1']);
  assert.equal(volt.newestTs, 3000);
  assert.equal(volt.oldestTs, 1000);
});

test('groupCollection sorts by power, hp, recent, oldest, name and rarity', () => {
  const cc = collCaught();
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'power')), ['vulp', 'volt', 'moss']);
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'hp')), ['moss', 'volt', 'vulp']);
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'recent')), ['moss', 'vulp', 'volt']);
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'oldest')), ['volt', 'vulp', 'moss']);
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'name')), ['moss', 'volt', 'vulp']);
  assert.deepEqual(groupIds(groupCollection(cc, collLookup, 'rarity')), ['vulp', 'volt', 'moss']);
});

test('groupCollection accepts a Map lookup and tolerates unknown cards', () => {
  const map = new Map(Object.entries(COLL_CARDS));
  const groups = groupCollection(
    [...collCaught(), { id: 'ghost', uid: 'g1', ts: 9000, boosts: {} }],
    map,
    'recent'
  );
  assert.equal(groups.length, 4);
  const ghost = groups.find((g) => g.id === 'ghost');
  assert.equal(ghost.card, null);
  assert.equal(ghost.count, 1);
});

test('flattenCollectionGroups yields a rep-first linear sequence', () => {
  const groups = groupCollection(collCaught(), collLookup, 'name');
  const flat = flattenCollectionGroups(groups);
  assert.deepEqual(flat.map((f) => f.entry.uid), ['m1', 'v2', 'v3', 'v1', 'p1']);
  const v3 = flat.find((f) => f.entry.uid === 'v3');
  assert.equal(v3.isRepresentative, false);
  assert.equal(v3.indexInGroup, 1);
  assert.equal(v3.groupCount, 3);
  assert.equal(flat.find((f) => f.entry.uid === 'v2').isRepresentative, true);
});

test('groupCollection handles empty input', () => {
  assert.deepEqual(groupCollection([], collLookup, 'recent'), []);
  assert.deepEqual(flattenCollectionGroups([]), []);
});

test('computeGymRestGain awards one HP per interval', () => {
  const placedAt = 0;
  const now = placedAt + GYM_REST_HP_INTERVAL_MS * 3 + 500;
  const out = computeGymRestGain({ boosts: { hp: 0 }, placedAt, restAccruedAt: 0, now });
  assert.equal(out.gain, 3);
  assert.equal(out.nextAccruedAt, placedAt + GYM_REST_HP_INTERVAL_MS * 3);
});

test('computeGymRestGain returns zero before the first interval elapses', () => {
  const placedAt = 0;
  const now = GYM_REST_HP_INTERVAL_MS - 1;
  const out = computeGymRestGain({ boosts: { hp: 0 }, placedAt, restAccruedAt: 0, now });
  assert.equal(out.gain, 0);
  assert.equal(out.nextAccruedAt, placedAt);
});

test('computeGymRestGain caps gain at the boost ceiling', () => {
  const placedAt = 0;
  const now = GYM_REST_HP_INTERVAL_MS * 100;
  const out = computeGymRestGain({ boosts: { hp: MAX_TRAINING_BOOST_PER_STAT - 2 }, placedAt, restAccruedAt: 0, now });
  assert.equal(out.gain, 2);
  // Time still advances even when capped, so capped tenure doesn't bank slices.
  assert.equal(out.nextAccruedAt, GYM_REST_HP_INTERVAL_MS * 100);
});

test('computeGymRestGain resumes from prior restAccruedAt', () => {
  const placedAt = 0;
  const restAccruedAt = GYM_REST_HP_INTERVAL_MS * 2;
  const now = restAccruedAt + GYM_REST_HP_INTERVAL_MS + 5;
  const out = computeGymRestGain({ boosts: { hp: 5 }, placedAt, restAccruedAt, now });
  assert.equal(out.gain, 1);
  assert.equal(out.nextAccruedAt, restAccruedAt + GYM_REST_HP_INTERVAL_MS);
});

// --- UberMax raid bosses ----------------------------------------------------

const UM_BOSS_CARD = { id: 'thundake', name: 'Thundake', type: 'Electric', rarity: 'epic',
  hp: 68, atk: 90, def: 52, spd: 92 };
const UM_POOL = [
  UM_BOSS_CARD,
  { id: 'vulpyre', name: 'Vulpyre', type: 'Fire', rarity: 'epic', hp: 62, atk: 92, def: 50, spd: 86 },
  { id: 'boscarapod', name: 'Boscarapod', type: 'Leaf', rarity: 'epic', hp: 92, atk: 78, def: 88, spd: 32 },
];
const UM_LOOKUP = new Map(UM_POOL.map((c) => [c.id, c]));

test('ubermaxStats inflates HP/ATK so the boss is a real challenge', () => {
  const stats = ubermaxStats(UM_BOSS_CARD);
  // Hard floor: HP grows by mult + bonus → way bigger than the base card.
  const expectedHp = Math.round(UM_BOSS_CARD.hp * UBERMAX_HP_MULT) + UBERMAX_HP_BONUS;
  assert.equal(stats.hp, expectedHp);
  assert.ok(stats.hp > UM_BOSS_CARD.hp * 3, 'UberMax HP should be at least 3× base');
  assert.ok(stats.atk > UM_BOSS_CARD.atk, 'UberMax ATK should be higher than base');
  // SPD drops because it's a giant.
  assert.ok(stats.spd <= UM_BOSS_CARD.spd, 'UberMax SPD should not exceed base');
});

test('ubermaxDamageFor rewards type advantage and training boosts', () => {
  const water = { id: 'aq', name: 'AquaPup', type: 'Water', hp: 60, atk: 70, def: 50, spd: 55 };
  const fireBoss = { id: 'fb', name: 'FireBoss', type: 'Fire', hp: 80, atk: 80, def: 60, spd: 60 };
  const neutralBoss = { id: 'nb', name: 'GhostBoss', type: 'Shadow', hp: 80, atk: 80, def: 60, spd: 60 };
  const noBoost = { hp: 0, atk: 0, def: 0, spd: 0 };
  const trained = { hp: 10, atk: 20, def: 5, spd: 5 };

  const superDmg = ubermaxDamageFor(water, noBoost, fireBoss);
  const neutralDmg = ubermaxDamageFor(water, noBoost, neutralBoss);
  assert.ok(superDmg > neutralDmg, `super-effective should beat neutral; ${superDmg} > ${neutralDmg}`);

  const trainedDmg = ubermaxDamageFor(water, trained, fireBoss);
  assert.ok(trainedDmg > superDmg, `trained should out-hit untrained; ${trainedDmg} > ${superDmg}`);
});

test('computeRaidState aggregates contributors and flags defeat', () => {
  const contributors = [
    { trainer: 'A', cardId: 'thundake', boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
    { trainer: 'B', cardId: 'thundake', boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
  ];
  const state = computeRaidState(UM_BOSS_CARD, contributors, UM_LOOKUP);
  assert.equal(state.maxHp, ubermaxStats(UM_BOSS_CARD).hp);
  assert.equal(state.armySize, 2);
  assert.ok(state.damage > 0);
  assert.ok(state.remainingHp >= 0);
  assert.equal(state.defeated, state.damage >= state.maxHp);
});

test('computeRaidState marks defeated when army out-damages HP', () => {
  // Stack lots of strong contributors so damage clearly exceeds HP.
  const contributors = Array.from({ length: 10 }, (_, i) => ({
    trainer: `T${i}`,
    cardId: 'vulpyre', // Fire vs Electric is neutral here, but raw atk = 92
    boosts: { hp: 28, atk: 28, def: 0, spd: 0 },
  }));
  const state = computeRaidState(UM_BOSS_CARD, contributors, UM_LOOKUP);
  assert.equal(state.defeated, true);
  assert.equal(state.remainingHp, 0);
});

test('computeRaidState ignores unknown cardIds without crashing', () => {
  const contributors = [
    { trainer: 'A', cardId: 'ghost-card', boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
    { trainer: 'B', cardId: 'thundake', boosts: { hp: 0, atk: 0, def: 0, spd: 0 } },
  ];
  const state = computeRaidState(UM_BOSS_CARD, contributors, UM_LOOKUP);
  assert.equal(state.armySize, 1, 'ghost card is dropped, real one counted');
  assert.ok(state.damage > 0);
});

test('computeUberMaxPlacements is deterministic per location + time bucket', () => {
  const opts = { timeMs: 1_700_000_000_000, neighborhoodCells: 6, macroSize: 7 };
  const a = computeUberMaxPlacements(51.5074, -0.1278, UM_POOL, opts);
  const b = computeUberMaxPlacements(51.5074, -0.1278, UM_POOL, opts);
  assert.deepEqual(a, b);
  for (const p of a) {
    assert.ok(typeof p.id === 'string' && p.id.startsWith('um|'));
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng));
    assert.ok(UM_LOOKUP.has(p.cardId), `placement should pick from the pool: ${p.cardId}`);
    assert.equal(p.expiresAt - p.startsAt, UBERMAX_INTERVAL_MS);
  }
});

test('computeUberMaxPlacements respects ocean exclusion', () => {
  // Mid North Pacific
  const ocean = computeUberMaxPlacements(35, -140, UM_POOL, { neighborhoodCells: 10 });
  assert.equal(ocean.length, 0);
});

test('computeUberMaxPlacements rolls differently across time buckets', () => {
  const opts = { neighborhoodCells: 6 };
  const bucketA = computeUberMaxPlacements(51.5074, -0.1278, UM_POOL, {
    ...opts, timeMs: 1_700_000_000_000,
  });
  const bucketB = computeUberMaxPlacements(51.5074, -0.1278, UM_POOL, {
    ...opts, timeMs: 1_700_000_000_000 + UBERMAX_INTERVAL_MS * 10,
  });
  // Across 10 buckets the lineup almost certainly shifts (different IDs).
  const idsA = bucketA.map((p) => p.id).sort().join(',');
  const idsB = bucketB.map((p) => p.id).sort().join(',');
  assert.notEqual(idsA, idsB, 'placements should evolve across buckets');
});

test('computeUberMaxPlacements stays sparser than battle sites', () => {
  let totalUm = 0;
  let totalBs = 0;
  for (let i = 0; i < 20; i++) {
    const lat = 51 + i * 0.02;
    const lon = -0.1 + i * 0.02;
    totalUm += computeUberMaxPlacements(lat, lon, UM_POOL).length;
    totalBs += computeBattleSitePlacements(lat, lon).length;
  }
  assert.ok(totalUm < totalBs, `UberMax should be sparser than gyms; got ${totalUm} vs ${totalBs}`);
});

test('isRaidExpired flips at the bucket boundary', () => {
  const placements = computeUberMaxPlacements(51.5074, -0.1278, UM_POOL, {
    timeMs: 1_700_000_000_000,
    neighborhoodCells: 6,
  });
  // If by chance the neighborhood has no spawn at this bucket, retry with a different seed.
  const raid = placements[0] || { expiresAt: 1_700_000_000_000 + UBERMAX_INTERVAL_MS };
  assert.equal(isRaidExpired(raid, raid.expiresAt - 1), false);
  assert.equal(isRaidExpired(raid, raid.expiresAt), true);
  assert.equal(isRaidExpired(raid, raid.expiresAt + 1), true);
});

test('UBERMAX_REWARD_BOOSTS provides meaningful trophy buffs', () => {
  assert.ok(UBERMAX_REWARD_BOOSTS.hp > 10);
  assert.ok(UBERMAX_REWARD_BOOSTS.atk > 10);
});

test('migrateCaughtEntries preserves ubermax + raidId + raidParked flags', () => {
  const out = migrateCaughtEntries([
    { id: 'thundake', ts: 1, uid: 'u1', ubermax: true, raidId: 'um|1:1|123' },
    { id: 'vulpyre', ts: 2, uid: 'u2', raidParked: 'um|2:2|123' },
  ]);
  assert.equal(out[0].ubermax, true);
  assert.equal(out[0].raidId, 'um|1:1|123');
  assert.equal(out[1].raidParked, 'um|2:2|123');
  // Idempotent round trip.
  const round = migrateCaughtEntries(out);
  assert.equal(round[0].ubermax, true);
  assert.equal(round[1].raidParked, 'um|2:2|123');
});

// ---------------------------------------------------------------------------
// Evolution + type-food
// ---------------------------------------------------------------------------

test('clampEvoStage floors, rounds down and caps at EVO_MAX_STAGE', () => {
  assert.equal(clampEvoStage(undefined), 0);
  assert.equal(clampEvoStage(-3), 0);
  assert.equal(clampEvoStage(1.9), 1);
  assert.equal(clampEvoStage(99), EVO_MAX_STAGE);
});

test('evoStatMult matches the EVO_STAT_MULT table and grows per tier', () => {
  assert.equal(evoStatMult(0), EVO_STAT_MULT[0]);
  assert.equal(evoStatMult(1), EVO_STAT_MULT[1]);
  assert.equal(evoStatMult(2), EVO_STAT_MULT[2]);
  assert.ok(evoStatMult(2) > evoStatMult(1) && evoStatMult(1) > evoStatMult(0));
});

test('evoCostFor returns climb cost per stage and null when maxed', () => {
  assert.equal(evoCostFor(0), EVO_FOOD_COSTS[0]);
  assert.equal(evoCostFor(1), EVO_FOOD_COSTS[1]);
  assert.equal(evoCostFor(EVO_MAX_STAGE), null);
});

test('evoDisplayName prefixes Super / Mega and leaves base names untouched', () => {
  assert.equal(evoDisplayName('Sparkit', 0), 'Sparkit');
  assert.equal(evoDisplayName('Sparkit', 1), 'Super Sparkit');
  assert.equal(evoDisplayName('Sparkit', 2), 'Mega Sparkit');
});

test('every type has a food definition with a name + emoji', () => {
  const types = ['Electric', 'Leaf', 'Water', 'Fire', 'Shadow', 'Ice', 'Wind', 'Rock', 'Cosmic', 'Spirit', 'Bug', 'Metal'];
  for (const t of types) {
    assert.ok(TYPE_FOOD[t], `missing food for ${t}`);
    assert.ok(TYPE_FOOD[t].name && TYPE_FOOD[t].emoji);
  }
  // Unknown type still yields a usable fallback.
  assert.ok(foodForType('Mystery').name);
});

test('normalizeFoodBag drops zero/negative/unknown keys and floors counts', () => {
  const bag = normalizeFoodBag({ Electric: 12.6, Leaf: 0, Fire: -3, Bogus: 50, Water: '7' });
  assert.deepEqual(bag, { Electric: 12, Water: 7 });
});

test('effectiveStats multiplies base+boost by the evolution tier', () => {
  const card = { hp: 80, atk: 60, def: 50, spd: 40, type: 'Leaf' };
  const base = effectiveStats(card, { boosts: { hp: 0, atk: 10, def: 0, spd: 0 }, defenses: 0, evoStage: 0 });
  const mega = effectiveStats(card, { boosts: { hp: 0, atk: 10, def: 0, spd: 0 }, defenses: 0, evoStage: 2 });
  assert.equal(base.atk, 70);
  assert.equal(mega.atk, Math.round(70 * EVO_STAT_MULT[2]));
  assert.ok(mega.hp > base.hp);
});

test('ubermaxDamageFor scales up with evolution tier', () => {
  const contributor = { hp: 60, atk: 70, def: 40, spd: 50, type: 'Water' };
  const boss = { hp: 4000, atk: 200, def: 120, spd: 60, type: 'Fire' };
  const base = ubermaxDamageFor(contributor, { hp: 0, atk: 0, def: 0, spd: 0 }, boss, 0);
  const mega = ubermaxDamageFor(contributor, { hp: 0, atk: 0, def: 0, spd: 0 }, boss, 2);
  assert.ok(mega > base, 'an evolved Fokemon should hit a raid boss harder');
});

test('migrateCaughtEntries preserves evoStage only when above base', () => {
  const out = migrateCaughtEntries([
    { id: 'sparkit', ts: 1, uid: 'u1' },
    { id: 'sparkit', ts: 2, uid: 'u2', evoStage: 2 },
    { id: 'sparkit', ts: 3, uid: 'u3', evoStage: 99 },
  ]);
  assert.equal('evoStage' in out[0], false, 'base entry stays byte-identical (no evoStage key)');
  assert.equal(out[1].evoStage, 2);
  assert.equal(out[2].evoStage, EVO_MAX_STAGE);
});

test('evolutionState reports ready / short / deployed / maxed', () => {
  const card = { name: 'Sparkit', type: 'Electric', hp: 40, atk: 40, def: 40, spd: 40 };
  const ready = evolutionState(card, { evoStage: 0 }, { Electric: EVO_FOOD_COSTS[0] });
  assert.equal(ready.ok, true);
  assert.equal(ready.nextStage, 1);
  assert.equal(ready.nextName, 'Super Sparkit');

  const short = evolutionState(card, { evoStage: 0 }, { Electric: EVO_FOOD_COSTS[0] - 1 });
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'short');
  assert.equal(short.shortBy, 1);

  const deployed = evolutionState(card, { evoStage: 0, deployedAt: 'bs|1:1' }, { Electric: 9999 });
  assert.equal(deployed.ok, false);
  assert.equal(deployed.reason, 'deployed');

  const maxed = evolutionState(card, { evoStage: EVO_MAX_STAGE }, { Electric: 9999 });
  assert.equal(maxed.ok, false);
  assert.equal(maxed.reason, 'maxed');
});

test('FOOD_PER_CATCH makes the first evolution reachable in a few catches', () => {
  assert.ok(FOOD_PER_CATCH > 0);
  assert.ok(EVO_FOOD_COSTS[0] / FOOD_PER_CATCH <= 8, 'tier-1 should be a handful of catches, not a slog');
});
