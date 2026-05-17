import Fastify, { type FastifyInstance } from "fastify";
import type { AuditStore } from "@scout/store";
import { makePreHandler } from "./auth.js";
import { registerVerdictRoutes } from "./routes/verdicts.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";

export interface ServerDeps {
  auditStore: AuditStore;
  // headerValue → advertiserId. Constructor-injected so tests seed
  // directly; real OIDC swaps the preHandler, not this shape.
  sessionAllowlist: Map<string, string>;
}

// Fastify({ logger: false }) is INTENTIONAL. AuditRow rows may carry
// `_lobstertrap.declared_intent` containing untrusted page content;
// app.log.info(req.body) would leak that into the demo machine's logs.
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", makePreHandler(deps.sessionAllowlist));
  registerVerdictRoutes(app, deps.auditStore);
  registerEvidenceRoutes(app, deps.auditStore);
  return app;
}
