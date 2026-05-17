import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditStore, AuditQueryFilter } from "@scout/store";
import { DecisionSchema } from "@scout/shared";
import { etagFor } from "../etag.js";

// `.strict()` is LOAD-BEARING. A malicious `?advertiserId=B` is rejected
// here (400 bad_query) before ever reaching the handler — see PRP
// anti-patterns. Dropping `.strict()` would let unknown keys through;
// the handler still wouldn't read advertiserId from query (D4) but the
// defense-in-depth would be gone.
const ListQuery = z
  .object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    decision: DecisionSchema.optional(),
    pageUrl: z.string().optional(),
    kind: z.enum(["verdict", "profile_job_dlq"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .strict();

export function registerVerdictRoutes(app: FastifyInstance, auditStore: AuditStore): void {
  app.get("/api/verdicts", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      await reply.code(400).send({ error: "bad_query" });
      return;
    }
    // `advertiserId` derived in preHandler from x-advertiser-id; NEVER
    // from query (D4). The AuditQueryFilter type requires it, so a
    // forgotten pass-through wouldn't type-check.
    // `exactOptionalPropertyTypes: true` forbids spreading
    // `key: undefined` into `key?: T`. Copy only defined fields.
    const filter: AuditQueryFilter = { advertiserId: req.advertiserId! };
    const q = parsed.data;
    if (q.since !== undefined) filter.since = q.since;
    if (q.until !== undefined) filter.until = q.until;
    if (q.decision !== undefined) filter.decision = q.decision;
    if (q.pageUrl !== undefined) filter.pageUrl = q.pageUrl;
    if (q.kind !== undefined) filter.kind = q.kind;
    if (q.limit !== undefined) filter.limit = q.limit;
    if (q.cursor !== undefined) filter.cursor = q.cursor;
    const result = await auditStore.query(filter);
    const body = JSON.stringify(result);
    const etag = etagFor(body);
    // 304 path is load-bearing for the dashboard's 1s polling cadence
    // (features/clusterD/dashboard-verdict-views.md:59). Without it the
    // demo machine bursts on idle pings.
    if (req.headers["if-none-match"] === etag) {
      await reply.code(304).send();
      return;
    }
    await reply.header("etag", etag).type("application/json").send(body);
  });

  app.get<{ Params: { id: string } }>(
    "/api/verdicts/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const advertiserId = req.advertiserId!;
      const row = await auditStore.get(advertiserId, req.params.id);
      if (row === null) {
        // 404 — NOT 403 — on cross-tenant access. No enumeration.
        // Same principle as features/clusterA/gate-verdict-logic.md:102.
        await reply.code(404).send();
        return;
      }
      await reply.send(row);
    },
  );
}
