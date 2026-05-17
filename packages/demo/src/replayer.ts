import { setTimeout as delay } from "node:timers/promises";
import { Agent, request } from "undici";
import { VerificationVerdictSchema } from "@scout/shared";
import type { BidVerificationRequest, VerificationVerdict } from "@scout/shared";
import type { Scenario } from "./types.js";
import { ReplayerError } from "./errors.js";

export interface BidResult {
  request: BidVerificationRequest;
  verdict: VerificationVerdict;
  /** Wall-clock from immediately-before request() to receipt. PRP-B D6. */
  latencyMs: number;
  /** ISO-8601 captured immediately before the request fires. */
  sentAt: string;
  /** ISO-8601 captured immediately after the response is parsed. */
  receivedAt: string;
}

export interface RunScenarioOptions {
  /** Base URL of the gate, e.g. http://127.0.0.1:54321. No trailing slash. */
  gateUrl: string;
  signal?: AbortSignal;
}

/** Drive `POST ${gateUrl}/verify` for every bid in the scenario, honoring
 *  per-bid `delayMs` (measured from scenario start; PRP-A D5). One shared
 *  undici Agent across the whole scenario for keep-alive (PRP-B D1 +
 *  feature gotcha 194). On non-2xx: throws `ReplayerError` with the parsed
 *  response body in `.detail` (caller decides whether to log — PRP-B
 *  § Security guardrails: replayer never logs response bodies itself). */
export async function runScenario(
  scenario: Scenario,
  opts: RunScenarioOptions,
): Promise<BidResult[]> {
  const agent = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 60_000 });
  const scenarioStart = Date.now();
  const results: BidResult[] = [];
  const verifyUrl = `${opts.gateUrl}/verify`;
  try {
    for (let i = 0; i < scenario.bids.length; i++) {
      const bid = scenario.bids[i]!;
      const elapsed = Date.now() - scenarioStart;
      const wait = bid.delayMs - elapsed;
      if (wait > 0) {
        await delay(wait, undefined, opts.signal ? { signal: opts.signal } : undefined);
      }
      // PRP-B D2: stamp fresh `ts` per request (recorded `ts` may be days stale;
      // dashboard verdict timeline checks `ts` age). --preserve-recorded-ts is
      // TODO(follow-up). bid.request was deep-parsed at loadScenario time so
      // we treat it as BidVerificationRequest here.
      const stampedRequest: BidVerificationRequest = {
        ...(bid.request as BidVerificationRequest),
        ts: new Date().toISOString(),
      };
      const sentAt = new Date().toISOString();
      const start = Date.now();
      const res = await request(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(stampedRequest),
        dispatcher: agent,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const latencyMs = Date.now() - start;
      const receivedAt = new Date().toISOString();
      const bodyText = await res.body.text();
      let bodyParsed: unknown;
      try {
        bodyParsed = JSON.parse(bodyText);
      } catch {
        bodyParsed = bodyText;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new ReplayerError(
          `gate responded ${res.statusCode} for bid index ${i}`,
          res.statusCode,
          bodyParsed,
          i,
        );
      }
      const verdict = VerificationVerdictSchema.parse(bodyParsed);
      results.push({ request: stampedRequest, verdict, latencyMs, sentAt, receivedAt });
    }
    return results;
  } finally {
    await agent.close();
  }
}
