import { describe, it, expect } from "vitest";
import type { Logger } from "./logger.js";

describe("Logger", () => {
  it("satisfies a console-shaped impl", () => {
    const impl = {
      info: (o: Record<string, unknown>) => void o,
      warn: (o: Record<string, unknown>) => void o,
      error: (o: Record<string, unknown>) => void o,
    } satisfies Logger;
    impl.info({ event: "x" });
    expect(typeof impl.info).toBe("function");
  });

  it("console can satisfy Logger via wrapper", () => {
    const calls: { level: string; fields: Record<string, unknown> }[] = [];
    const impl: Logger = {
      info: (f) => calls.push({ level: "info", fields: f }),
      warn: (f) => calls.push({ level: "warn", fields: f }),
      error: (f) => calls.push({ level: "error", fields: f }),
    };
    impl.warn({ event: "lobstertrap_trace_missing", verifier: "text" });
    expect(calls).toEqual([
      { level: "warn", fields: { event: "lobstertrap_trace_missing", verifier: "text" } },
    ]);
  });
});
