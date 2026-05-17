import { describe, expect, it } from "vitest";
import * as demo from "@scout/demo";

describe("@scout/demo barrel", () => {
  it("exports loadScenario", () => {
    expect(typeof (demo as { loadScenario?: unknown }).loadScenario).toBe("function");
  });
});
