import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PageProfileSchema, PolicySchema, type PageProfile, type Policy } from "@scout/shared";
import type { ProfileStore, PolicyStore } from "@scout/store";
import type { Scenario } from "./types.js";

export interface SeederStores {
  profileStore: ProfileStore;
  policyStore: PolicyStore;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO_PKG_ROOT = path.resolve(HERE, "..");
const REPO_PACKAGES = path.resolve(DEMO_PKG_ROOT, "..");
const PROFILE_FIXTURE_DIR = path.join(DEMO_PKG_ROOT, "fixtures", "pages");
// PRP-B D8: policy fixtures are sourced from packages/policy/fixtures/, never
// copied into @scout/demo, so policy edits remain a single seam.
const POLICY_FIXTURE_DIR = path.join(REPO_PACKAGES, "policy", "fixtures");

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Seeds the `ProfileStore` from `packages/demo/fixtures/pages/<name>.profile.json`
 *  for each fixture name in `scenario.seeds.profiles`. PolicyStore has no `put`
 *  API (PRP-B D11) — policies are seeded via `createStores({ initialPolicies })`
 *  upstream of this call. Use `seedPolicies()` to build that array. */
export async function seedScenario(scenario: Scenario, stores: SeederStores): Promise<void> {
  for (const name of scenario.seeds.profiles) {
    const raw = await readJson(path.join(PROFILE_FIXTURE_DIR, `${name}.profile.json`));
    const profile: PageProfile = PageProfileSchema.parse(raw);
    await stores.profileStore.put(profile);
  }
  // PolicyStore is intentionally read here so SeederStores stays a faithful
  // interface to the store seam (PRPs C–E may call `policyStore.get` after
  // seeding to verify tenant scoping). No-op on this side — policies arrive
  // via `createStores({ initialPolicies })`.
  void stores.policyStore;
}

/** Reads `packages/policy/fixtures/<id>.json` for each policy ID in
 *  `scenario.seeds.policies` and returns parsed `Policy[]` ready to thread
 *  into `createStores({ initialPolicies })` (PRP-B D8, D11). */
export async function seedPolicies(scenario: Scenario): Promise<Policy[]> {
  const out: Policy[] = [];
  for (const id of scenario.seeds.policies) {
    const raw = await readJson(path.join(POLICY_FIXTURE_DIR, `${id}.json`));
    out.push(PolicySchema.parse(raw));
  }
  return out;
}
