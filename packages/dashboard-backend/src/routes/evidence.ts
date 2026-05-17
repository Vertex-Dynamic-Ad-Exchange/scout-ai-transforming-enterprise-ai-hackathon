import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditQueryFilter, AuditStore } from "@scout/store";

// Mock seam for tests. `vi.spyOn(evidenceInternals, "fetchEvidenceStream")`
// without a `.mockImplementation` pins call count; with one, swaps the
// upstream entirely. Module-level so the import in `evidence.ts` and
// the spy in tests refer to the same object.
export const evidenceInternals = {
  async fetchEvidenceStream(uri: string): Promise<Readable> {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") {
      throw new Error(`evidence scheme not supported: ${parsed.protocol}`);
    }
    return createReadStream(parsed.pathname);
  },
};

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+\-.]*:/;

function decodeBase64Url(s: string): string | null {
  if (s.length === 0) return null;
  // base64url alphabet (RFC 4648 §5): A–Z, a–z, 0–9, '-', '_'. No
  // padding in path segments; reject anything else as malformed.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const decoded = Buffer.from(s, "base64url").toString("utf-8");
  if (decoded.length === 0) return null;
  // Sanity-check the decoded payload looks like a URI. Filters out
  // random bytes that happen to be valid base64url characters.
  if (!URI_SCHEME.test(decoded)) return null;
  return decoded;
}

async function advertiserOwnsUri(
  auditStore: AuditStore,
  advertiserId: string,
  uri: string,
): Promise<boolean> {
  // O(N) walk of the advertiser's rows. Acceptable for the demo
  // (≤200 rows per advertiser per PRP confidence note). A real impl
  // wants a `findByEvidenceUri` index — filed as a follow-up.
  let cursor: string | undefined;
  do {
    const filter: AuditQueryFilter = { advertiserId, limit: 200 };
    if (cursor !== undefined) filter.cursor = cursor;
    const page = await auditStore.query(filter);
    for (const row of page.rows) {
      if (row.kind !== "verdict") continue;
      if (row.profile === null) continue;
      if (row.profile.evidenceRefs.some((ref) => ref.uri === uri)) return true;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return false;
}

function sniffContentType(uri: string): string | null {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".txt")) return "text/plain";
  return null;
}

export function registerEvidenceRoutes(app: FastifyInstance, auditStore: AuditStore): void {
  app.get<{ Params: { uri: string } }>(
    "/api/evidence/:uri",
    async (
      req: FastifyRequest<{ Params: { uri: string } }>,
      reply: FastifyReply,
    ) => {
      const decoded = decodeBase64Url(req.params.uri);
      if (decoded === null) {
        await reply.code(400).send({ error: "bad_uri" });
        return;
      }
      const advertiserId = req.advertiserId!;
      const owns = await advertiserOwnsUri(auditStore, advertiserId, decoded);
      if (!owns) {
        // 404 — NOT 403. No enumeration of cross-tenant URIs. Test pins
        // `fetchEvidenceStream` is NOT called on this path.
        await reply.code(404).send();
        return;
      }
      const upstream = await evidenceInternals.fetchEvidenceStream(decoded);
      const contentType = sniffContentType(decoded) ?? "application/octet-stream";
      // Streaming (D10). `reply.send(stream)` pipes a Readable; no
      // buffering — a 5 MB screenshot × N concurrent requests would
      // otherwise be a DoS surface even on the demo machine.
      await reply.type(contentType).send(upstream);
    },
  );
}
