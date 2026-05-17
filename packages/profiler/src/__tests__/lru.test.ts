import { describe, expect, it } from "vitest";
import { createLru } from "../lru.js";

describe("createLru", () => {
  it("inserts and queries", () => {
    const lru = createLru<string>(3);
    lru.set("a");
    lru.set("b");
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(true);
    expect(lru.has("c")).toBe(false);
  });

  it("evicts least-recently-used when capacity is exceeded", () => {
    const lru = createLru<string>(2);
    lru.set("a");
    lru.set("b");
    lru.set("c");
    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
    expect(lru.has("c")).toBe(true);
  });

  it("has() promotes the entry to MRU", () => {
    const lru = createLru<string>(2);
    lru.set("a");
    lru.set("b");
    expect(lru.has("a")).toBe(true); // a now MRU
    lru.set("c");
    expect(lru.has("b")).toBe(false); // b evicted, not a
    expect(lru.has("a")).toBe(true);
    expect(lru.has("c")).toBe(true);
  });

  it("rejects non-positive capacity", () => {
    expect(() => createLru<string>(0)).toThrow(/positive integer/);
    expect(() => createLru<string>(-1)).toThrow(/positive integer/);
    expect(() => createLru<string>(1.5)).toThrow(/positive integer/);
  });
});
