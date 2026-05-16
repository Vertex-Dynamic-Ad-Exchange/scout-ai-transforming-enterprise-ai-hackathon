import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageCapture } from "@scout/shared";

// PRP-C2 T2a: factory.ts no longer imports browserMode/agentMode directly —
// it delegates to capture.ts. The existing factory.test.ts continues to mock
// the two mode drivers as a regression guard; this file mocks capture.ts
// instead so the delegation contract (factory → capture(sdk, cfg, url, opts))
// is pinned independently. Separate file because vi.mock is hoisted file-wide
// and the two mock setups would collide.
const mocks = vi.hoisted(() => ({
  capturePage: vi.fn(),
}));

vi.mock("../capture.js", () => ({
  capturePage: mocks.capturePage,
}));

import { createHarness } from "../factory.js";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
  mocks.capturePage.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createHarness() — T2a delegates to capture.ts", () => {
  it("forwards (sdk, cfg, url, opts) verbatim to capture.capturePage", async () => {
    mocks.capturePage.mockResolvedValue({} as PageCapture);

    await createHarness().capturePage("https://example.test/x", { geo: "DE" });

    expect(mocks.capturePage).toHaveBeenCalledTimes(1);
    const args = mocks.capturePage.mock.calls[0];
    // sdk: the BrowserUse instance (truthy; no need to introspect — capture.ts
    //      receives it opaquely and the SDK constructor was already pinned in
    //      factory.test.ts).
    expect(args?.[0]).toBeDefined();
    // cfg: HarnessConfig — apiKey is the single-source contract.
    expect(args?.[1]).toMatchObject({ browserUseApiKey: "test-key" });
    // url, opts: identity passthrough (no rewrites at the factory layer).
    expect(args?.[2]).toBe("https://example.test/x");
    expect(args?.[3]).toEqual({ geo: "DE" });
  });

  it("passes opts=undefined through when the caller omits the argument", async () => {
    mocks.capturePage.mockResolvedValue({} as PageCapture);

    await createHarness().capturePage("https://example.test/y");

    expect(mocks.capturePage).toHaveBeenCalledTimes(1);
    // capture.ts defaults rawOpts to {} when undefined; the factory must NOT
    // rewrite it (any default substitution belongs in one place).
    expect(mocks.capturePage.mock.calls[0]?.[3]).toBeUndefined();
  });
});
