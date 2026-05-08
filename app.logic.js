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
