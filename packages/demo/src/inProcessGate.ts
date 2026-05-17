// Test rig — NOT exported from the package barrel. PRP-B feature line 15:
// "no mocks inside the gate" — this rig boots the real Fastify handler from
// @scout/gate + real createStores() + real createPolicyMatcher() and only stubs
// LlmClient (PRP-B scenarios never escalate to Flash; PRP-D mocks at the
// module boundary).
import { createApp } from "@scout/gate";
import type {
  LlmClient,
  LlmChatArgs,
  LlmChatResult,
  LobstertrapDeclaredIntent,
} from "@scout/llm-client";
import { createPolicyMatcher, type PolicyMatcher } from "@scout/policy";
import { createStores } from "@scout/store";
import type { Policy } from "@scout/shared";

export type InProcessStores = ReturnType<typeof createStores>;

export interface InProcessGateHandle {
  /** http://127.0.0.1:<ephemeral> — returned by Fastify listen({ port: 0 }). */
  url: string;
  stores: InProcessStores;
  stop(): Promise<void>;
}

export interface InProcessGateOptions {
  initialPolicies?: Policy[];
  /** Override the production policy matcher (Task 6 needs a throwing matcher
   *  to trigger the handler's outer catch → 500. Default uses the real
   *  matcher per PRP-B D4). */
  policyMatcher?: PolicyMatcher;
}

/** Stub LlmClient per PRP-B D5: throws loudly on chat() — PRP-B scenarios
 *  must never escalate to Flash. A silent stub would mask PRP-D regressions
 *  where a scenario unintentionally hit the escalation path. */
function buildStubLlmClient(): LlmClient {
  return {
    async chat(_args: LlmChatArgs, _intent: LobstertrapDeclaredIntent): Promise<LlmChatResult> {
      throw new Error(
        "stub LlmClient.chat() — PRP-B scenarios never escalate to Flash; PRP-D's mock for Flash",
      );
    },
    async healthcheck() {
      return { ok: true, lobstertrapVersion: "stub" } as const;
    },
  };
}

export async function startInProcessGate(
  opts: InProcessGateOptions = {},
): Promise<InProcessGateHandle> {
  const stores = createStores(
    opts.initialPolicies !== undefined ? { initialPolicies: opts.initialPolicies } : {},
  );
  const app = createApp({
    ...stores,
    llmClient: buildStubLlmClient(),
    policyMatcher: opts.policyMatcher ?? createPolicyMatcher(),
  });
  // 127.0.0.1 only (PRP-B D12 + § Security guardrails). Never bind to all
  // interfaces — test rigs on convention-center LAN are a data-leak class.
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  let stopped = false;
  return {
    url,
    stores,
    async stop() {
      if (stopped) return;
      stopped = true;
      await app.close();
    },
  };
}
