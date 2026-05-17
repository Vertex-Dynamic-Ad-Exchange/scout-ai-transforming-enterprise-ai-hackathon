// PRP-C D9: hand-rolled LRU on a Map. Map iterates in insertion order, so
// `set` after `delete` moves the key to the tail; the head is the eviction
// target. ≤40 lines, no dep added.

export interface Lru<K> {
  has(key: K): boolean;
  set(key: K): void;
  size(): number;
}

export function createLru<K>(capacity: number): Lru<K> {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`LRU capacity must be a positive integer; got ${capacity}`);
  }
  const map = new Map<K, true>();
  return {
    has(key) {
      if (!map.has(key)) return false;
      map.delete(key);
      map.set(key, true);
      return true;
    },
    set(key) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= capacity) {
        const head = map.keys().next();
        if (!head.done) map.delete(head.value);
      }
      map.set(key, true);
    },
    size: () => map.size,
  };
}
