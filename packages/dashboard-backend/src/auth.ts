import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    // Server-side only; derived from x-advertiser-id and the injected
    // allowlist. NEVER read from query string or body — that path would
    // let `?advertiserId=B` cross tenants.
    advertiserId?: string;
  }
}

const HEADER = "x-advertiser-id";

/**
 * Validates `x-advertiser-id` against the injected session allowlist.
 *
 * The allowlist is a v1 stub for real OIDC; the real auth swaps THIS
 * preHandler, not the data shape that downstream handlers depend on.
 * Constructor injection lets tests seed sessions without running a
 * `seedDashboardSessions` script.
 */
export function makePreHandler(allow: Map<string, string>): preHandlerHookHandler {
  return async function preHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers[HEADER];
    if (typeof header !== "string") {
      await reply.code(401).send();
      return;
    }
    const advertiserId = allow.get(header);
    if (advertiserId === undefined) {
      await reply.code(401).send();
      return;
    }
    req.advertiserId = advertiserId;
  };
}
