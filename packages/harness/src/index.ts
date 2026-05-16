// Public surface for @scout/harness. Consumers go through createHarness()
// — capturePage is internal. Errors and the Harness interface live in
// @scout/shared (re-exported here as the discovery hint).
export { createHarness } from "./factory.js";
export type { HarnessConfig } from "./config.js";
export { HarnessError, HarnessException } from "@scout/shared";
