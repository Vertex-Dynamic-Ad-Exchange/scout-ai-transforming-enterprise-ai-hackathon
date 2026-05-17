import Fastify from "fastify";
import { createHandler, type GateDeps } from "./handler.js";

export function createApp(deps: GateDeps) {
  const app = Fastify({ logger: { level: "warn" } }); // suppress hook logs on hot path

  app.post<{ Body: unknown }>("/verify", createHandler(deps));

  return app;
}

export type { GateDeps };

// CLI entry point (not exported as part of the module API)
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");

if (isMain) {
  const { createStores } = await import("@scout/store");
  const { createLlmClient } = await import("@scout/llm-client");
  const { createPolicyMatcher } = await import("@scout/policy");

  const portRaw = process.env["PORT"];
  const portParsed = portRaw === undefined || portRaw === "" ? NaN : Number.parseInt(portRaw, 10);
  const port = Number.isInteger(portParsed) && portParsed > 0 && portParsed < 65536 ? portParsed : 3000;
  const host = process.env["HOST"] ?? "0.0.0.0";

  const deps: GateDeps = {
    ...createStores(),
    llmClient: createLlmClient(),
    policyMatcher: createPolicyMatcher(),
  };
  const app = createApp(deps);
  await app.listen({ port, host });
  console.log(`[gate] listening on ${host}:${port}`);
}
