import { randomUUID } from "node:crypto";
import type { LlmClient } from "@scout/llm-client";
import { LlmChatError } from "@scout/llm-client";
import type { PageProfile, Policy, Decision, Reason } from "@scout/shared";

const ESCALATION_MODEL = "gemini-2.5-flash"; // pinned — never use -latest
const FLASH_TIMEOUT_MS = 400;
const FLASH_MAX_TOKENS = 32; // only need {"decision":"ALLOW"} or {"decision":"DENY"}

export interface EscalationResult {
  decision: Decision;
  lobstertrapTraceId: string;
  reasons: Reason[];
}

export async function escalateToFlash(
  llmClient: LlmClient,
  profile: PageProfile,
  policy: Policy,
  handlerAbort?: AbortSignal,
): Promise<EscalationResult> {
  // Structured JSON — never interpolate profile text. Prompt-injection defense.
  const profileSignals = {
    categories: profile.categories.map((c) => ({ label: c.label, confidence: c.confidence })),
    detectedEntities: profile.detectedEntities.map((e) => ({ name: e.name, type: e.type })),
  };
  const policyContext = {
    rules: policy.rules.map((r) => ({ kind: r.kind, match: r.match, action: r.action })),
  };

  const abortSignals: AbortSignal[] = [AbortSignal.timeout(FLASH_TIMEOUT_MS)];
  if (handlerAbort !== undefined) {
    abortSignals.push(handlerAbort);
  }

  let result: Awaited<ReturnType<LlmClient["chat"]>>;
  try {
    result = await llmClient.chat(
      {
        model: ESCALATION_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a brand-safety classifier. Given the page profile signals and policy rules, " +
              "determine if this page clears brand-safety criteria. " +
              'Reply with ONLY valid JSON: {"decision":"ALLOW"} or {"decision":"DENY"}. No other text.',
          },
          { role: "user", content: JSON.stringify({ profileSignals, policyContext }) },
        ],
        response_format: { type: "json_object" },
        max_tokens: FLASH_MAX_TOKENS,
        signal: AbortSignal.any(abortSignals),
      },
      {
        declared_intent: "brand-safety-flash-escalation",
        agent_id: "gate",
        declared_paths: ["profile.categories", "profile.detectedEntities", "policy.rules"],
      },
    );
  } catch (err: unknown) {
    const lobstertrapTraceId =
      err instanceof LlmChatError ? err.lobstertrapTraceId : randomUUID();
    const isAbort = err instanceof Error && err.name === "AbortError";
    const isTimeout =
      isAbort ||
      (err instanceof LlmChatError &&
        err.cause instanceof Error &&
        err.cause.name === "AbortError");
    return {
      decision: "DENY",
      lobstertrapTraceId,
      reasons: [
        {
          kind: "fail_closed",
          ref: isTimeout ? "flash_timeout" : "lobstertrap_unavailable",
          detail: err instanceof Error ? err.message : "Unknown Flash error",
        },
      ],
    };
  }

  // Lobster Trap DPI verdict takes precedence — may detect prompt-injection independently
  if (result.verdict === "DENY" || result.verdict === "QUARANTINE") {
    return {
      decision: "DENY",
      lobstertrapTraceId: result.lobstertrapTraceId ?? randomUUID(),
      reasons: [
        {
          kind: "fail_closed",
          ref: "lobstertrap_denied",
          detail: `Lobster Trap DPI verdict: ${result.verdict}`,
        },
      ],
    };
  }

  // Parse model response — any failure keeps fail-closed DENY
  let modelDecision: Decision = "DENY";
  try {
    const parsed: unknown = JSON.parse(result.content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "decision" in parsed &&
      (parsed as Record<string, unknown>)["decision"] === "ALLOW"
    ) {
      modelDecision = "ALLOW";
    }
  } catch {
    /* Malformed JSON → keep fail-closed DENY */
  }

  return {
    decision: modelDecision,
    lobstertrapTraceId: result.lobstertrapTraceId ?? randomUUID(),
    reasons: [
      {
        kind: "profile_signal",
        ref: "flash_escalation",
        detail: `Gemini Flash classified: ${modelDecision} (lobstertrap: ${result.verdict})`,
      },
    ],
  };
}
