import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCollectionStats, mergeRecentEvents } from './app.logic.js';

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
