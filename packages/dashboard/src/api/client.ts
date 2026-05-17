import { z } from "zod";
import { AuditRowSchema, DecisionSchema, type AuditRow } from "@scout/shared";

/**
 * Typed wrapper around the three `@scout/dashboard-backend` routes
 * (PRP 03): `GET /api/verdicts`, `GET /api/verdicts/:id`,
 * `GET /api/evidence/:uri`.
 *
 * Every request carries `x-advertiser-id:
 * import.meta.env.VITE_DEMO_ADVERTISER_ID` — the stub-auth session
 * shape (feature spec line 45, PRP 03 § Decisions). The advertiser ID
 * is a **session identifier, NOT a secret** (D11): the backend uses
 * it to scope rows to a tenant and returns 404 (never 403) on a
 * cross-tenant `:id`. Real OIDC / SSO auth is filed as the
 * `dashboard-auth.md` follow-up.
 *
 * Responses are parsed via `AuditRowSchema` from `@scout/shared` (PRP
 * 01) before being handed to React Query. A 500 / malformed payload
 * throws here so the view's `error` branch in PRP 05 renders the
 * retry banner instead of trusting untyped data.
 */

const ListResponseSchema = z.object({
  rows: z.array(AuditRowSchema),
  nextCursor: z.string().nullable(),
});
export type ListVerdictsResult = z.infer<typeof ListResponseSchema>;

const KindEnum = z.enum(["verdict", "profile_job_dlq"]);

export interface ListVerdictsParams {
  since?: string;
  until?: string;
  decision?: z.infer<typeof DecisionSchema>;
  pageUrl?: string;
  kind?: z.infer<typeof KindEnum>;
  limit?: number;
  cursor?: string;
}

function backendBase(): string {
  // Falls back to "" so dev-mode requests hit the Vite dev proxy
  // (vite.config.ts) at `/api`. Production builds must set
  // VITE_DASHBOARD_BACKEND_URL — there is no implicit production
  // fallback that would silently misroute requests in a deployed UI.
  return import.meta.env.VITE_DASHBOARD_BACKEND_URL ?? "";
}

function sessionHeader(): HeadersInit {
  const id = import.meta.env.VITE_DEMO_ADVERTISER_ID;
  if (id === undefined || id === "") {
    throw new Error(
      "VITE_DEMO_ADVERTISER_ID missing — see .env.example. Session ID, NOT a secret (D11).",
    );
  }
  return { "x-advertiser-id": id };
}

function buildListUrl(params: ListVerdictsParams | undefined): string {
  const search = new URLSearchParams();
  if (params?.since !== undefined) search.set("since", params.since);
  if (params?.until !== undefined) search.set("until", params.until);
  if (params?.decision !== undefined) search.set("decision", params.decision);
  if (params?.pageUrl !== undefined) search.set("pageUrl", params.pageUrl);
  if (params?.kind !== undefined) search.set("kind", params.kind);
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  if (params?.cursor !== undefined) search.set("cursor", params.cursor);
  const qs = search.toString();
  return `${backendBase()}/api/verdicts${qs.length > 0 ? `?${qs}` : ""}`;
}

function fetchInit(init?: { signal?: AbortSignal }): RequestInit {
  const req: RequestInit = { headers: sessionHeader() };
  if (init?.signal !== undefined) req.signal = init.signal;
  return req;
}

export async function listVerdicts(
  params?: ListVerdictsParams,
  init?: { signal?: AbortSignal },
): Promise<ListVerdictsResult> {
  const res = await fetch(buildListUrl(params), fetchInit(init));
  if (!res.ok) {
    throw new Error(`listVerdicts failed: HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  return ListResponseSchema.parse(body);
}

export async function getVerdict(
  id: string,
  init?: { signal?: AbortSignal },
): Promise<AuditRow | null> {
  const res = await fetch(
    `${backendBase()}/api/verdicts/${encodeURIComponent(id)}`,
    fetchInit(init),
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`getVerdict failed: HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  return AuditRowSchema.parse(body);
}

/**
 * Returns the URL string that `<img src>` (or `<a href>`) hits — the
 * proxy resolves the original `EvidenceRef.uri` server-side after
 * verifying advertiser ownership (PRP 03 + feature spec line 44).
 * Encoded as base64url to keep `/` and `+` out of the path segment.
 * Browser sends the session header automatically only if the request
 * is same-origin (Vite dev proxy at `/api` qualifies). Production must
 * either same-origin the backend or front it with a cookie auth.
 */
export function evidenceUrl(uri: string): string {
  return `${backendBase()}/api/evidence/${toBase64Url(uri)}`;
}

function toBase64Url(s: string): string {
  // Browser-safe base64url: TextEncoder → btoa → RFC 4648 §5 alphabet
  // swap. `Buffer.from(...).toString("base64url")` would work in Node
  // but the dashboard runs in the browser; using `Buffer` here would
  // either ship a 50 KB polyfill or break at runtime.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
