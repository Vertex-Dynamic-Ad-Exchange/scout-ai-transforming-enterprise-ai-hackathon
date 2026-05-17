import { randomUUID } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ProfileStore, PolicyStore, AuditStore, ProfileQueue } from "@scout/store";
import type { LlmClient } from "@scout/llm-client";
import type { PolicyMatcher } from "@scout/policy";
import type { PageProfile, BidVerificationRequest, VerificationVerdict } from "@scout/shared";
import { BidVerificationRequestSchema } from "@scout/shared";
import { escalateToFlash } from "./escalate.js";
import { assembleVerdict, buildReasonsFromMatch, failClosedVerdict } from "./verdict.js";

export interface GateDeps {
  profileStore: ProfileStore;
  policyStore: PolicyStore;
  auditStore: AuditStore;
  profileQueue: ProfileQueue;
  llmClient: LlmClient;
  policyMatcher: PolicyMatcher;
}

function isTtlExpired(profile: PageProfile): boolean {
  // profile.ttl is SECONDS — multiply by 1000 for ms comparison
  return Date.now() > new Date(profile.capturedAt).getTime() + profile.ttl * 1000;
}

function hasPriorArbiterDisagreement(profile: PageProfile): boolean {
  return profile.evidenceRefs.some((ref) => ref.kind === "dom_snippet");
}

function requestAbortSignal(req: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  req.raw.once("close", () => controller.abort());
  return controller.signal;
}

export function createHandler(deps: GateDeps) {
  return async function handler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const start = Date.now();
    let verdict: VerificationVerdict | undefined;
    try {
      const parsed = BidVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        await reply.code(400).send({ error: parsed.error.flatten() });
        return;
      }
      const body: BidVerificationRequest = parsed.data;
      const profile = await deps.profileStore.get(body.pageUrl);

      if (profile === null || isTtlExpired(profile)) {
        setImmediate(() => {
          void deps.profileQueue
            .enqueue({
              url: body.pageUrl,
              advertiserId: body.advertiserId,
              policyId: body.policyId,
              requestedAt: new Date().toISOString(),
            })
            .catch((e: unknown) => {
              console.error("[gate] profile_queue_enqueue_failed", e);
            });
        });
        verdict = failClosedVerdict("cache_miss", Date.now() - start);
        await reply.send(verdict);
        return;
      }

      if (hasPriorArbiterDisagreement(profile)) {
        verdict = assembleVerdict({
          decision: "HUMAN_REVIEW",
          reasons: [
            {
              kind: "arbiter_disagreement",
              ref: "prior_arbiter_review",
              detail: "Profile carries prior arbiter disagreement evidence (dom_snippet)",
            },
          ],
          profileId: profile.id,
          policyVersion: "",
          latencyMs: Date.now() - start,
          lobstertrapTraceId: null,
        });
        await reply.send(verdict);
        return;
      }

      // MUST be tenant-scoped — never PolicyStore.get(policyId) without advertiserId
      const policy = await deps.policyStore.get(body.policyId, body.advertiserId);
      if (policy === null) {
        // DENY (not 404) to prevent policy-ID enumeration by adversaries
        verdict = failClosedVerdict("tenant_mismatch", Date.now() - start, profile.id, "");
        await reply.send(verdict);
        return;
      }

      const matchResult = deps.policyMatcher.match(profile, policy);
      const isAmbiguous = matchResult.confidence < policy.escalation.humanReviewThreshold;

      if (!isAmbiguous && matchResult.decision !== "HUMAN_REVIEW") {
        verdict = assembleVerdict({
          decision: matchResult.decision,
          reasons: buildReasonsFromMatch(profile, policy, matchResult),
          profileId: profile.id,
          policyVersion: policy.version,
          latencyMs: Date.now() - start,
          lobstertrapTraceId: null,
        });
        await reply.send(verdict);
        return;
      }

      if (
        policy.escalation.ambiguousAction === "HUMAN_REVIEW" ||
        matchResult.decision === "HUMAN_REVIEW"
      ) {
        verdict = assembleVerdict({
          decision: "HUMAN_REVIEW",
          reasons: [
            ...buildReasonsFromMatch(profile, policy, matchResult),
            {
              kind: "arbiter_disagreement",
              ref: "policy_escalation",
              detail: "Escalation policy set to HUMAN_REVIEW for ambiguous matches",
            },
          ],
          profileId: profile.id,
          policyVersion: policy.version,
          latencyMs: Date.now() - start,
          lobstertrapTraceId: null,
        });
        await reply.send(verdict);
        return;
      }

      const escalation = await escalateToFlash(
        deps.llmClient,
        profile,
        policy,
        requestAbortSignal(req),
      );
      // Escalation reasons first so fail_closed/lobstertrap surfaces at index 0
      verdict = assembleVerdict({
        decision: escalation.decision,
        reasons: [...escalation.reasons, ...buildReasonsFromMatch(profile, policy, matchResult)],
        profileId: profile.id,
        policyVersion: policy.version,
        latencyMs: Date.now() - start,
        lobstertrapTraceId: escalation.lobstertrapTraceId,
      });
      await reply.send(verdict);
    } catch (err: unknown) {
      verdict = failClosedVerdict("handler_exception", Date.now() - start);
      console.error("[gate] handler_exception", err);
      await reply.code(500).send(verdict);
    } finally {
      if (verdict !== undefined) {
        const v = verdict;
        const body = req.body as BidVerificationRequest;
        setImmediate(() => {
          void deps.auditStore
            .put({
              kind: "verdict",
              id: randomUUID(),
              advertiserId: body.advertiserId,
              ts: new Date().toISOString(),
              request: body,
              verdict: v,
              profile: null,
              declaredIntent: null,
              detectedIntent: null,
            })
            .catch((e: unknown) => {
              console.error("[gate] gate_audit_dropped", e);
            });
        });
      }
    }
  };
}
