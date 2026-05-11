import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCollectionStats,
  computeSpawnSlots,
  filterUncaughtSpawns,
  getGridKey,
  mergeRecentEvents,
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

test('getGridKey returns stable geographic bucket', () => {
  assert.equal(getGridKey(37.77, -122.41), '511:230');
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
